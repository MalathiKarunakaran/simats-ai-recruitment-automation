import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_current_active_user, get_db, require_roles
from app.models.campus import Campus
from app.models.department import Department
from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.department import DepartmentCreate, DepartmentRead, DepartmentUpdate
from app.services.audit import log_create, log_update

router = APIRouter(prefix="/departments", tags=["departments"])

# Campus HOD lost department-write access with the Department/Designation
# Master rollout (confirmed decision) -- HR Admin deliberately keeps it,
# broader than the literal "Super Admin only" spec text.
_WRITE_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN)


def _department_snapshot(department: Department) -> dict:
    return {
        "campus_id": department.campus_id,
        "name": department.name,
        "code": department.code,
        "category": department.category.value if department.category else None,
        "parent_group": department.parent_group,
        "is_active": department.is_active,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.get("", response_model=PaginatedResponse[DepartmentRead])
def list_departments(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[DepartmentRead]:
    query = db.query(Department)
    if not scope.is_global:
        query = query.filter(Department.campus_id == scope.campus_id)
    total = query.count()
    rows = query.order_by(Department.name).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("", response_model=DepartmentRead, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> Department:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")

    department = Department(
        campus_id=payload.campus_id,
        name=payload.name,
        code=payload.code,
        # category stays optional at the API level (existing RBAC test relies
        # on a category-less payload still reaching the role check rather
        # than 422ing first) -- but the column is NOT NULL, so an omitted
        # category falls back to the same "ambiguous -> NON_TEACHING" default
        # the Phase 1 backfill migration used, rather than passing an
        # explicit None that would bypass the model's own Python-side default.
        category=payload.category or StaffRoleCategoryEnum.NON_TEACHING,
        parent_group=payload.parent_group,
        is_active=payload.is_active,
    )
    db.add(department)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="Department",
        entity=department,
        campus_context_id=department.campus_id,
        after_state=_department_snapshot(department),
        request=request,
    )
    db.commit()
    db.refresh(department)
    return department


@router.patch("/{department_id}", response_model=DepartmentRead)
def update_department(
    department_id: uuid.UUID,
    payload: DepartmentUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> Department:
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before = _department_snapshot(department)
    if payload.name is not None:
        department.name = payload.name
    if payload.code is not None:
        department.code = payload.code
    if payload.category is not None:
        department.category = payload.category
    if payload.parent_group is not None:
        department.parent_group = payload.parent_group
    if payload.is_active is not None:
        department.is_active = payload.is_active

    log_update(
        db,
        actor=current_user,
        entity_type="Department",
        entity=department,
        campus_context_id=department.campus_id,
        before_state=before,
        after_state=_department_snapshot(department),
        request=request,
    )
    db.commit()
    db.refresh(department)
    return department
