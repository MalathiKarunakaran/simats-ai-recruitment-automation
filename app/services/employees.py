"""Employee offboarding/separation tracking.

This is a one-way action -- there is no code path back to ACTIVE once an
Employee record is separated -- so it doesn't warrant a full state machine
like vacancy_workflow.py / pipeline.py, but it still needs the same
audit-logging discipline as every other mutation in this app.
"""

from datetime import date

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.enums import EmploymentStatusEnum, VacancyPriorityEnum, VacancyRequestSourceEnum
from app.models.housekeeping_staff import HousekeepingStaff
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services.audit import log_create, log_update


def offboard_employee(
    db: Session,
    *,
    employee: Employee,
    separation_type: EmploymentStatusEnum,
    separation_date: date,
    reason: str,
    actor: User,
    request: Request | None = None,
) -> Employee:
    if employee.employment_status != EmploymentStatusEnum.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Employee is already separated (status: {employee.employment_status.value})",
        )
    if separation_type == EmploymentStatusEnum.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ACTIVE is not a valid separation type",
        )

    before = {
        "employment_status": employee.employment_status.value,
        "separation_date": None,
        "separation_reason": employee.separation_reason,
        "separated_by_id": None,
    }
    employee.employment_status = separation_type
    employee.separation_date = separation_date
    employee.separation_reason = reason
    employee.separated_by_id = actor.id

    log_update(
        db,
        actor=actor,
        entity_type="Employee",
        entity=employee,
        campus_context_id=employee.campus_id,
        before_state=before,
        after_state={
            "employment_status": employee.employment_status.value,
            "separation_date": employee.separation_date.isoformat(),
            "separation_reason": employee.separation_reason,
            "separated_by_id": str(employee.separated_by_id),
        },
        request=request,
    )

    # A Housekeeping hire was put on the housekeeping roster at hand-over
    # (joining.py) and is counted as working from there; leaving the roster
    # row active would keep the vacancy closed after the person has gone.
    roster_row = db.query(HousekeepingStaff).filter(HousekeepingStaff.employee_id == employee.id).first()
    if roster_row is not None and roster_row.is_active:
        roster_row.is_active = False
        roster_row.updated_by_id = actor.id
        log_update(
            db,
            actor=actor,
            entity_type="HousekeepingStaff",
            entity=roster_row,
            campus_context_id=roster_row.campus_id,
            before_state={"is_active": True},
            after_state={"is_active": False, "reason": f"employee {employee.employee_code} offboarded"},
            request=request,
        )
    return employee


def raise_replacement_vacancy_request(
    db: Session,
    *,
    employee: Employee,
    actor: User,
    request: Request | None = None,
) -> VacancyRequest:
    """A one-position DRAFT vacancy request to replace a separated employee
    (2026-09-07, RMS step 7).

    Cloned from the requisition the person was hired against -- the same
    campus, department, designation, title, employment type, qualification,
    experience, salary band and skills -- because that is the post that has
    just fallen vacant, not a guess at one. Count is 1 whatever the original
    asked for. It lands as a DRAFT owned by the offboarding actor and goes
    through the normal submit -> Dean -> HR chain; nothing is auto-submitted,
    since the department may decide not to refill, or to refill differently.
    `remarks` says who left and why, and `replacement_for_employee_id`
    keeps the link queryable.
    """
    if employee.employment_status == EmploymentStatusEnum.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A replacement request can only be raised for a separated employee",
        )
    original = employee.application.job_posting.approved_vacancy.vacancy_request
    department_id = employee.department_id or original.department_id
    designation_id = employee.designation_id or original.designation_id
    separation = employee.employment_status.value.lower()
    when = employee.separation_date.isoformat() if employee.separation_date else "unknown date"
    remarks = (
        f"Replacement for {employee.full_name} ({employee.employee_code}), "
        f"{separation} {when}. Reason: {employee.separation_reason or 'not recorded'}."
    )

    vr = VacancyRequest(
        campus_id=employee.campus_id,
        department_id=department_id,
        designation_id=designation_id,
        role_category=original.role_category,
        position_title=employee.designation or original.position_title,
        employment_type=original.employment_type,
        requested_count=1,
        qualification=original.qualification,
        experience_required=original.experience_required,
        salary_band_min=original.salary_band_min,
        salary_band_max=original.salary_band_max,
        skills=list(original.skills) if original.skills else None,
        priority=VacancyPriorityEnum.NORMAL,
        remarks=remarks,
        source=VacancyRequestSourceEnum.MANUAL,
        location_id=original.location_id,
        requested_by_id=actor.id,
        replacement_for_employee_id=employee.id,
    )
    db.add(vr)
    db.flush()
    log_create(
        db,
        actor=actor,
        entity_type="VacancyRequest",
        entity=vr,
        campus_context_id=vr.campus_id,
        after_state={
            "status": vr.status.value,
            "replacement_for_employee_id": str(employee.id),
            "requested_count": 1,
        },
        request=request,
    )
    return vr
