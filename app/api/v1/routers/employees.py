import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import (
    CampusScope,
    DepartmentScope,
    enforce_campus_match,
    enforce_department_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    get_department_scope,
    require_permission,
)
from app.models.employee import Employee
from app.models.enums import EmploymentStatusEnum, PermissionEnum, UserRoleEnum
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.employee import EmployeeOffboardRequest, EmployeeRead
from app.services import employees as employees_service

router = APIRouter(prefix="/employees", tags=["employees"])


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.get("", response_model=PaginatedResponse[EmployeeRead])
def list_employees(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    employment_status: EmploymentStatusEnum | None = Query(None),
    # Phase F (glowing-zooming-hamming.md) -- department_id/designation_id
    # filters, added for the Non-Teaching operational view's
    # expand-to-employee-details use case (see
    # app/api/v1/routers/sanctioned_strength.py's /views/non-teaching
    # endpoint): plain AND-combined equality filters, same shape as the
    # pre-existing employment_status filter just above, applied alongside
    # (not instead of) the existing campus-scope filter below. Additive,
    # backward-compatible -- no existing caller passes these, so omitting
    # them is a no-op.
    department_id: uuid.UUID | None = Query(None),
    designation_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> PaginatedResponse[EmployeeRead]:
    query = db.query(Employee)
    if not scope.is_global:
        query = query.filter(Employee.campus_id == scope.campus_id)
    if scope_dept.is_restricted:
        query = query.filter(Employee.department_id.in_(scope_dept.department_ids))
    if employment_status is not None:
        query = query.filter(Employee.employment_status == employment_status)
    if department_id is not None:
        query = query.filter(Employee.department_id == department_id)
    if designation_id is not None:
        query = query.filter(Employee.designation_id == designation_id)
    total = query.count()
    rows = query.order_by(Employee.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{employee_id}", response_model=EmployeeRead)
def get_employee(
    employee_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, employee.campus_id)
    enforce_department_match(scope_dept, employee.department_id)
    return employee


@router.post("/{employee_id}/offboard", response_model=EmployeeRead)
def offboard_employee(
    employee_id: uuid.UUID,
    payload: EmployeeOffboardRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.EDIT_EMPLOYEES)),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, employee.campus_id)
    enforce_department_match(scope_dept, employee.department_id)

    employees_service.offboard_employee(
        db,
        employee=employee,
        separation_type=payload.separation_type,
        separation_date=payload.separation_date,
        reason=payload.reason,
        actor=current_user,
        request=request,
    )
    db.commit()
    db.refresh(employee)
    return employee
