"""Job posting channels: recommendation, recruiter review, posting attempts,
and retirement on close. The only writer of `JobPostingChannel.status` and
the only creator of `PostingAttempt` rows -- the same single-choke-point
rule that vacancy_workflow.py and pipeline.py follow for their state.

Deterministic by design. A rule matches or it does not; a channel is
posted by calling n8n or by a person recording a reference; nothing here
scores, ranks, or guesses. The AI recommender planned for later may only
ever call `attach_channel(..., source=AI)` to add RECOMMENDED rows with a
reason, and never selects.

n8n is the only party that holds portal credentials. API-mode channels are
posted by one webhook call to `channel.integration_path` (default
"job-distribution", the workflow the legacy endpoint already used); the
response's `external_ref`/`external_url`, when present, are kept. Failure
never rolls back the caller: an attempt row records what happened and the
channel row goes FAILED for a person to retry.
"""

import uuid
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import (
    JOB_POSTING_CHANNEL_LIVE_STATUSES,
    JOB_POSTING_CHANNEL_POSTABLE_STATUSES,
    MAX_POSTING_ATTEMPTS_PER_CHANNEL,
    ChannelRecommendationSourceEnum,
    JobPostingChannelStatusEnum,
    PostingAttemptOutcomeEnum,
    PostingAttemptTriggerEnum,
    RecruitmentChannelModeEnum,
)
from app.models.job_posting import JobPosting
from app.models.job_posting_channel import JobPostingChannel, PostingAttempt
from app.models.recruitment_channel import ChannelRule, RecruitmentChannel
from app.models.user import User
from app.services.audit import log_event
from app.services.n8n_client import N8nClient, get_n8n_client

LEGACY_DISTRIBUTION_WEBHOOK = "job-distribution"


def _snapshot(row: JobPostingChannel) -> dict:
    return {
        "channel_code": row.channel.code,
        "status": row.status.value,
        "external_ref": row.external_ref,
        "external_url": row.external_url,
        "attempt_count": row.attempt_count,
    }


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- Recommendation (rules) -------------------------------------------------


def _rule_matches(rule: ChannelRule, vacancy_request) -> bool:
    checks = (
        (rule.match_category, vacancy_request.role_category),
        (rule.match_campus_id, vacancy_request.campus_id),
        (rule.match_department_id, vacancy_request.department_id),
        (rule.match_designation_id, vacancy_request.designation_id),
        (rule.match_employment_type, vacancy_request.employment_type),
    )
    return all(wanted is None or wanted == actual for wanted, actual in checks)


def existing_channel_rows(db: Session, job_posting: JobPosting) -> dict[uuid.UUID, JobPostingChannel]:
    rows = db.execute(
        select(JobPostingChannel).where(JobPostingChannel.job_posting_id == job_posting.id)
    ).scalars()
    return {row.channel_id: row for row in rows}


def recommend_channels(
    db: Session,
    *,
    job_posting: JobPosting,
    actor: User,
    request: Request | None,
) -> list[JobPostingChannel]:
    """Evaluates every active rule against the posting's vacancy request and
    attaches each recommended channel once. Most specific rule first, then
    highest priority; the first rule to name a channel decides whether it
    lands RECOMMENDED or (auto_select) SELECTED. Channels already on the
    posting -- in any status, including REMOVED -- are left alone, so
    re-running after a recruiter's review never undoes it. Idempotent."""
    vacancy_request = job_posting.approved_vacancy.vacancy_request
    rules = db.execute(select(ChannelRule).where(ChannelRule.is_active.is_(True))).scalars().all()
    matching = [rule for rule in rules if _rule_matches(rule, vacancy_request)]
    matching.sort(key=lambda r: (r.specificity, r.priority), reverse=True)

    already = existing_channel_rows(db, job_posting)
    created: list[JobPostingChannel] = []
    seen: set[uuid.UUID] = set(already)
    for rule in matching:
        for channel_id in rule.channel_ids:
            if channel_id in seen:
                continue
            channel = db.get(RecruitmentChannel, channel_id)
            if channel is None or not channel.is_active:
                continue
            if not channel.applies_to(category=vacancy_request.role_category, campus_id=job_posting.campus_id):
                continue
            seen.add(channel_id)
            row = JobPostingChannel(
                job_posting_id=job_posting.id,
                channel_id=channel.id,
                campus_id=job_posting.campus_id,
                status=(
                    JobPostingChannelStatusEnum.SELECTED
                    if rule.auto_select
                    else JobPostingChannelStatusEnum.RECOMMENDED
                ),
                recommended_by=ChannelRecommendationSourceEnum.RULE,
                recommendation_reason=rule.name,
            )
            db.add(row)
            created.append(row)
    db.flush()

    if created:
        log_event(
            db,
            actor=actor,
            action="JOB_POSTING_CHANNELS_RECOMMENDED",
            campus_context_id=job_posting.campus_id,
            entity_type="JobPosting",
            entity_id=job_posting.id,
            after_state={
                "channels": [
                    {"code": row.channel.code, "status": row.status.value, "rule": row.recommendation_reason}
                    for row in created
                ]
            },
            request=request,
        )
    return created


# --- Attach / review --------------------------------------------------------


def attach_channel(
    db: Session,
    *,
    job_posting: JobPosting,
    channel: RecruitmentChannel,
    actor: User,
    request: Request | None,
    source: ChannelRecommendationSourceEnum = ChannelRecommendationSourceEnum.USER,
    reason: str | None = None,
) -> JobPostingChannel:
    """A person attaching a channel means they intend to use it, so it lands
    SELECTED; an AI source may only ever land RECOMMENDED. A REMOVED row is
    revived rather than duplicated (the pair is unique)."""
    if not channel.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This channel is inactive")
    if not job_posting.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is closed")

    target = (
        JobPostingChannelStatusEnum.RECOMMENDED
        if source == ChannelRecommendationSourceEnum.AI
        else JobPostingChannelStatusEnum.SELECTED
    )
    row = existing_channel_rows(db, job_posting).get(channel.id)
    if row is not None:
        if row.status != JobPostingChannelStatusEnum.REMOVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This channel is already on the posting"
            )
        before = _snapshot(row)
        row.status = target
        row.removed_at = None
        row.recommended_by = source
        row.recommendation_reason = reason
        row.reviewed_by_id = actor.id if target == JobPostingChannelStatusEnum.SELECTED else None
        row.reviewed_at = _now() if target == JobPostingChannelStatusEnum.SELECTED else None
        db.flush()
        log_event(
            db,
            actor=actor,
            action="JOB_POSTING_CHANNEL_ATTACHED",
            campus_context_id=job_posting.campus_id,
            entity_type="JobPostingChannel",
            entity_id=row.id,
            before_state=before,
            after_state=_snapshot(row),
            request=request,
        )
        return row

    row = JobPostingChannel(
        job_posting_id=job_posting.id,
        channel_id=channel.id,
        campus_id=job_posting.campus_id,
        status=target,
        recommended_by=source,
        recommendation_reason=reason,
        reviewed_by_id=actor.id if target == JobPostingChannelStatusEnum.SELECTED else None,
        reviewed_at=_now() if target == JobPostingChannelStatusEnum.SELECTED else None,
    )
    db.add(row)
    db.flush()
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_CHANNEL_ATTACHED",
        campus_context_id=job_posting.campus_id,
        entity_type="JobPostingChannel",
        entity_id=row.id,
        after_state=_snapshot(row),
        request=request,
    )
    return row


def select_channel(db: Session, *, row: JobPostingChannel, actor: User, request: Request | None) -> JobPostingChannel:
    """The recruiter's review: RECOMMENDED -> SELECTED. Anything else is a
    409 -- a POSTED row does not need selecting and a REMOVED one is revived
    through attach_channel, which audits it as such."""
    if row.status != JobPostingChannelStatusEnum.RECOMMENDED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot select a channel in status {row.status.value}",
        )
    before = _snapshot(row)
    row.status = JobPostingChannelStatusEnum.SELECTED
    row.reviewed_by_id = actor.id
    row.reviewed_at = _now()
    db.flush()
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_CHANNEL_SELECTED",
        campus_context_id=row.campus_id,
        entity_type="JobPostingChannel",
        entity_id=row.id,
        before_state=before,
        after_state=_snapshot(row),
        request=request,
    )
    return row


def remove_channel(db: Session, *, row: JobPostingChannel, actor: User, request: Request | None) -> JobPostingChannel:
    """Any live status -> REMOVED. Step 1 records the removal only; telling
    the portal to take the ad down is the n8n callback step's job, and the
    row keeps external_ref so that step knows what to remove."""
    if row.status not in JOB_POSTING_CHANNEL_LIVE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot remove a channel in status {row.status.value}",
        )
    before = _snapshot(row)
    row.status = JobPostingChannelStatusEnum.REMOVED
    row.removed_at = _now()
    row.reviewed_by_id = actor.id
    row.reviewed_at = row.removed_at
    db.flush()
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_CHANNEL_REMOVED",
        campus_context_id=row.campus_id,
        entity_type="JobPostingChannel",
        entity_id=row.id,
        before_state=before,
        after_state=_snapshot(row),
        request=request,
    )
    return row


# --- Posting attempts -------------------------------------------------------


def _new_attempt(
    db: Session,
    *,
    row: JobPostingChannel,
    trigger: PostingAttemptTriggerEnum,
    outcome: PostingAttemptOutcomeEnum,
    actor: User | None,
    request_payload: dict | None,
    response_payload: dict | None,
    error_message: str | None,
) -> PostingAttempt:
    row.attempt_count += 1
    attempt = PostingAttempt(
        job_posting_channel_id=row.id,
        campus_id=row.campus_id,
        attempt_number=row.attempt_count,
        trigger=trigger,
        outcome=outcome,
        request_payload=request_payload,
        response_payload=response_payload,
        error_message=error_message,
        attempted_by_id=actor.id if actor else None,
        attempted_at=_now(),
    )
    db.add(attempt)
    db.flush()
    row.last_attempt_id = attempt.id
    row.last_error = error_message
    return attempt


def _assert_postable(row: JobPostingChannel) -> None:
    if not row.job_posting.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is closed")
    if row.status not in JOB_POSTING_CHANNEL_POSTABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot post a channel in status {row.status.value}; select it first",
        )
    if row.attempt_count >= MAX_POSTING_ATTEMPTS_PER_CHANNEL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This channel has failed {row.attempt_count} times; "
                "fix the integration before retrying"
            ),
        )


def _mark_posted(row: JobPostingChannel, response: dict | None) -> None:
    row.status = JobPostingChannelStatusEnum.POSTED
    row.posted_at = _now()
    row.last_error = None
    if response:
        ref = response.get("external_ref")
        url = response.get("external_url")
        if isinstance(ref, str) and ref:
            row.external_ref = ref[:200]
        if isinstance(url, str) and url:
            row.external_url = url[:500]


def _build_api_payload(row: JobPostingChannel, attempt_number: int) -> dict:
    from app.services.job_distribution import generate_job_ad  # local: job_distribution imports this module

    ad = generate_job_ad(row.job_posting)
    return {
        **ad,
        "job_posting_id": str(ad["job_posting_id"]),
        "job_posting_channel_id": str(row.id),
        "attempt_number": attempt_number,
        "channel_code": row.channel.code,
        "channel_config": row.channel.config or {},
        # `portals` kept for the existing n8n workflow, which switches on it.
        "portals": [row.channel.code],
    }


def _audit_attempt(db: Session, *, row: JobPostingChannel, attempt: PostingAttempt, actor: User | None, request) -> None:
    succeeded = attempt.outcome == PostingAttemptOutcomeEnum.SUCCEEDED
    log_event(
        db,
        actor=actor,
        action="POSTING_ATTEMPT_SUCCEEDED" if succeeded else "POSTING_ATTEMPT_FAILED",
        campus_context_id=row.campus_id,
        entity_type="JobPostingChannel",
        entity_id=row.id,
        after_state={
            "channel_code": row.channel.code,
            "attempt_number": attempt.attempt_number,
            "outcome": attempt.outcome.value,
            "trigger": attempt.trigger.value,
            "error": attempt.error_message,
            "status": row.status.value,
        },
        request=request,
    )


def post_channel(
    db: Session,
    *,
    row: JobPostingChannel,
    actor: User,
    request: Request | None,
    n8n_client: N8nClient | None = None,
) -> PostingAttempt:
    """One attempt to put the posting on this channel, dispatched by the
    channel's mode. Never raises for a delivery failure -- the attempt row
    and the FAILED status are the result, and the caller reads
    `attempt.outcome` to pick a response code. Raises 409 only for a row
    that must not be posted (wrong status, closed posting, retry cap)."""
    _assert_postable(row)
    trigger = PostingAttemptTriggerEnum.RETRY if row.attempt_count > 0 else PostingAttemptTriggerEnum.MANUAL
    mode = row.channel.mode
    attempt_number = row.attempt_count + 1

    if mode in (RecruitmentChannelModeEnum.INTERNAL, RecruitmentChannelModeEnum.FEED):
        # Nothing to send: the posting is live wherever this system serves it.
        _mark_posted(row, None)
        attempt = _new_attempt(
            db, row=row, trigger=trigger, outcome=PostingAttemptOutcomeEnum.SUCCEEDED, actor=actor,
            request_payload={"mode": mode.value}, response_payload=None, error_message=None,
        )
    elif mode == RecruitmentChannelModeEnum.MANUAL_ASSISTED:
        # The pack is ready; a person posts it and records the reference via
        # record_manual_posting(). QUEUED is that hand-off.
        row.status = JobPostingChannelStatusEnum.QUEUED
        row.last_error = None
        attempt = _new_attempt(
            db, row=row, trigger=trigger, outcome=PostingAttemptOutcomeEnum.SUCCEEDED, actor=actor,
            request_payload={"mode": mode.value, "queued_for_manual_posting": True},
            response_payload=None, error_message=None,
        )
    else:  # API
        payload = _build_api_payload(row, attempt_number)
        client = n8n_client if n8n_client is not None else get_n8n_client()
        if client is None:
            row.status = JobPostingChannelStatusEnum.FAILED
            attempt = _new_attempt(
                db, row=row, trigger=trigger, outcome=PostingAttemptOutcomeEnum.NOT_CONFIGURED, actor=actor,
                request_payload=payload, response_payload=None,
                error_message="Job-portal distribution is not configured (N8N_BASE_URL is not set)",
            )
        else:
            path = row.channel.integration_path or LEGACY_DISTRIBUTION_WEBHOOK
            try:
                response = client.post_webhook(path, payload)
            except httpx.TimeoutException as exc:
                row.status = JobPostingChannelStatusEnum.FAILED
                attempt = _new_attempt(
                    db, row=row, trigger=trigger, outcome=PostingAttemptOutcomeEnum.TIMEOUT, actor=actor,
                    request_payload=payload, response_payload=None, error_message=f"Timed out reaching n8n: {exc}",
                )
            except httpx.HTTPError as exc:
                row.status = JobPostingChannelStatusEnum.FAILED
                attempt = _new_attempt(
                    db, row=row, trigger=trigger, outcome=PostingAttemptOutcomeEnum.FAILED, actor=actor,
                    request_payload=payload, response_payload=None, error_message=str(exc)[:2000],
                )
            else:
                _mark_posted(row, response)
                attempt = _new_attempt(
                    db, row=row, trigger=trigger, outcome=PostingAttemptOutcomeEnum.SUCCEEDED, actor=actor,
                    request_payload=payload, response_payload=response, error_message=None,
                )

    _audit_attempt(db, row=row, attempt=attempt, actor=actor, request=request)
    return attempt


def record_manual_posting(
    db: Session,
    *,
    row: JobPostingChannel,
    actor: User,
    request: Request | None,
    external_ref: str | None,
    external_url: str | None,
) -> JobPostingChannel:
    """A person posted it (FacultyPlus, a notice board, a group) and is
    recording where. Allowed from SELECTED, QUEUED or FAILED on any mode --
    an API channel that keeps failing can still be posted by hand."""
    _assert_postable(row)
    before = _snapshot(row)
    _mark_posted(row, {"external_ref": external_ref, "external_url": external_url})
    attempt = _new_attempt(
        db, row=row,
        trigger=PostingAttemptTriggerEnum.RETRY if row.attempt_count > 0 else PostingAttemptTriggerEnum.MANUAL,
        outcome=PostingAttemptOutcomeEnum.SUCCEEDED, actor=actor,
        request_payload={"manual": True, "external_ref": external_ref, "external_url": external_url},
        response_payload=None, error_message=None,
    )
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_CHANNEL_POSTED_MANUALLY",
        campus_context_id=row.campus_id,
        entity_type="JobPostingChannel",
        entity_id=row.id,
        before_state=before,
        after_state={**_snapshot(row), "attempt_number": attempt.attempt_number},
        request=request,
    )
    return row


# --- Legacy "distribute to portals" -----------------------------------------


def distribute_legacy(
    db: Session,
    *,
    job_posting: JobPosting,
    portal_codes: list[str],
    n8n_client: N8nClient,
    actor: User,
    request: Request | None,
) -> dict:
    """The pre-channel contract, kept verbatim for the existing button and
    the existing n8n workflow: ONE webhook call carrying `portals`. What is
    new is that each portal now has a channel row, and the call is recorded
    as one attempt per row. Returns {"ok": bool, ...}; the router commits
    and then answers 200 or 502, so the attempt rows survive the failure
    (they used to be rolled back with the audit row -- get_db never
    commits on an exception)."""
    from app.services.job_distribution import generate_job_ad  # local: avoids the import cycle

    if not job_posting.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is closed")

    channels_by_code = {
        c.code: c
        for c in db.execute(
            select(RecruitmentChannel).where(
                RecruitmentChannel.is_active.is_(True),
                RecruitmentChannel.mode == RecruitmentChannelModeEnum.API,
            )
        ).scalars()
    }
    invalid = [code for code in portal_codes if code not in channels_by_code]
    if invalid:
        supported = ", ".join(sorted(channels_by_code))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported portal(s): {', '.join(invalid)}. Supported: {supported}.",
        )
    if not portal_codes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No portals given")

    rows: list[JobPostingChannel] = []
    existing = existing_channel_rows(db, job_posting)
    for code in portal_codes:
        channel = channels_by_code[code]
        row = existing.get(channel.id)
        if row is None or row.status == JobPostingChannelStatusEnum.REMOVED:
            row = attach_channel(db, job_posting=job_posting, channel=channel, actor=actor, request=request)
        elif row.status == JobPostingChannelStatusEnum.RECOMMENDED:
            select_channel(db, row=row, actor=actor, request=request)
        _assert_postable(row)
        rows.append(row)

    ad = generate_job_ad(job_posting)
    payload = {**ad, "job_posting_id": str(ad["job_posting_id"]), "portals": list(portal_codes)}

    try:
        n8n_response = n8n_client.post_webhook(LEGACY_DISTRIBUTION_WEBHOOK, payload)
    except httpx.HTTPError as exc:
        outcome = (
            PostingAttemptOutcomeEnum.TIMEOUT
            if isinstance(exc, httpx.TimeoutException)
            else PostingAttemptOutcomeEnum.FAILED
        )
        for row in rows:
            row.status = JobPostingChannelStatusEnum.FAILED
            attempt = _new_attempt(
                db, row=row, trigger=PostingAttemptTriggerEnum.LEGACY_DISTRIBUTE, outcome=outcome, actor=actor,
                request_payload=payload, response_payload=None, error_message=str(exc)[:2000],
            )
            _audit_attempt(db, row=row, attempt=attempt, actor=actor, request=request)
        log_event(
            db,
            actor=actor,
            action="JOB_POSTING_DISTRIBUTE_FAILED",
            campus_context_id=job_posting.campus_id,
            entity_type="JobPosting",
            entity_id=job_posting.id,
            after_state={"portals": list(portal_codes), "error": str(exc)},
            request=request,
        )
        return {"ok": False, "portals": list(portal_codes), "error": str(exc)}

    for row in rows:
        _mark_posted(row, None)
        attempt = _new_attempt(
            db, row=row, trigger=PostingAttemptTriggerEnum.LEGACY_DISTRIBUTE,
            outcome=PostingAttemptOutcomeEnum.SUCCEEDED, actor=actor,
            request_payload=payload, response_payload=n8n_response, error_message=None,
        )
        _audit_attempt(db, row=row, attempt=attempt, actor=actor, request=request)
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_DISTRIBUTED",
        campus_context_id=job_posting.campus_id,
        entity_type="JobPosting",
        entity_id=job_posting.id,
        after_state={"portals": list(portal_codes)},
        request=request,
    )
    return {"ok": True, "portals": list(portal_codes), "n8n_response": n8n_response}


# --- Close / expiry ---------------------------------------------------------


def retire_channels_for_closed_posting(
    db: Session,
    *,
    job_posting: JobPosting,
    actor: User | None,
    request: Request | None,
    expired: bool = False,
) -> int:
    """Called by the two places that close a posting -- vacancy_workflow.close()
    and pipeline's auto-close on the last filled slot -- so no channel row
    outlives its posting. Every live row goes REMOVED (or EXPIRED when the
    close is an expiry). Portal take-down calls are the callback step's job;
    external_ref is kept for it. Returns the number of rows retired."""
    target = JobPostingChannelStatusEnum.EXPIRED if expired else JobPostingChannelStatusEnum.REMOVED
    now = _now()
    retired = 0
    for row in db.execute(
        select(JobPostingChannel).where(
            JobPostingChannel.job_posting_id == job_posting.id,
            JobPostingChannel.status.in_(JOB_POSTING_CHANNEL_LIVE_STATUSES),
        )
    ).scalars():
        row.status = target
        if expired:
            row.expires_at = now
        else:
            row.removed_at = now
        retired += 1
    if retired:
        db.flush()
        log_event(
            db,
            actor=actor,
            action="JOB_POSTING_CHANNELS_RETIRED",
            campus_context_id=job_posting.campus_id,
            entity_type="JobPosting",
            entity_id=job_posting.id,
            after_state={"status": target.value, "count": retired},
            request=request,
        )
    return retired
