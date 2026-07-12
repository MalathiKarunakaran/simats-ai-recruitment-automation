"""Module 2: the Vacancy Request approval-chain state machine, plus creation
of the downstream decomposed entities (ApprovedVacancy + HiringSlots at HR's
final approval; JobPosting at the explicit publish action).
"""

import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models.approved_vacancy import ApprovedVacancy
from app.models.enums import HiringSlotStatusEnum, UserRoleEnum, VacancyRequestStatusEnum
from app.models.hiring_slot import HiringSlot
from app.models.job_posting import JobPosting
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services import notifications
from app.services.audit import log_event


def _snapshot(vacancy_request: VacancyRequest) -> dict:
    return {"status": vacancy_request.status.value}


def submit(db: Session, vacancy_request: VacancyRequest, actor: User, request: Request | None) -> VacancyRequest:
    if vacancy_request.status != VacancyRequestStatusEnum.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot submit from status {vacancy_request.status.value}",
        )

    before = _snapshot(vacancy_request)
    vacancy_request.status = VacancyRequestStatusEnum.SUBMITTED
    vacancy_request.submitted_at = datetime.now(timezone.utc)

    log_event(
        db,
        actor=actor,
        action="VACANCY_REQUEST_SUBMITTED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="VacancyRequest",
        entity_id=vacancy_request.id,
        before_state=before,
        after_state=_snapshot(vacancy_request),
        request=request,
    )
    notifications.notify_role(
        db,
        roles={UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT, UserRoleEnum.SUPER_ADMIN},
        notification_type="VACANCY_REQUEST_SUBMITTED",
        subject=f"Vacancy request submitted: {vacancy_request.position_title}",
        body=f"A vacancy request for {vacancy_request.position_title} at {vacancy_request.campus.code} awaits Dean approval.",
        related_entity_type="VacancyRequest",
        related_entity_id=vacancy_request.id,
        request=request,
    )
    return vacancy_request


def dean_approve(
    db: Session, vacancy_request: VacancyRequest, actor: User, request: Request | None
) -> VacancyRequest:
    if vacancy_request.status != VacancyRequestStatusEnum.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot Dean-approve from status {vacancy_request.status.value}",
        )

    before = _snapshot(vacancy_request)
    vacancy_request.status = VacancyRequestStatusEnum.DEAN_APPROVED
    vacancy_request.dean_reviewed_by_id = actor.id
    vacancy_request.dean_reviewed_at = datetime.now(timezone.utc)

    log_event(
        db,
        actor=actor,
        action="VACANCY_REQUEST_DEAN_APPROVED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="VacancyRequest",
        entity_id=vacancy_request.id,
        before_state=before,
        after_state=_snapshot(vacancy_request),
        request=request,
    )
    notifications.notify(
        db,
        recipient_user=vacancy_request.requested_by,
        notification_type="VACANCY_REQUEST_DEAN_APPROVED",
        subject=f"Dean-approved: {vacancy_request.position_title}",
        body=f"Your vacancy request for {vacancy_request.position_title} was approved by the Associate Dean and now awaits HR approval.",
        campus_context_id=vacancy_request.campus_id,
        related_entity_type="VacancyRequest",
        related_entity_id=vacancy_request.id,
        request=request,
    )
    notifications.notify_role(
        db,
        roles={UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN},
        notification_type="VACANCY_REQUEST_DEAN_APPROVED",
        subject=f"Vacancy request awaiting HR approval: {vacancy_request.position_title}",
        body=f"A vacancy request for {vacancy_request.position_title} at {vacancy_request.campus.code} has been Dean-approved and awaits HR approval.",
        related_entity_type="VacancyRequest",
        related_entity_id=vacancy_request.id,
        request=request,
    )
    return vacancy_request


def reject(
    db: Session, vacancy_request: VacancyRequest, actor: User, reason: str, request: Request | None
) -> VacancyRequest:
    if vacancy_request.status not in (
        VacancyRequestStatusEnum.SUBMITTED,
        VacancyRequestStatusEnum.DEAN_APPROVED,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot reject from status {vacancy_request.status.value}",
        )

    before = _snapshot(vacancy_request)
    vacancy_request.status = VacancyRequestStatusEnum.REJECTED
    vacancy_request.rejected_by_id = actor.id
    vacancy_request.rejected_at = datetime.now(timezone.utc)
    vacancy_request.rejection_reason = reason

    log_event(
        db,
        actor=actor,
        action="VACANCY_REQUEST_REJECTED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="VacancyRequest",
        entity_id=vacancy_request.id,
        before_state=before,
        after_state=_snapshot(vacancy_request),
        request=request,
    )
    notifications.notify(
        db,
        recipient_user=vacancy_request.requested_by,
        notification_type="VACANCY_REQUEST_REJECTED",
        subject=f"Vacancy request rejected: {vacancy_request.position_title}",
        body=f"Your vacancy request for {vacancy_request.position_title} was rejected. Reason: {reason}",
        campus_context_id=vacancy_request.campus_id,
        related_entity_type="VacancyRequest",
        related_entity_id=vacancy_request.id,
        request=request,
    )
    return vacancy_request


def hr_approve(
    db: Session, vacancy_request: VacancyRequest, actor: User, request: Request | None
) -> ApprovedVacancy:
    allowed_from = {VacancyRequestStatusEnum.DEAN_APPROVED}
    if actor.role == UserRoleEnum.SUPER_ADMIN:
        # Super Admin override may skip the Dean stage entirely.
        allowed_from.add(VacancyRequestStatusEnum.SUBMITTED)

    if vacancy_request.status not in allowed_from:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot HR-approve from status {vacancy_request.status.value}",
        )

    before = _snapshot(vacancy_request)
    now = datetime.now(timezone.utc)
    vacancy_request.status = VacancyRequestStatusEnum.APPROVED
    vacancy_request.hr_reviewed_by_id = actor.id
    vacancy_request.hr_reviewed_at = now

    approved_vacancy = ApprovedVacancy(
        vacancy_request_id=vacancy_request.id,
        campus_id=vacancy_request.campus_id,
        total_positions=vacancy_request.requested_count,
        approved_by_id=actor.id,
        approved_at=now,
    )
    db.add(approved_vacancy)
    db.flush()

    for slot_number in range(1, vacancy_request.requested_count + 1):
        db.add(
            HiringSlot(
                approved_vacancy_id=approved_vacancy.id,
                slot_number=slot_number,
                status=HiringSlotStatusEnum.OPEN,
            )
        )

    log_event(
        db,
        actor=actor,
        action="VACANCY_REQUEST_HR_APPROVED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="VacancyRequest",
        entity_id=vacancy_request.id,
        before_state=before,
        after_state=_snapshot(vacancy_request),
        request=request,
    )
    log_event(
        db,
        actor=actor,
        action="APPROVED_VACANCY_CREATED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="ApprovedVacancy",
        entity_id=approved_vacancy.id,
        after_state={"total_positions": approved_vacancy.total_positions},
        request=request,
    )
    notifications.notify(
        db,
        recipient_user=vacancy_request.requested_by,
        notification_type="VACANCY_REQUEST_HR_APPROVED",
        subject=f"HR-approved: {vacancy_request.position_title}",
        body=f"Your vacancy request for {vacancy_request.position_title} received final HR approval ({approved_vacancy.total_positions} position(s)).",
        campus_context_id=vacancy_request.campus_id,
        related_entity_type="VacancyRequest",
        related_entity_id=vacancy_request.id,
        request=request,
    )
    notifications.notify_role(
        db,
        roles={UserRoleEnum.RECRUITMENT_OFFICER},
        campus_id=vacancy_request.campus_id,
        notification_type="VACANCY_REQUEST_HR_APPROVED",
        subject=f"Vacancy approved, ready to publish: {vacancy_request.position_title}",
        body=f"{vacancy_request.position_title} at {vacancy_request.campus.code} has been HR-approved with {approved_vacancy.total_positions} position(s).",
        related_entity_type="VacancyRequest",
        related_entity_id=vacancy_request.id,
        request=request,
    )
    return approved_vacancy


def publish(
    db: Session,
    vacancy_request: VacancyRequest,
    approved_vacancy: ApprovedVacancy,
    actor: User,
    request: Request | None,
) -> JobPosting:
    if vacancy_request.status != VacancyRequestStatusEnum.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot publish from status {vacancy_request.status.value}",
        )

    before = _snapshot(vacancy_request)
    now = datetime.now(timezone.utc)
    vacancy_request.status = VacancyRequestStatusEnum.PUBLISHED

    slug_base = f"{vacancy_request.campus.code}-{vacancy_request.position_title}".lower().replace(" ", "-")
    slug = f"{slug_base}-{secrets.token_hex(4)}"

    job_posting = JobPosting(
        approved_vacancy_id=approved_vacancy.id,
        campus_id=vacancy_request.campus_id,
        public_apply_slug=slug,
        published_at=now,
    )
    db.add(job_posting)
    db.flush()

    log_event(
        db,
        actor=actor,
        action="VACANCY_REQUEST_PUBLISHED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="VacancyRequest",
        entity_id=vacancy_request.id,
        before_state=before,
        after_state=_snapshot(vacancy_request),
        request=request,
    )
    log_event(
        db,
        actor=actor,
        action="JOB_POSTING_CREATED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="JobPosting",
        entity_id=job_posting.id,
        after_state={"public_apply_slug": job_posting.public_apply_slug},
        request=request,
    )
    notifications.notify(
        db,
        recipient_user=vacancy_request.requested_by,
        notification_type="VACANCY_REQUEST_PUBLISHED",
        subject=f"Published: {vacancy_request.position_title}",
        body=f"Your vacancy request for {vacancy_request.position_title} is now published (posting {job_posting.public_apply_slug}).",
        campus_context_id=vacancy_request.campus_id,
        related_entity_type="JobPosting",
        related_entity_id=job_posting.id,
        request=request,
    )
    return job_posting


def close(
    db: Session,
    vacancy_request: VacancyRequest,
    approved_vacancy: ApprovedVacancy | None,
    job_posting: JobPosting | None,
    actor: User,
    request: Request | None,
) -> VacancyRequest:
    if vacancy_request.status != VacancyRequestStatusEnum.PUBLISHED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot close from status {vacancy_request.status.value}",
        )

    before = _snapshot(vacancy_request)
    now = datetime.now(timezone.utc)
    vacancy_request.status = VacancyRequestStatusEnum.CLOSED
    if approved_vacancy is not None:
        approved_vacancy.closed_at = now
    if job_posting is not None:
        job_posting.closed_at = now
        job_posting.is_active = False

    log_event(
        db,
        actor=actor,
        action="VACANCY_REQUEST_CLOSED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="VacancyRequest",
        entity_id=vacancy_request.id,
        before_state=before,
        after_state=_snapshot(vacancy_request),
        request=request,
    )
    return vacancy_request
