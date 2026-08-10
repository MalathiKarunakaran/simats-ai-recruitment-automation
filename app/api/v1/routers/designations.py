import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.deps import get_current_active_user, get_db, require_roles
from app.models.department import Department
from app.models.designation import Designation
from app.models.enums import DESIGNATION_WRITE_ROLES, StaffRoleCategoryEnum, UserRoleEnum
from app.models.user import User
from app.schemas.designation import DesignationCreate, DesignationListResponse, DesignationRead, DesignationUpdate
from app.services.audit import log_create, log_update

router = APIRouter(prefix="/designations", tags=["designations"])


def _designation_snapshot(designation: Designation) -> dict:
    return {
        "name": designation.name,
        "category": designation.category.value,
        "qualification": designation.qualification,
        "min_experience": designation.min_experience,
        "employment_type": designation.employment_type.value,
        "is_active": designation.is_active,
        "department_ids": [str(department_id) for department_id in designation.department_ids],
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _resolve_departments(db: Session, department_ids: list[uuid.UUID]) -> list[Department]:
    if not department_ids:
        return []
    departments = db.query(Department).filter(Department.id.in_(department_ids)).all()
    found_ids = {department.id for department in departments}
    missing = [str(department_id) for department_id in department_ids if department_id not in found_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown department_id(s): {', '.join(missing)}"
        )
    return departments


@router.get("", response_model=DesignationListResponse)
def list_designations(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    department_id: uuid.UUID | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    is_active: bool | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> DesignationListResponse:
    query = db.query(Designation).options(selectinload(Designation.departments))
    if department_id is not None:
        query = query.filter(Designation.departments.any(Department.id == department_id))
    if is_active is not None:
        query = query.filter(Designation.is_active == is_active)

    # category_counts is computed off this same base query (department_id/
    # is_active applied, category NOT applied) via a cheap GROUP BY, before
    # `category` itself narrows `query` below -- so switching category tabs
    # never changes another tab's displayed count.
    counts_query = query.with_entities(Designation.category, func.count(Designation.id)).group_by(
        Designation.category
    )
    category_counts: dict[str, int] = {member.value: 0 for member in StaffRoleCategoryEnum}
    for row_category, row_count in counts_query.all():
        category_counts[row_category.value] = row_count
    category_counts["ALL"] = sum(category_counts[member.value] for member in StaffRoleCategoryEnum)

    if category is not None:
        query = query.filter(Designation.category == category)
    total = query.count()
    rows = query.order_by(Designation.name).offset(offset).limit(limit).all()
    return DesignationListResponse(items=rows, total=total, limit=limit, offset=offset, category_counts=category_counts)


@router.post("", response_model=DesignationRead, status_code=status.HTTP_201_CREATED)
def create_designation(
    payload: DesignationCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*DESIGNATION_WRITE_ROLES)),
) -> Designation:
    departments = _resolve_departments(db, payload.department_ids)

    designation = Designation(
        name=payload.name,
        category=payload.category,
        qualification=payload.qualification,
        min_experience=payload.min_experience,
        employment_type=payload.employment_type,
        is_active=payload.is_active,
    )
    designation.departments = departments
    db.add(designation)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="Designation",
        entity=designation,
        campus_context_id=None,
        after_state=_designation_snapshot(designation),
        request=request,
    )
    db.commit()
    db.refresh(designation)
    return designation


@router.patch("/{designation_id}", response_model=DesignationRead)
def update_designation(
    designation_id: uuid.UUID,
    payload: DesignationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*DESIGNATION_WRITE_ROLES)),
) -> Designation:
    designation = db.get(Designation, designation_id)
    if designation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before = _designation_snapshot(designation)
    updates = payload.model_dump(exclude_unset=True, exclude={"department_ids"})
    for field, value in updates.items():
        setattr(designation, field, value)

    if payload.department_ids is not None:
        designation.departments = _resolve_departments(db, payload.department_ids)

    log_update(
        db,
        actor=current_user,
        entity_type="Designation",
        entity=designation,
        campus_context_id=None,
        before_state=before,
        after_state=_designation_snapshot(designation),
        request=request,
    )
    db.commit()
    db.refresh(designation)
    return designation
