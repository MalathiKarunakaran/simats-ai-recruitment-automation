"""Sanctioned Strength CRUD + history (zany-snuggling-pie.md Phase B, item
3). Writes are gated to SANCTIONED_STRENGTH_WRITE_ROLES (SUPER_ADMIN/
HR_ADMIN, both GLOBAL_SCOPE_ROLES) -- reads (history) are staff-only, same
`_staff_only` shape as every other master-data router in this codebase.

CREATE validates the designation's category matches the department's
category (item 6 -- a mismatch is a 400, not silently coerced). UPDATE only
ever touches approved_strength/effective_from/remarks -- every other column
(campus_id/department_id/designation_id/category) is immutable after
creation, and none of the Vacancy Register's derived read-model fields
(approved_count etc.) live on this table, so there's nothing else to
accidentally expose here. DELETE is a soft delete (is_active=False, never a
real DELETE) blocked with 409 while the (department, designation) key still
has active employees (item 7). Every write appends a SanctionedStrengthHistory
row (source=MANUAL) and calls the standard audit-log helpers.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db, require_roles
from app.models.campus import Campus
from app.models.department import Department
from app.models.designation import Designation
from app.models.enums import SANCTIONED_STRENGTH_WRITE_ROLES, SanctionedStrengthChangeSourceEnum, UserRoleEnum
from app.models.sanctioned_strength import SanctionedStrength, SanctionedStrengthHistory
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.sanctioned_strength import (
    SanctionedStrengthCreate,
    SanctionedStrengthHistoryRead,
    SanctionedStrengthRead,
    SanctionedStrengthUpdate,
)
from app.services.audit import log_create, log_delete, log_update
from app.services.sanctioned_strength import working_count_for

router = APIRouter(prefix="/sanctioned-strength", tags=["sanctioned-strength"])


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _snapshot(row: SanctionedStrength) -> dict:
    return {
        "campus_id": row.campus_id,
        "department_id": row.department_id,
        "designation_id": row.designation_id,
        "category": row.category.value,
        "approved_strength": row.approved_strength,
        "effective_from": row.effective_from,
        "remarks": row.remarks,
        "is_active": row.is_active,
    }


def _get_or_404_scoped(db: Session, sanctioned_strength_id: uuid.UUID, scope: CampusScope) -> SanctionedStrength:
    row = db.get(SanctionedStrength, sanctioned_strength_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, row.campus_id)
    return row


@router.post("", response_model=SanctionedStrengthRead, status_code=status.HTTP_201_CREATED)
def create_sanctioned_strength(
    payload: SanctionedStrengthCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES)),
) -> SanctionedStrength:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    department = db.get(Department, payload.department_id)
    if department is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department_id")
    designation = db.get(Designation, payload.designation_id)
    if designation is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown designation_id")

    # Item 6: block designations whose category does not match the
    # department's category.
    if designation.category != department.category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Designation category ({designation.category.value}) does not match "
                f"department category ({department.category.value})."
            ),
        )

    row = SanctionedStrength(
        campus_id=payload.campus_id,
        department_id=payload.department_id,
        designation_id=payload.designation_id,
        category=designation.category,
        approved_strength=payload.approved_strength,
        effective_from=payload.effective_from,
        remarks=payload.remarks,
        created_by_id=current_user.id,
    )
    db.add(row)
    db.flush()

    db.add(
        SanctionedStrengthHistory(
            sanctioned_strength_id=row.id,
            old_value=None,
            new_value=row.approved_strength,
            changed_by_id=current_user.id,
            source=SanctionedStrengthChangeSourceEnum.MANUAL,
        )
    )

    log_create(
        db,
        actor=current_user,
        entity_type="SanctionedStrength",
        entity=row,
        campus_context_id=row.campus_id,
        after_state=_snapshot(row),
        request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{sanctioned_strength_id}", response_model=SanctionedStrengthRead)
def update_sanctioned_strength(
    sanctioned_strength_id: uuid.UUID,
    payload: SanctionedStrengthUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> SanctionedStrength:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope)
    before = _snapshot(row)
    old_approved_strength = row.approved_strength

    if payload.approved_strength is not None:
        row.approved_strength = payload.approved_strength
    if payload.effective_from is not None:
        row.effective_from = payload.effective_from
    if payload.remarks is not None:
        row.remarks = payload.remarks
    row.updated_by_id = current_user.id

    # Only write a history row when approved_strength actually changed --
    # editing effective_from/remarks alone is not a strength revision.
    if payload.approved_strength is not None and payload.approved_strength != old_approved_strength:
        db.add(
            SanctionedStrengthHistory(
                sanctioned_strength_id=row.id,
                old_value=old_approved_strength,
                new_value=row.approved_strength,
                changed_by_id=current_user.id,
                source=SanctionedStrengthChangeSourceEnum.MANUAL,
            )
        )

    log_update(
        db,
        actor=current_user,
        entity_type="SanctionedStrength",
        entity=row,
        campus_context_id=row.campus_id,
        before_state=before,
        after_state=_snapshot(row),
        request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{sanctioned_strength_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sanctioned_strength(
    sanctioned_strength_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> None:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope)

    # Item 7: block the soft delete while active employees still occupy this
    # (department, designation) key -- reuses the same COUNT(Employee) the
    # designation breakdown uses, so the two never disagree.
    working = working_count_for(db, department_id=row.department_id, designation_id=row.designation_id)
    if working > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{working} active employee(s) in this designation, cannot delete.",
        )

    before = _snapshot(row)
    row.is_active = False
    row.updated_by_id = current_user.id

    log_delete(
        db,
        actor=current_user,
        entity_type="SanctionedStrength",
        entity=row,
        campus_context_id=row.campus_id,
        before_state=before,
        request=request,
    )
    db.commit()


@router.get("/{sanctioned_strength_id}/history", response_model=PaginatedResponse[SanctionedStrengthHistoryRead])
def list_sanctioned_strength_history(
    sanctioned_strength_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[SanctionedStrengthHistoryRead]:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope)

    query = (
        db.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.sanctioned_strength_id == row.id)
        .order_by(SanctionedStrengthHistory.changed_at.desc())
    )
    total = query.count()
    items = query.offset(offset).limit(limit).all()
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)
