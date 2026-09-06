"""Job posting content and lifecycle (2026-09-06).

The posting's text is snapshotted at publish (see vacancy_workflow.publish)
and edited here; pause/resume is the recruiter's "stop advertising for a
while" without touching the vacancy. Closing is NOT here on purpose: a
posting closes only when its vacancy does, through vacancy_workflow.close
(or cancel / adjust_slot_count / the pipeline's auto-close), which is what
keeps hiring slots, the request status, the posting and its channel rows
in one transaction. There is no reopen: a CLOSED vacancy is terminal in
vacancy_workflow's machine, and a new request is the honest way back.

Every write is audited with a before/after snapshot.
"""

from datetime import date, datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models.enums import JobPostingStatusEnum
from app.models.job_posting import JobPosting
from app.models.user import User
from app.services.audit import log_event


def snapshot(job_posting: JobPosting) -> dict:
    return {
        "posting_number": job_posting.posting_number,
        "status": job_posting.status.value,
        "ad_title": job_posting.ad_title,
        "ad_body": job_posting.ad_body,
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


def snapshot_ad_at_publish(job_posting: JobPosting) -> None:
    """Called by vacancy_workflow.publish right after the row is created.
    Copies the request's title and its JD draft (or the templated body) so
    later edits to the request never silently change a live ad."""
    vacancy_request = job_posting.approved_vacancy.vacancy_request
    job_posting.ad_title = vacancy_request.position_title[:200]
    job_posting.ad_body = vacancy_request.jd_draft or default_ad_body(vacancy_request)


def _assert_not_closed(job_posting: JobPosting) -> None:
    if job_posting.status == JobPostingStatusEnum.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is closed")


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
    before = snapshot(job_posting)
    for field, value in changes.items():
        setattr(job_posting, field, value)
    job_posting.last_edited_by_id = actor.id
    job_posting.last_edited_at = datetime.now(timezone.utc)
    db.flush()
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_UPDATED",
        campus_context_id=job_posting.campus_id,
        entity_type="JobPosting",
        entity_id=job_posting.id,
        before_state=before,
        after_state=snapshot(job_posting),
        request=request,
    )
    return job_posting


def pause(db: Session, *, job_posting: JobPosting, actor: User, request: Request | None) -> JobPosting:
    _assert_not_closed(job_posting)
    if job_posting.status == JobPostingStatusEnum.PAUSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is already paused")
    before = snapshot(job_posting)
    job_posting.status = JobPostingStatusEnum.PAUSED
    db.flush()
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_PAUSED",
        campus_context_id=job_posting.campus_id,
        entity_type="JobPosting",
        entity_id=job_posting.id,
        before_state=before,
        after_state=snapshot(job_posting),
        request=request,
    )
    return job_posting


def resume(db: Session, *, job_posting: JobPosting, actor: User, request: Request | None) -> JobPosting:
    _assert_not_closed(job_posting)
    if job_posting.status == JobPostingStatusEnum.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is not paused")
    before = snapshot(job_posting)
    job_posting.status = JobPostingStatusEnum.PUBLISHED
    db.flush()
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_RESUMED",
        campus_context_id=job_posting.campus_id,
        entity_type="JobPosting",
        entity_id=job_posting.id,
        before_state=before,
        after_state=snapshot(job_posting),
        request=request,
    )
    return job_posting
