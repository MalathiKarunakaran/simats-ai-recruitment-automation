"""Module 2: the Vacancy Request approval-chain state machine, plus creation
of the downstream decomposed entities (ApprovedVacancy + HiringSlots at HR's
final approval; JobPosting at the explicit publish action).
"""

import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.approved_vacancy import ApprovedVacancy
from app.models.enums import (
    HiringSlotStatusEnum,
    UserRoleEnum,
    VacancyRequestSourceEnum,
    VacancyRequestStatusEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.job_posting import JobPosting
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services import notifications
from app.services.audit import log_event
from app.services.sanctioned_strength import compute_availability_to_request, lock_key_for_update


def _snapshot(vacancy_request: VacancyRequest) -> dict:
    return {"status": vacancy_request.status.value}


# Self-approval guard (2026-09-01). Nothing previously stopped the person who
# raised a vacancy request from carrying it through an approval stage
# themselves -- both stages checked the actor's role/permission and never who
# the requester was.
#
# Two deliberate exemptions, both of which would otherwise break a real flow:
#
# * SUPER_ADMIN is the break-glass role. `app/db/seed.py` and a large part of
#   the test suite legitimately drive create -> submit -> approve as one super
#   admin, and locking that out buys nothing a super admin could not undo.
# * QR and BULK_UPLOAD rows, because `requested_by_id` is NOT the person who
#   asked on those. A QR row is attributed to the intake account
#   (`vacancy_request_intake.resolve_intake_user`, which falls back to the
#   longest-standing SUPER_ADMIN) with the real requester recorded only in
#   `requester_name`/`_email`/`_mobile`; a bulk row is attributed to the
#   UPLOADER (see `vacancy_request_import`). Guarding them would lock the
#   intake owner out of every QR request and HR out of every request they
#   uploaded on a department's behalf.
#
# So the guard covers MANUAL rows, where the requester really is a person who
# signed in and raised it.
_SELF_APPROVAL_EXEMPT_SOURCES = frozenset(
    {VacancyRequestSourceEnum.QR, VacancyRequestSourceEnum.BULK_UPLOAD}
)


def _reject_self_approval(vacancy_request: VacancyRequest, actor: User, stage: str) -> None:
    """Refuse when `actor` is the person who raised `vacancy_request`.

    Called AFTER each stage's own status check, so a wrong-status transition
    keeps answering 409 rather than flipping to 403 for the requester alone.
    """
    if actor.role == UserRoleEnum.SUPER_ADMIN:
        return
    if vacancy_request.source in _SELF_APPROVAL_EXEMPT_SOURCES:
        return
    if actor.id != vacancy_request.requested_by_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"You raised this vacancy request and cannot {stage}-approve it yourself",
    )


def submit(
    db: Session,
    vacancy_request: VacancyRequest,
    actor: User,
    request: Request | None,
    *,
    override_sanction: bool = False,
    override_justification: str | None = None,
) -> VacancyRequest:
    """DRAFT -> SUBMITTED, gated by the Sanctioned Strength <->
    VacancyRequest link (zany-snuggling-pie.md Phase E). `override_sanction`/
    `override_justification` are the SUPER_ADMIN-only escape hatch for a
    genuine over-sanction hire (e.g. an emergency replacement) -- anyone
    else attempting to pass `override_sanction=True` gets a 403 regardless
    of whether the block would actually have fired, and a SUPER_ADMIN
    passing it without a non-empty justification gets a 400, matching the
    "attempting it" gating this function's docstring/callers rely on.
    """
    if vacancy_request.status != VacancyRequestStatusEnum.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot submit from status {vacancy_request.status.value}",
        )

    if override_sanction:
        if actor.role != UserRoleEnum.SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a Super Admin can override the sanctioned-strength block.",
            )
        if not override_justification or not override_justification.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="override_justification is required when overriding the sanction block.",
            )

    # Sanctioned Strength is keyed at designation granularity (campus,
    # department, designation) -- see app/models/sanctioned_strength.py. A
    # vacancy request raised without a designation_id (free-text
    # position_title only) has no ceiling to check against, so the block is
    # skipped entirely rather than silently comparing requested_count
    # against a meaningless zero.
    sanction_override_applied = False
    if vacancy_request.designation_id is not None:
        # Serialise concurrent submits for the same key BEFORE reading the
        # availability figure, so the read below and the status write further
        # down are one atomic check-then-act against the ceiling. Without
        # this, two simultaneous submits both read the same in-flight total,
        # both pass, and together exceed the sanction. Held until the
        # caller's commit/rollback. See lock_key_for_update's docstring.
        lock_key_for_update(
            db,
            campus_id=vacancy_request.campus_id,
            department_id=vacancy_request.department_id,
            designation_id=vacancy_request.designation_id,
        )
        availability = compute_availability_to_request(
            db,
            campus_id=vacancy_request.campus_id,
            department_id=vacancy_request.department_id,
            designation_id=vacancy_request.designation_id,
        )
        available_to_request = availability["available_to_request"]
        if vacancy_request.requested_count > available_to_request:
            if not override_sanction:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Only {available_to_request} posts available to request for this designation. "
                        "Raise a sanction revision first."
                    ),
                )
            vacancy_request.is_over_sanction = True
            vacancy_request.over_sanction_justification = override_justification
            sanction_override_applied = True

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
    if sanction_override_applied:
        # Distinct action string (not reusing VACANCY_REQUEST_SUBMITTED) so a
        # SUPER_ADMIN override is independently searchable in Activity Log.
        log_event(
            db,
            actor=actor,
            action="VACANCY_REQUEST_SANCTION_OVERRIDDEN",
            campus_context_id=vacancy_request.campus_id,
            entity_type="VacancyRequest",
            entity_id=vacancy_request.id,
            after_state={
                "requested_count": vacancy_request.requested_count,
                "available_to_request": available_to_request,
                "over_sanction_justification": vacancy_request.over_sanction_justification,
            },
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

    _reject_self_approval(vacancy_request, actor, "Dean")

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
        roles={UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR},
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

    _reject_self_approval(vacancy_request, actor, "HR")

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
        role_category=vacancy_request.role_category,
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
        # A manual/force close can happen with slots still unreserved (e.g.
        # the department no longer needs all sanctioned posts). Those OPEN
        # slots would otherwise dangle forever and keep counting as "open
        # positions" on the dashboard even though this vacancy is no longer
        # actively recruiting -- same slot-row-deletion precedent already
        # used by adjust_slot_count()'s shrink branch above. RESERVED/FILLED
        # slots are left untouched: a RESERVED slot has a real candidate
        # mid-pipeline (offer/joining) and must not be silently orphaned by
        # a close action -- that candidate's application should be
        # rejected/withdrawn through its own flow first.
        stale_open_slots = (
            db.execute(
                select(HiringSlot).where(
                    HiringSlot.approved_vacancy_id == approved_vacancy.id,
                    HiringSlot.status == HiringSlotStatusEnum.OPEN,
                )
            )
            .scalars()
            .all()
        )
        for slot in stale_open_slots:
            db.delete(slot)
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


_CANCEL_TERMINAL_STATUSES = {
    VacancyRequestStatusEnum.CLOSED,
    VacancyRequestStatusEnum.REJECTED,
    VacancyRequestStatusEnum.CANCELLED,
}


def cancel(
    db: Session,
    vacancy_request: VacancyRequest,
    approved_vacancy: ApprovedVacancy | None,
    job_posting: JobPosting | None,
    actor: User,
    reason: str,
    request: Request | None,
) -> VacancyRequest:
    """Admin-initiated soft-cancel of a vacancy request that's no longer
    needed -- a new terminal status distinct from REJECTED (which is only
    reachable pre-HR-approval, during the approval chain) and CLOSED (which
    means the positions were filled). Blocked once any candidate has been
    committed (RESERVED/FILLED slot) -- the admin must reject/withdraw those
    applications first, mirroring the policy already enforced for shrinking
    slot counts."""
    if vacancy_request.status in _CANCEL_TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel from status {vacancy_request.status.value}",
        )

    if approved_vacancy is not None:
        committed_count = len(
            db.execute(
                select(HiringSlot.id).where(
                    HiringSlot.approved_vacancy_id == approved_vacancy.id,
                    HiringSlot.status != HiringSlotStatusEnum.OPEN,
                )
            )
            .scalars()
            .all()
        )
        if committed_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Cannot cancel: {committed_count} slot(s) already reserved or filled. "
                    "Reject or withdraw those candidates first."
                ),
            )

    before = _snapshot(vacancy_request)
    now = datetime.now(timezone.utc)
    vacancy_request.status = VacancyRequestStatusEnum.CANCELLED
    vacancy_request.cancelled_by_id = actor.id
    vacancy_request.cancelled_at = now
    vacancy_request.cancellation_reason = reason

    if approved_vacancy is not None:
        approved_vacancy.closed_at = now
    if job_posting is not None:
        job_posting.closed_at = now
        job_posting.is_active = False

    log_event(
        db,
        actor=actor,
        action="VACANCY_REQUEST_CANCELLED",
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
        notification_type="VACANCY_REQUEST_CANCELLED",
        subject=f"Cancelled: {vacancy_request.position_title}",
        body=f"Your vacancy request for {vacancy_request.position_title} was cancelled. Reason: {reason}",
        campus_context_id=vacancy_request.campus_id,
        related_entity_type="VacancyRequest",
        related_entity_id=vacancy_request.id,
        request=request,
    )
    return vacancy_request


def adjust_slot_count(
    db: Session,
    vacancy_request: VacancyRequest,
    approved_vacancy: ApprovedVacancy,
    new_count: int,
    actor: User,
    request: Request | None,
) -> ApprovedVacancy:
    """Admin-editable position-count adjustment for an already-approved/
    published vacancy, without going through the Excel tracker re-import.
    Shrinking below the number of already-committed (RESERVED/FILLED)
    HiringSlots is blocked -- the admin must reject/withdraw those candidates
    first rather than have slots force-released out from under them."""
    if vacancy_request.status not in (
        VacancyRequestStatusEnum.APPROVED,
        VacancyRequestStatusEnum.PUBLISHED,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Can only adjust slot count for an approved or published vacancy",
        )

    slots = (
        db.execute(
            select(HiringSlot)
            .where(HiringSlot.approved_vacancy_id == approved_vacancy.id)
            .order_by(HiringSlot.slot_number)
        )
        .scalars()
        .all()
    )
    committed_count = sum(1 for slot in slots if slot.status != HiringSlotStatusEnum.OPEN)

    if new_count < committed_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot shrink below {committed_count} slot(s) already reserved or filled",
        )

    current_total = len(slots)
    before = {"total_positions": approved_vacancy.total_positions}

    if new_count > current_total:
        max_slot_number = max((slot.slot_number for slot in slots), default=0)
        for offset in range(1, new_count - current_total + 1):
            db.add(
                HiringSlot(
                    approved_vacancy_id=approved_vacancy.id,
                    slot_number=max_slot_number + offset,
                    status=HiringSlotStatusEnum.OPEN,
                )
            )
        db.flush()
    elif new_count < current_total:
        open_slots_desc = sorted(
            (slot for slot in slots if slot.status == HiringSlotStatusEnum.OPEN),
            key=lambda slot: slot.slot_number,
            reverse=True,
        )
        for slot in open_slots_desc[: current_total - new_count]:
            db.delete(slot)
        db.flush()

    approved_vacancy.total_positions = new_count
    vacancy_request.requested_count = new_count

    log_event(
        db,
        actor=actor,
        action="VACANCY_SLOT_COUNT_ADJUSTED",
        campus_context_id=vacancy_request.campus_id,
        entity_type="ApprovedVacancy",
        entity_id=approved_vacancy.id,
        before_state=before,
        after_state={"total_positions": approved_vacancy.total_positions},
        request=request,
    )

    if vacancy_request.status == VacancyRequestStatusEnum.CLOSED:
        return approved_vacancy

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
        return approved_vacancy

    now = datetime.now(timezone.utc)
    approved_vacancy.closed_at = now
    vacancy_request.status = VacancyRequestStatusEnum.CLOSED

    job_posting = db.execute(
        select(JobPosting).where(JobPosting.approved_vacancy_id == approved_vacancy.id)
    ).scalar_one_or_none()
    if job_posting is not None:
        job_posting.closed_at = now
        job_posting.is_active = False

    log_event(
        db,
        actor=actor,
        action="VACANCY_AUTO_CLOSE",
        campus_context_id=vacancy_request.campus_id,
        entity_type="ApprovedVacancy",
        entity_id=approved_vacancy.id,
        after_state={"closed_at": now.isoformat()},
        request=request,
    )
    notifications.notify_role(
        db,
        roles={UserRoleEnum.HR_ADMIN, UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT, UserRoleEnum.RECRUITMENT_COORDINATOR},
        campus_id=vacancy_request.campus_id,
        notification_type="VACANCY_AUTO_CLOSE",
        subject=f"Vacancy auto-closed: {vacancy_request.position_title}",
        body=f"All {approved_vacancy.total_positions} hiring slot(s) are now filled -- the vacancy has auto-closed.",
        related_entity_type="ApprovedVacancy",
        related_entity_id=approved_vacancy.id,
        request=request,
    )
    return approved_vacancy
