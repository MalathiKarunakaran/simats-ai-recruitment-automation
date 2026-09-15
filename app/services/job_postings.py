"""Job posting content, review and lifecycle (2026-09-06; review stage
2026-09-15).

vacancy_workflow.publish creates a posting as a DRAFT with its content
copied from the request (snapshot_content). From there this module is the
only code that moves it:

    DRAFT -> READY_FOR_REVIEW -> APPROVED -> PUBLISHED <-> PAUSED
      ^             |               |
      +-------------+---------------+  return_to_draft, or any content edit

An edit made after submission sends the posting back to DRAFT: what was
reviewed would no longer be what gets published. Edits to a live posting
stay allowed, as before the review stage existed.

Closing is NOT here on purpose: a posting closes only when its vacancy does,
through vacancy_workflow.close (or cancel / adjust_slot_count / the
pipeline's auto-close), which keeps hiring slots, the request status, the
posting and its channel rows in one transaction. vacancy_workflow.reopen is
the way back.

AI writes a draft only (generate_content): the summary, responsibilities,
preferred skills and description of a DRAFT posting. It never changes the
approved requirements, the status, or any channel.

Every write is audited with a before/after snapshot.
"""

from datetime import date, datetime, timezone

import openai
from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.enums import JobPostingStatusEnum
from app.models.job_posting import JobPosting
from app.models.location import Location
from app.models.user import User
from app.services import ai_client, job_channels
from app.services.audit import log_event

_UNDER_REVIEW = (JobPostingStatusEnum.READY_FOR_REVIEW, JobPostingStatusEnum.APPROVED)


def snapshot(job_posting: JobPosting) -> dict:
    return {
        "posting_number": job_posting.posting_number,
        "status": job_posting.status.value,
        "ad_title": job_posting.ad_title,
        "ad_body": job_posting.ad_body,
        "summary": job_posting.summary,
        "responsibilities": job_posting.responsibilities,
        "required_qualification": job_posting.required_qualification,
        "required_experience": job_posting.required_experience,
        "required_skills": list(job_posting.required_skills) if job_posting.required_skills is not None else None,
        "preferred_skills": list(job_posting.preferred_skills) if job_posting.preferred_skills is not None else None,
        "employment_type": job_posting.employment_type.value if job_posting.employment_type else None,
        "location_id": str(job_posting.location_id) if job_posting.location_id else None,
        "salary_min": job_posting.salary_min,
        "salary_max": job_posting.salary_max,
        "apply_deadline": job_posting.apply_deadline.isoformat() if job_posting.apply_deadline else None,
        "contact_email": job_posting.contact_email,
        "is_active": job_posting.is_active,
    }


def default_ad_body(vacancy_request) -> str:
    """The templated body used when no AI draft exists -- the same text the
    legacy ad builder fell back to, kept in one place."""
    return (
        f"{vacancy_request.position_title} ({vacancy_request.employment_type.value})\n"
        f"Qualification: {vacancy_request.qualification}\n"
        f"Experience: {vacancy_request.experience_required}"
    )


def snapshot_content(job_posting: JobPosting) -> None:
    """Called right after a posting row is created (vacancy_workflow.publish,
    tracker import). Copies the request's title, JD draft (or the templated
    body) and requirements so later edits to the request never silently
    change an advertisement."""
    vacancy_request = job_posting.approved_vacancy.vacancy_request
    job_posting.ad_title = vacancy_request.position_title[:200]
    job_posting.ad_body = vacancy_request.jd_draft or default_ad_body(vacancy_request)
    job_posting.required_qualification = vacancy_request.qualification
    job_posting.required_experience = vacancy_request.experience_required
    job_posting.required_skills = list(vacancy_request.skills) if vacancy_request.skills else None
    job_posting.employment_type = vacancy_request.employment_type
    job_posting.location_id = vacancy_request.location_id
    job_posting.salary_min = vacancy_request.salary_band_min
    job_posting.salary_max = vacancy_request.salary_band_max


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _assert_not_closed(job_posting: JobPosting) -> None:
    if job_posting.status == JobPostingStatusEnum.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is closed")


def _assert_status(job_posting: JobPosting, allowed: tuple[JobPostingStatusEnum, ...], verb: str) -> None:
    if job_posting.status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot {verb} a job posting in status {job_posting.status.value}",
        )


def _clear_review(job_posting: JobPosting) -> None:
    job_posting.submitted_for_review_by_id = None
    job_posting.submitted_for_review_at = None
    job_posting.approved_by_id = None
    job_posting.approved_at = None


def _audit(db: Session, *, job_posting: JobPosting, action: str, before: dict, actor: User, request, **extra) -> None:
    log_event(
        db,
        actor=actor,
        action=action,
        campus_context_id=job_posting.campus_id,
        entity_type="JobPosting",
        entity_id=job_posting.id,
        before_state=before,
        after_state={**snapshot(job_posting), **extra},
        request=request,
    )


# --- Content ----------------------------------------------------------------


def update_content(
    db: Session,
    *,
    job_posting: JobPosting,
    changes: dict,
    actor: User,
    request: Request | None,
) -> JobPosting:
    _assert_not_closed(job_posting)
    if not changes:
        return job_posting
    deadline = changes.get("apply_deadline")
    if deadline is not None and deadline < date.today():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="apply_deadline is in the past")
    if changes.get("location_id") is not None:
        location = db.get(Location, changes["location_id"])
        if location is None or location.campus_id != job_posting.campus_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="location_id is not a location on this posting's campus"
            )
    salary_min = changes.get("salary_min", job_posting.salary_min)
    salary_max = changes.get("salary_max", job_posting.salary_max)
    if salary_min is not None and salary_max is not None and salary_min > salary_max:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="salary_min is greater than salary_max")

    before = snapshot(job_posting)
    for field, value in changes.items():
        setattr(job_posting, field, value)
    returned_to_draft = job_posting.status in _UNDER_REVIEW
    if returned_to_draft:
        job_posting.set_status(JobPostingStatusEnum.DRAFT)
        _clear_review(job_posting)
    job_posting.last_edited_by_id = actor.id
    job_posting.last_edited_at = _now()
    db.flush()
    _audit(
        db, job_posting=job_posting, action="JOB_POSTING_UPDATED", before=before, actor=actor, request=request,
        returned_to_draft=returned_to_draft,
    )
    return job_posting


def generate_content(
    db: Session,
    *,
    job_posting: JobPosting,
    client: openai.OpenAI,
    provider: str,
    additional_instructions: str | None,
    actor: User,
    request: Request | None,
) -> JobPosting:
    """Fills a DRAFT posting's descriptive text from the AI. The call happens
    before anything is written, so an AI failure (503 not configured, 502
    unreachable) leaves the posting exactly as it was."""
    _assert_status(job_posting, (JobPostingStatusEnum.DRAFT,), "generate AI content for")
    fields = ai_client.generate_posting_jd(client, job_posting, additional_instructions, provider=provider)

    before = snapshot(job_posting)
    job_posting.summary = fields["role_overview"]
    job_posting.responsibilities = "\n".join(f"- {item}" for item in fields["responsibilities"])
    job_posting.preferred_skills = [skill[:100] for skill in fields["preferred_skills"]][:50] or None
    job_posting.ad_body = ai_client.render_jd_text(fields)
    now = _now()
    job_posting.ai_generated_at = now
    job_posting.last_edited_by_id = actor.id
    job_posting.last_edited_at = now
    db.flush()
    _audit(
        db, job_posting=job_posting, action="JOB_POSTING_CONTENT_GENERATED", before=before, actor=actor,
        request=request, ai_provider=provider, ai_model=settings.model_for(provider),
    )
    return job_posting


# --- Review and publication -------------------------------------------------


def submit_for_review(db: Session, *, job_posting: JobPosting, actor: User, request: Request | None) -> JobPosting:
    _assert_status(job_posting, (JobPostingStatusEnum.DRAFT,), "submit for review")
    if not (job_posting.ad_title or "").strip() or not (job_posting.ad_body or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add a job title and a job description before submitting for review",
        )
    before = snapshot(job_posting)
    job_posting.set_status(JobPostingStatusEnum.READY_FOR_REVIEW)
    job_posting.submitted_for_review_by_id = actor.id
    job_posting.submitted_for_review_at = _now()
    db.flush()
    _audit(db, job_posting=job_posting, action="JOB_POSTING_SUBMITTED_FOR_REVIEW", before=before, actor=actor, request=request)
    return job_posting


def return_to_draft(
    db: Session, *, job_posting: JobPosting, reason: str | None, actor: User, request: Request | None
) -> JobPosting:
    _assert_status(job_posting, _UNDER_REVIEW, "return to draft")
    before = snapshot(job_posting)
    job_posting.set_status(JobPostingStatusEnum.DRAFT)
    _clear_review(job_posting)
    db.flush()
    _audit(
        db, job_posting=job_posting, action="JOB_POSTING_RETURNED_TO_DRAFT", before=before, actor=actor,
        request=request, reason=reason,
    )
    return job_posting


def approve(db: Session, *, job_posting: JobPosting, actor: User, request: Request | None) -> JobPosting:
    _assert_status(job_posting, (JobPostingStatusEnum.READY_FOR_REVIEW,), "approve")
    before = snapshot(job_posting)
    job_posting.set_status(JobPostingStatusEnum.APPROVED)
    job_posting.approved_by_id = actor.id
    job_posting.approved_at = _now()
    db.flush()
    _audit(db, job_posting=job_posting, action="JOB_POSTING_APPROVED", before=before, actor=actor, request=request)
    return job_posting


def publish(db: Session, *, job_posting: JobPosting, actor: User, request: Request | None) -> JobPosting:
    """APPROVED -> PUBLISHED: the posting goes on the careers page and starts
    taking applications, and every selected channel this system publishes by
    itself (the careers page) is posted in the same transaction. Channels a
    person posts, or an integration posts, are not touched: a failure on one
    of those is that channel's status, never the posting's."""
    _assert_status(job_posting, (JobPostingStatusEnum.APPROVED,), "publish")
    if job_posting.apply_deadline is not None and job_posting.apply_deadline < date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The application deadline has passed; change it before publishing",
        )
    before = snapshot(job_posting)
    now = _now()
    job_posting.set_status(JobPostingStatusEnum.PUBLISHED)
    job_posting.published_at = now
    job_posting.published_by_id = actor.id
    db.flush()
    _audit(db, job_posting=job_posting, action="JOB_POSTING_PUBLISHED", before=before, actor=actor, request=request)
    job_channels.post_automatic_channels(db, job_posting=job_posting, actor=actor, request=request)
    return job_posting


def pause(db: Session, *, job_posting: JobPosting, actor: User, request: Request | None) -> JobPosting:
    _assert_not_closed(job_posting)
    if job_posting.status == JobPostingStatusEnum.PAUSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is already paused")
    _assert_status(job_posting, (JobPostingStatusEnum.PUBLISHED,), "pause")
    before = snapshot(job_posting)
    job_posting.set_status(JobPostingStatusEnum.PAUSED)
    db.flush()
    _audit(db, job_posting=job_posting, action="JOB_POSTING_PAUSED", before=before, actor=actor, request=request)
    return job_posting


def resume(db: Session, *, job_posting: JobPosting, actor: User, request: Request | None) -> JobPosting:
    _assert_not_closed(job_posting)
    if job_posting.status != JobPostingStatusEnum.PAUSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is not paused")
    before = snapshot(job_posting)
    job_posting.set_status(JobPostingStatusEnum.PUBLISHED)
    db.flush()
    _audit(db, job_posting=job_posting, action="JOB_POSTING_RESUMED", before=before, actor=actor, request=request)
    return job_posting
