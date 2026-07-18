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
from app.models.enums import EmploymentStatusEnum
from app.models.user import User
from app.services.audit import log_update


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
    return employee
