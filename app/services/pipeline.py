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
from app.models.appointment_order import APPOINTMENT_ORDER_ISSUED, AppointmentOrder
from app.models.approved_vacancy import ApprovedVacancy
from app.models.enums import (
    APPLICATION_POST_HANDOVER_STATUSES,
    APPLICATION_STATUS_ORDER,
    APPLICATION_TERMINAL_STATUSES,
    ApplicationStatusEnum,
    HiringSlotStatusEnum,
    HodRecommendationEnum,
    RejectionCategoryEnum,
    UserRoleEnum,
    VacancyRequestStatusEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.hod_review import HodReview
from app.models.job_posting import JobPosting
from app.models.permanent_order import PermanentOrder
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services import eligibility, job_channels, notifications
from app.services.audit import log_event


def _application_snapshot(application: Application) -> dict:
    return {
        "status": application.status.value,
        "rejection_reason": application.rejection_reason,
        "withdrawn_reason": application.withdrawn_reason,
        "rejection_category": application.rejection_category.value if application.rejection_category else None,
        "rejected_at_stage": application.rejected_at_stage.value if application.rejected_at_stage else None,
        "waitlist_rank": application.waitlist_rank,
    }


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
        job_posting.close(now)
        job_channels.retire_channels_for_closed_posting(db, job_posting=job_posting, actor=actor, request=request)

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
    notifications.notify_role(
        db,
        roles={UserRoleEnum.HR_ADMIN, UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT, UserRoleEnum.RECRUITMENT_COORDINATOR},
        campus_id=approved_vacancy.campus_id,
        notification_type="VACANCY_AUTO_CLOSE",
        subject=f"Vacancy auto-closed: {vacancy_request.position_title}",
        body=f"All {approved_vacancy.total_positions} hiring slot(s) are now filled -- the vacancy has auto-closed.",
        related_entity_type="ApprovedVacancy",
        related_entity_id=approved_vacancy.id,
        request=request,
    )


def _has_issued_appointment_order(db: Session, application: Application) -> bool:
    return (
        db.execute(
            select(AppointmentOrder.id).where(
                AppointmentOrder.application_id == application.id,
                AppointmentOrder.status == APPOINTMENT_ORDER_ISSUED,
            )
        ).first()
        is not None
    )


def _has_recommend_review(db: Session, application: Application) -> bool:
    return (
        db.execute(
            select(HodReview.id).where(
                HodReview.application_id == application.id,
                HodReview.recommendation == HodRecommendationEnum.RECOMMEND_PERMANENT.value,
            )
        ).first()
        is not None
    )


def _has_permanent_order(db: Session, application: Application) -> bool:
    return (
        db.execute(select(PermanentOrder.id).where(PermanentOrder.application_id == application.id)).first()
        is not None
    )


# HOD review + permanent order (docs/specs/hod-review-and-permanent-order.md):
# each stage is entered only from the one before it and only once its record
# exists (services/hod_reviews.py and services/permanent_orders.py write the
# record first), and no move may jump over it.
_RECORD_GATED_STAGES = (
    (
        ApplicationStatusEnum.HOD_REVIEW_COMPLETE,
        ApplicationStatusEnum.HANDED_OVER_TO_HOD,
        _has_recommend_review,
        "Record a 'Recommend for permanent' HOD review first (POST /applications/{id}/hod-reviews)",
        "the HOD review must be recorded first",
    ),
    (
        ApplicationStatusEnum.PERMANENT_ORDER_ISSUED,
        ApplicationStatusEnum.HOD_REVIEW_COMPLETE,
        _has_permanent_order,
        "Record the permanent order first (POST /applications/{id}/permanent-order)",
        "the permanent order must be recorded first",
    ),
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
    eligibility_override_reason: str | None = None,
    rejection_category: RejectionCategoryEnum | None = None,
    waitlist_rank: int | None = None,
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

    # Handed over = an employee already. Leaving from here is the offboarding
    # action on the employee record, not rejecting or withdrawing the
    # application (these stages were terminal before 31-Oct, so this keeps
    # their hiring slot and the working count exactly as they were).
    if (
        current in APPLICATION_POST_HANDOVER_STATUSES
        and new_status in (ApplicationStatusEnum.REJECTED, ApplicationStatusEnum.WITHDRAWN)
        and not force
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"An application at {current.value} cannot be rejected or withdrawn; "
                "use offboarding on the employee record instead"
            ),
        )

    if new_status == ApplicationStatusEnum.REJECTED and not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A reason is required when rejecting an application",
        )

    if new_status == ApplicationStatusEnum.WITHDRAWN and not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A reason is required when withdrawing an application",
        )

    # Waiting list: entered only from INTERVIEWED, with a rank, and left only
    # by promotion (which needs a reason, for the log), rejection or
    # withdrawal -- never by skipping past SELECTED, which is where the
    # hiring slot is reserved.
    if not force and new_status == ApplicationStatusEnum.WAITLISTED:
        if current != ApplicationStatusEnum.INTERVIEWED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Only an INTERVIEWED application can be waitlisted (this one is {current.value})",
            )
        if waitlist_rank is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A waiting-list rank is required when waitlisting an application",
            )
    if not force and current == ApplicationStatusEnum.WAITLISTED:
        if new_status not in (
            ApplicationStatusEnum.SELECTED,
            ApplicationStatusEnum.REJECTED,
            ApplicationStatusEnum.WITHDRAWN,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A waitlisted application can only be promoted to SELECTED, rejected or withdrawn",
            )
        if new_status == ApplicationStatusEnum.SELECTED and not (reason or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A reason is required when promoting from the waiting list",
            )

    # Provisional appointment order (docs/specs/provisional-order-and-
    # allotment.md): PROVISIONAL_ORDER_ISSUED is entered only from
    # DEPARTMENT_ROOM_ALLOTTED (the department is allotted first so the letter
    # prints it -- user decision 31-Oct) and only once an ISSUED appointment
    # order exists (services/appointment_orders.py creates it first), and no
    # move may jump over it -- so orientation and hand-over need the order.
    # Applications already past it (oriented before the step existed) never
    # cross it again, so they are untouched; one left at
    # DEPARTMENT_ROOM_ALLOTTED needs its order before orientation.
    if not force and new_status in APPLICATION_STATUS_ORDER and current in APPLICATION_STATUS_ORDER:
        order_index = APPLICATION_STATUS_ORDER.index(ApplicationStatusEnum.PROVISIONAL_ORDER_ISSUED)
        current_pos = APPLICATION_STATUS_ORDER.index(current)
        new_pos = APPLICATION_STATUS_ORDER.index(new_status)
        if new_status == ApplicationStatusEnum.PROVISIONAL_ORDER_ISSUED:
            if current != ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "A provisional order can only be issued at DEPARTMENT_ROOM_ALLOTTED "
                        f"(this application is {current.value})"
                    ),
                )
            if not _has_issued_appointment_order(db, application):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Issue the provisional order first (POST /applications/{id}/provisional-order)",
                )
        elif current_pos < order_index < new_pos:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Cannot move from {current.value} to {new_status.value}: "
                    "the provisional order must be issued first"
                ),
            )

    if not force and new_status in APPLICATION_STATUS_ORDER and current in APPLICATION_STATUS_ORDER:
        current_pos = APPLICATION_STATUS_ORDER.index(current)
        new_pos = APPLICATION_STATUS_ORDER.index(new_status)
        for gated, from_status, has_record, missing_detail, skip_reason in _RECORD_GATED_STAGES:
            if new_status == gated:
                if current != from_status:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            f"{gated.value} can only be reached from {from_status.value} "
                            f"(this application is {current.value})"
                        ),
                    )
                if not has_record(db, application):
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=missing_detail)
            elif current_pos < APPLICATION_STATUS_ORDER.index(gated) < new_pos:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot move from {current.value} to {new_status.value}: {skip_reason}",
                )

    if not force and new_status not in (ApplicationStatusEnum.REJECTED, ApplicationStatusEnum.WITHDRAWN):
        if new_status not in APPLICATION_STATUS_ORDER:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid status transition")
        current_index = APPLICATION_STATUS_ORDER.index(current) if current in APPLICATION_STATUS_ORDER else -1
        new_index = APPLICATION_STATUS_ORDER.index(new_status)
        if new_index <= current_index:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot move from {current.value} to {new_status.value} (not a forward transition)",
            )

    # PhD mandate (eligibility.py): a flagged Teaching candidate is not
    # called for interview -- nor moved past that point -- unless HR Admin
    # or Super Admin overrides with a reason, which is audited below.
    # Applies to every path that crosses the interview line, including the
    # auto-advance interviews.py performs when an interview is scheduled.
    interview_index = APPLICATION_STATUS_ORDER.index(ApplicationStatusEnum.CALLED_FOR_INTERVIEW)
    crossing_interview_line = (
        new_status in APPLICATION_STATUS_ORDER
        and APPLICATION_STATUS_ORDER.index(new_status) >= interview_index
        and (current not in APPLICATION_STATUS_ORDER or APPLICATION_STATUS_ORDER.index(current) < interview_index)
    )
    override_applied = False
    if crossing_interview_line and eligibility.is_phd_mandate_flag(application):
        if not (eligibility_override_reason or "").strip():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"{application.qualification_mismatch_reason} "
                    "Pass eligibility_override_reason (HR Admin / Super Admin) to proceed anyway."
                ),
            )
        if actor.role not in (UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only HR Admin or Super Admin may override the PhD eligibility rule",
            )
        override_applied = True

    before = _application_snapshot(application)
    application.status = new_status

    if new_status == ApplicationStatusEnum.WAITLISTED:
        application.waitlist_rank = waitlist_rank

    if new_status == ApplicationStatusEnum.REJECTED:
        application.rejection_reason = reason
        application.rejected_at = datetime.now(timezone.utc)
        application.rejection_category = rejection_category
        application.rejected_at_stage = current
        _release_slot_if_reserved(db, application, actor, request)
        notifications.notify(
            db,
            recipient_email=application.candidate.email,
            notification_type="APPLICATION_REJECTED",
            subject="Application status update",
            body=f"Your application status has been updated to Rejected. Reason: {reason}",
            campus_context_id=application.campus_id,
            related_entity_type="Application",
            related_entity_id=application.id,
            request=request,
        )
    elif new_status == ApplicationStatusEnum.WITHDRAWN:
        application.withdrawn_reason = reason
        application.withdrawn_at = datetime.now(timezone.utc)
        _release_slot_if_reserved(db, application, actor, request)
        notifications.notify(
            db,
            recipient_email=application.candidate.email,
            notification_type="APPLICATION_WITHDRAWN",
            subject="Application status update",
            body=f"Your application has been marked as withdrawn. Reason: {reason}",
            campus_context_id=application.campus_id,
            related_entity_type="Application",
            related_entity_id=application.id,
            request=request,
        )
    elif new_status == ApplicationStatusEnum.SELECTED:
        _reserve_slot(db, application, actor, request)
        notifications.notify(
            db,
            recipient_email=application.candidate.email,
            notification_type="APPLICATION_SELECTED",
            subject="You've been selected",
            body="Congratulations -- you have been selected to move forward in the recruitment process.",
            campus_context_id=application.campus_id,
            related_entity_type="Application",
            related_entity_id=application.id,
            request=request,
        )
    elif new_status == ApplicationStatusEnum.JOINED:
        _fill_slot_and_maybe_autoclose(db, application, actor, request)
        notifications.notify(
            db,
            recipient_email=application.candidate.email,
            notification_type="APPLICATION_JOINED",
            subject="Welcome aboard",
            body="Your joining has been recorded. Welcome to SIMATS!",
            campus_context_id=application.campus_id,
            related_entity_type="Application",
            related_entity_id=application.id,
            request=request,
        )
        notifications.notify_role(
            db,
            roles={UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR},
            campus_id=application.campus_id,
            notification_type="APPLICATION_JOINED",
            subject=f"Candidate joined: {application.candidate.full_name}",
            body=f"{application.candidate.full_name} has joined.",
            related_entity_type="Application",
            related_entity_id=application.id,
            request=request,
        )

    log_event(
        db,
        actor=actor,
        action="APPLICATION_STATUS_FORCE_CORRECTION" if force else "APPLICATION_STATUS_TRANSITION",
        campus_context_id=application.campus_id,
        entity_type="Application",
        entity_id=application.id,
        before_state=before,
        after_state={
            **_application_snapshot(application),
            # Every transition's remarks, not only reject/withdraw's (which
            # the snapshot already carries) -- a waiting-list promotion's
            # reason lives only here.
            **({"reason": reason} if reason else {}),
            **(
                {"eligibility_override_reason": eligibility_override_reason.strip(), "overridden_by": str(actor.id)}
                if override_applied
                else {}
            ),
        },
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
