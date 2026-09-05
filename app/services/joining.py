"""Module 10: joining checklist initialization, onboarding completion, and
employee record creation."""

import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.campus import Campus
from app.models.employee import Employee
from app.models.designation import Designation
from app.models.enums import (
    DEFAULT_JOINING_DOCUMENT_TYPES,
    HousekeepingShiftEnum,
    JoiningDocumentStatusEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.housekeeping_staff import HousekeepingStaff
from app.models.joining import JoiningDocument, JoiningRecord
from app.models.location import Location
from app.models.user import User
from app.services import notifications
from app.services.audit import log_create, log_update


def initialize_joining_checklist(
    db: Session,
    *,
    application: Application,
    joining_date: date,
    actor: User,
    request: Request | None = None,
) -> JoiningRecord:
    record = JoiningRecord(application_id=application.id, joining_date=joining_date)
    db.add(record)
    db.flush()

    for document_type in DEFAULT_JOINING_DOCUMENT_TYPES:
        db.add(JoiningDocument(application_id=application.id, document_type=document_type))

    log_create(
        db,
        actor=actor,
        entity_type="JoiningRecord",
        entity=record,
        campus_context_id=application.campus_id,
        after_state={"joining_date": joining_date.isoformat()},
        request=request,
    )
    notifications.notify(
        db,
        recipient_email=application.candidate.email,
        notification_type="JOINING_CHECKLIST_INITIALIZED",
        subject="Joining checklist ready",
        body=f"Your joining checklist has been created. Expected joining date: {joining_date.isoformat()}.",
        campus_context_id=application.campus_id,
        related_entity_type="JoiningRecord",
        related_entity_id=record.id,
        request=request,
    )
    notifications.notify_role(
        db,
        roles={UserRoleEnum.RECRUITMENT_OFFICER},
        campus_id=application.campus_id,
        notification_type="JOINING_CHECKLIST_INITIALIZED",
        subject=f"Joining checklist created: {application.candidate.full_name}",
        body=f"A joining checklist has been created for {application.candidate.full_name}.",
        related_entity_type="JoiningRecord",
        related_entity_id=record.id,
        request=request,
    )
    return record


def complete_onboarding(
    db: Session,
    *,
    application: Application,
    joining_record: JoiningRecord,
    actor: User,
    request: Request | None = None,
) -> JoiningRecord:
    pending = (
        db.execute(
            select(JoiningDocument).where(
                JoiningDocument.application_id == application.id,
                JoiningDocument.status == JoiningDocumentStatusEnum.PENDING,
            )
        )
        .scalars()
        .all()
    )
    if pending:
        pending_types = ", ".join(sorted(d.document_type for d in pending))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot complete onboarding -- documents still pending: {pending_types}",
        )

    before = {"onboarding_completed_at": None, "onboarding_completed_by_id": None}
    joining_record.onboarding_completed_at = datetime.now(timezone.utc)
    joining_record.onboarding_completed_by_id = actor.id
    log_update(
        db,
        actor=actor,
        entity_type="JoiningRecord",
        entity=joining_record,
        campus_context_id=application.campus_id,
        before_state=before,
        after_state={
            "onboarding_completed_at": joining_record.onboarding_completed_at.isoformat(),
            "onboarding_completed_by_id": str(joining_record.onboarding_completed_by_id),
        },
        request=request,
    )

    notifications.notify_role(
        db,
        roles={UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR},
        campus_id=application.campus_id,
        notification_type="ONBOARDING_COMPLETE",
        subject=f"Onboarding complete: {application.candidate.full_name}",
        body=f"Onboarding is complete for {application.candidate.full_name}; ready for employee record creation.",
        related_entity_type="JoiningRecord",
        related_entity_id=joining_record.id,
        request=request,
    )
    return joining_record


def allot_department_room(
    db: Session,
    *,
    application: Application,
    department_id: uuid.UUID,
    room_allotted: str | None,
    actor: User,
    request: Request | None = None,
) -> Application:
    before = {"department_allotted_id": None, "room_allotted": application.room_allotted}
    application.department_allotted_id = department_id
    application.room_allotted = room_allotted
    log_update(
        db,
        actor=actor,
        entity_type="Application",
        entity=application,
        campus_context_id=application.campus_id,
        before_state=before,
        after_state={"department_allotted_id": str(department_id), "room_allotted": room_allotted},
        request=request,
    )
    return application


def complete_orientation(
    db: Session,
    *,
    application: Application,
    orientation_date: date,
    actor: User,
    request: Request | None = None,
) -> Application:
    before = {"orientation_date": None}
    application.orientation_date = orientation_date
    log_update(
        db,
        actor=actor,
        entity_type="Application",
        entity=application,
        campus_context_id=application.campus_id,
        before_state=before,
        after_state={"orientation_date": orientation_date.isoformat()},
        request=request,
    )
    return application


def _generate_employee_code(db: Session, campus: Campus) -> str:
    # Row-locks the campus itself as a simple, correct concurrency guard for
    # per-campus sequence generation -- Phase 2 doesn't have a dedicated
    # sequence table, and campuses are a small, rarely-contended row set.
    db.execute(select(Campus).where(Campus.id == campus.id).with_for_update())
    existing_count = db.execute(
        select(func.count()).select_from(Employee).where(Employee.campus_id == campus.id)
    ).scalar_one()
    return f"{campus.code}-{existing_count + 1:04d}"


def _resolve_designation_id(db: Session, vacancy_request, designation_text: str) -> uuid.UUID | None:
    """The Designation master row a new employee counts against.

    `sanctioned_strength.working_count_for` counts Teaching / Non-Teaching
    employees by `Employee.designation_id`; an employee created without one
    is invisible to every working-strength figure, so a filled vacancy never
    closed the gap on the tracker (found 2026-09-05: production had a
    one-time name-match backfill for old rows and nothing for new hires).
    The vacancy request's own designation wins; failing that, the same
    case-insensitive exact-name match the backfill migration used.
    """
    if vacancy_request.designation_id is not None:
        return vacancy_request.designation_id
    match = (
        db.query(Designation.id)
        .filter(func.lower(Designation.name) == designation_text.strip().lower(), Designation.is_active.is_(True))
        .first()
    )
    return match[0] if match else None


def _validate_housekeeping_roster_input(
    db: Session,
    *,
    application: Application,
    vacancy_request,
    designation_id: uuid.UUID | None,
    bio_id: str | None,
    shift: HousekeepingShiftEnum | None,
    location_id: uuid.UUID | None,
) -> tuple[str, HousekeepingShiftEnum, Location, uuid.UUID]:
    """Everything a HousekeepingStaff row needs, checked BEFORE the employee
    row is created so a refused hand-over leaves nothing behind. Mirrors the
    checks routers/housekeeping_staff.py::create_housekeeping_staff makes
    for a hand-entered row."""
    missing = [name for name, value in (("bio_id", bio_id), ("shift", shift)) if not value]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "A Housekeeping hire is added to the housekeeping roster at hand-over, which needs "
                + " and ".join(missing)
                + "."
            ),
        )
    if designation_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This vacancy has no designation from the Designation master; set one before handing over.",
        )
    designation = db.get(Designation, designation_id)
    if designation is None or designation.category != StaffRoleCategoryEnum.HOUSEKEEPING:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The vacancy's designation is not a HOUSEKEEPING designation.",
        )
    resolved_location_id = location_id or vacancy_request.location_id
    if resolved_location_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A location is required: the vacancy request has none, so pass location_id.",
        )
    location = db.get(Location, resolved_location_id)
    if location is None or location.campus_id != application.campus_id or not location.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown or inactive location_id for this campus"
        )
    duplicate = (
        db.query(HousekeepingStaff.id)
        .filter(HousekeepingStaff.campus_id == application.campus_id, HousekeepingStaff.bio_id == bio_id)
        .first()
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"bio_id '{bio_id}' is already in use on this campus."
        )
    return bio_id, shift, location, designation_id


def create_employee(
    db: Session,
    *,
    application: Application,
    joining_record: JoiningRecord,
    designation: str | None,
    actor: User,
    request: Request | None = None,
    bio_id: str | None = None,
    shift: HousekeepingShiftEnum | None = None,
    location_id: uuid.UUID | None = None,
    supervisor: str | None = None,
) -> Employee:
    campus = application.campus
    candidate = application.candidate
    vacancy_request = application.job_posting.approved_vacancy.vacancy_request
    designation_text = designation or vacancy_request.position_title
    designation_id = _resolve_designation_id(db, vacancy_request, designation_text)

    # Housekeeping staff are counted from their own roster, not from
    # Employee (see HousekeepingStaff's docstring), so a Housekeeping hire
    # must land on that roster or the vacancy it fills never closes. Checked
    # first: nothing below is written if this refuses.
    roster_input = None
    if application.role_category == StaffRoleCategoryEnum.HOUSEKEEPING:
        roster_input = _validate_housekeeping_roster_input(
            db,
            application=application,
            vacancy_request=vacancy_request,
            designation_id=designation_id,
            bio_id=bio_id,
            shift=shift,
            location_id=location_id,
        )

    employee = Employee(
        application_id=application.id,
        employee_code=_generate_employee_code(db, campus),
        campus_id=campus.id,
        # Prefer the department the candidate was actually allotted to over
        # the vacancy's original department -- they can differ in practice.
        department_id=application.department_allotted_id or vacancy_request.department_id,
        full_name=candidate.full_name,
        email=candidate.email,
        phone_number=candidate.phone_number,
        designation=designation_text,
        designation_id=designation_id,
        date_of_joining=joining_record.actual_joining_date or joining_record.joining_date,
    )
    db.add(employee)
    db.flush()

    if roster_input is not None:
        roster_bio_id, roster_shift, location, roster_designation_id = roster_input
        roster_row = HousekeepingStaff(
            campus_id=campus.id,
            bio_id=roster_bio_id,
            name=candidate.full_name,
            designation_id=roster_designation_id,
            location_id=location.id,
            block=location.block_building,
            floor_venue=location.floor_venue,
            shift=roster_shift,
            supervisor=supervisor,
            is_active=True,
            created_by_id=actor.id,
            employee_id=employee.id,
        )
        db.add(roster_row)
        db.flush()
        log_create(
            db,
            actor=actor,
            entity_type="HousekeepingStaff",
            entity=roster_row,
            campus_context_id=campus.id,
            after_state={
                "bio_id": roster_row.bio_id,
                "name": roster_row.name,
                "designation_id": str(roster_row.designation_id),
                "location_id": str(roster_row.location_id),
                "shift": roster_row.shift.value,
                "employee_id": str(employee.id),
                "source": "pipeline hand-over",
            },
            request=request,
        )

    log_create(
        db,
        actor=actor,
        entity_type="Employee",
        entity=employee,
        campus_context_id=campus.id,
        after_state={
            "employee_code": employee.employee_code,
            "designation": employee.designation,
            "designation_id": str(employee.designation_id) if employee.designation_id else None,
        },
        request=request,
    )
    notifications.notify(
        db,
        recipient_email=candidate.email,
        notification_type="EMPLOYEE_CREATED",
        subject="Welcome to SIMATS",
        body=f"Your employee record has been created. Employee code: {employee.employee_code}.",
        campus_context_id=campus.id,
        related_entity_type="Employee",
        related_entity_id=employee.id,
        request=request,
    )
    notifications.notify_role(
        db,
        roles={UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR},
        campus_id=campus.id,
        notification_type="EMPLOYEE_CREATED",
        subject=f"Employee record created: {employee.employee_code}",
        body=f"{candidate.full_name} is now employee {employee.employee_code}.",
        related_entity_type="Employee",
        related_entity_id=employee.id,
        request=request,
    )
    return employee
