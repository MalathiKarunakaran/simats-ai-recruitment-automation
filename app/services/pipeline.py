"""Module 11: the single choke point for Application status transitions,
hiring-slot reservation/release/fill, and vacancy auto-close.

Nothing outside this module should mutate Application.status or HiringSlot.status
directly -- routers (applications, offers, joining) call into
transition_application_status()/advance_if_behind() so the slot lifecycle and
audit trail stay consistent no matter which router triggered the move.
"""

from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.enums import (
    APPLICATION_STATUS_ORDER,
    APPLICATION_TERMINAL_STATUSES,
    ApplicationStatusEnum,
    HiringSlotStatusEnum,
    UserRoleEnum,
    VacancyRequestStatusEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.job_posting import JobPosting
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services.audit import log_event


def _application_snapshot(application: Application) -> dict:
    return {"status": application.status.value, "rejection_reason": application.rejection_reason}


def _reserve_slot(db: Session, application: Application, actor: User, request: Request | None) -> HiringSlot:
    approved_vacancy_id = application.job_posting.approved_vacancy_id

    slot = db.execute(
        select(HiringSlot)
        .where(
            HiringSlot.approved_vacancy_id == approved_vacancy_id,
            HiringSlot.status == HiringSlotStatusEnum.OPEN,
        )
        .order_by(HiringSlot.slot_number)
        .with_for_update()
        .limit(1)
    ).scalar_one_or_none()

    if slot is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="No open hiring slots remain for this vacancy"
        )

    slot.status = HiringSlotStatusEnum.RESERVED
    slot.reserved_application_id = application.id
    slot.reserved_at = datetime.now(timezone.utc)

    log_event(
        db,
        actor=actor,
        action="HIRING_SLOT_RESERVED",
        campus_context_id=application.campus_id,
        entity_type="HiringSlot",
        entity_id=slot.id,
        after_state={"status": slot.status.value, "reserved_application_id": str(application.id)},
        request=request,
    )
    return slot


def _release_slot_if_reserved(
    db: Session, application: Application, actor: User, request: Request | None
) -> None:
    slot = db.execute(
        select(HiringSlot)
        .where(
            HiringSlot.reserved_application_id == application.id,
            HiringSlot.status == HiringSlotStatusEnum.RESERVED,
        )
        .with_for_update()
    ).scalar_one_or_none()

    if slot is None:
        return

    before = {"status": slot.status.value}
    slot.status = HiringSlotStatusEnum.OPEN
    slot.reserved_application_id = None
    slot.released_at = datetime.now(timezone.utc)

    log_event(
        db,
        actor=actor,
        action="HIRING_SLOT_RELEASED",
        campus_context_id=application.campus_id,
        entity_type="HiringSlot",
        entity_id=slot.id,
        before_state=before,
        after_state={"status": slot.status.value},
        request=request,
    )


def _fill_slot_and_maybe_autoclose(
    db: Session, application: Application, actor: User, request: Request | None
) -> None:
    slot = db.execute(
        select(HiringSlot)
        .where(
            HiringSlot.reserved_application_id == application.id,
            HiringSlot.status == HiringSlotStatusEnum.RESERVED,
        )
        .with_for_update()
    ).scalar_one_or_none()

    if slot is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No reserved hiring slot found for this application; cannot mark Joined",
        )

    slot.status = HiringSlotStatusEnum.FILLED
    slot.filled_at = datetime.now(timezone.utc)

    log_event(
        db,
        actor=actor,
        action="HIRING_SLOT_FILLED",
        campus_context_id=application.campus_id,
        entity_type="HiringSlot",
        entity_id=slot.id,
        after_state={"status": slot.status.value},
        request=request,
    )

    approved_vacancy = db.get(ApprovedVacancy, slot.approved_vacancy_id)
    remaining_unfilled = (
        db.execute(
            select(HiringSlot.id).where(
                HiringSlot.approved_vacancy_id == approved_vacancy.id,
                HiringSlot.status != HiringSlotStatusEnum.FILLED,
            )
        )
        .scalars()
        .all()
    )

    if remaining_unfilled:
        return

    now = datetime.now(timezone.utc)
    approved_vacancy.closed_at = now

    job_posting = db.execute(
        select(JobPosting).where(JobPosting.approved_vacancy_id == approved_vacancy.id)
    ).scalar_one_or_none()
    if job_posting is not None:
        job_posting.closed_at = now
        job_posting.is_active = False

    vacancy_request = db.get(VacancyRequest, approved_vacancy.vacancy_request_id)
    vacancy_request.status = VacancyRequestStatusEnum.CLOSED

    log_event(
        db,
        actor=actor,
        action="VACANCY_AUTO_CLOSE",
        campus_context_id=approved_vacancy.campus_id,
        entity_type="ApprovedVacancy",
        entity_id=approved_vacancy.id,
        after_state={"closed_at": now.isoformat()},
        request=request,
    )
    # Module 13 (Notification Agent) is Phase 3 -- log-only stub for now,
    # same pattern as Phase 1's password-reset-email stub.
    print(
        f"[notification-stub] Vacancy request {vacancy_request.id} auto-closed -- "
        f"all {approved_vacancy.total_positions} hiring slot(s) filled."
    )


def transition_application_status(
    db: Session,
    *,
    application: Application,
    new_status: ApplicationStatusEnum,
    actor: User,
    request: Request | None = None,
    reason: str | None = None,
    force: bool = False,
) -> Application:
    current = application.status

    if force and actor.role != UserRoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may force a status correction"
        )

    if current in APPLICATION_TERMINAL_STATUSES and not force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Application is already in a terminal status ({current.value})",
        )

    if new_status == ApplicationStatusEnum.REJECTED and not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A reason is required when rejecting an application",
        )

    if not force and new_status != ApplicationStatusEnum.REJECTED:
        if new_status not in APPLICATION_STATUS_ORDER:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid status transition")
        current_index = APPLICATION_STATUS_ORDER.index(current) if current in APPLICATION_STATUS_ORDER else -1
        new_index = APPLICATION_STATUS_ORDER.index(new_status)
        if new_index <= current_index:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot move from {current.value} to {new_status.value} (not a forward transition)",
            )

    before = _application_snapshot(application)
    application.status = new_status

    if new_status == ApplicationStatusEnum.REJECTED:
        application.rejection_reason = reason
        application.rejected_at = datetime.now(timezone.utc)
        _release_slot_if_reserved(db, application, actor, request)
    elif new_status == ApplicationStatusEnum.SELECTED:
        _reserve_slot(db, application, actor, request)
    elif new_status == ApplicationStatusEnum.JOINED:
        _fill_slot_and_maybe_autoclose(db, application, actor, request)

    log_event(
        db,
        actor=actor,
        action="APPLICATION_STATUS_FORCE_CORRECTION" if force else "APPLICATION_STATUS_TRANSITION",
        campus_context_id=application.campus_id,
        entity_type="Application",
        entity_id=application.id,
        before_state=before,
        after_state=_application_snapshot(application),
        request=request,
    )

    return application


def advance_if_behind(
    db: Session,
    *,
    application: Application,
    target_status: ApplicationStatusEnum,
    actor: User,
    request: Request | None = None,
    reason: str | None = None,
) -> bool:
    """Advance to target_status only if the application hasn't already
    reached or passed it. Used by Offers/Joining routers whose side effects
    (send/accept) should be idempotent with respect to pipeline position
    rather than erroring on an out-of-order call. Returns True if applied."""
    if application.status in APPLICATION_TERMINAL_STATUSES or application.status not in APPLICATION_STATUS_ORDER:
        return False
    current_index = APPLICATION_STATUS_ORDER.index(application.status)
    target_index = APPLICATION_STATUS_ORDER.index(target_status)
    if current_index >= target_index:
        return False
    transition_application_status(
        db, application=application, new_status=target_status, actor=actor, request=request, reason=reason
    )
    return True
