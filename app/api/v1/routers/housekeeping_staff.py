"""Housekeeping staff roster CRUD (glowing-zooming-hamming.md Phase D) --
structurally the closest template is `app/api/v1/routers/locations.py`
(campus-scoped, soft-delete master-ish data with FKs), same call as this
module's own docstring intent.

Writes are gated to `_WRITE_ROLES` below, not the bare
`SANCTIONED_STRENGTH_WRITE_ROLES` constant -- the Phase D dispatch brief said
to reuse that named constant, but `SANCTIONED_STRENGTH_WRITE_ROLES` itself is
(SUPER_ADMIN, HR_ADMIN) only and predates this epic's plan decision 2 ("HR
Assistant" = RECRUITMENT_OFFICER manages this operational data), which
Phase B's `locations.py` already implements as its own `_WRITE_ROLES =
SUPER_ADMIN, HR_ADMIN, RECRUITMENT_OFFICER`. Corrected post-merge-review to
match that established epic precedent rather than the shared pre-epic
constant literally -- this also makes the campus-scope 404 guard on
PATCH/DELETE actually reachable through a legitimately-authorized caller
(RECRUITMENT_OFFICER is campus-scoped; SUPER_ADMIN/HR_ADMIN are both
GLOBAL_SCOPE_ROLES and couldn't exercise it). The shared
`SANCTIONED_STRENGTH_WRITE_ROLES` constant itself is left untouched -- other
endpoints that already use it directly are out of this phase's scope.

CREATE validates: `designation_id` resolves to a Designation whose category
is HOUSEKEEPING (enforced here, not the DB -- same "validate at the API
layer" choice `sanctioned_strength.py`'s own department/designation category
match already makes), `location_id` resolves to a real Location, and
`(campus_id, bio_id)` isn't already used by another active-or-inactive row
(the DB UniqueConstraint enforces this regardless, but a friendly 409 beats a
raw IntegrityError). DELETE is a soft delete (is_active=False), matching
every other master-data router in this codebase. Every write appends the
standard audit-log entry via log_create/log_update/log_delete.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db, require_roles
from app.models.campus import Campus
from app.models.designation import Designation
from app.models.enums import SANCTIONED_STRENGTH_WRITE_ROLES, HousekeepingShiftEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.housekeeping_staff import HousekeepingStaff
from app.models.location import Location
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.housekeeping_staff import HousekeepingStaffCreate, HousekeepingStaffRead, HousekeepingStaffUpdate
from app.services.audit import log_create, log_delete, log_update

router = APIRouter(prefix="/housekeeping-staff", tags=["housekeeping-staff"])

# Same shape as locations.py's own _WRITE_ROLES -- SANCTIONED_STRENGTH_WRITE_ROLES
# plus RECRUITMENT_OFFICER (see module docstring for why).
_WRITE_ROLES = (*SANCTIONED_STRENGTH_WRITE_ROLES, UserRoleEnum.RECRUITMENT_OFFICER)


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _snapshot(row: HousekeepingStaff) -> dict:
    return {
        "campus_id": row.campus_id,
        "bio_id": row.bio_id,
        "name": row.name,
        "designation_id": row.designation_id,
        "location_id": row.location_id,
        "block": row.block,
        "floor_venue": row.floor_venue,
        "shift": row.shift.value,
        "supervisor": row.supervisor,
        "is_active": row.is_active,
    }


def _get_or_404_scoped(db: Session, housekeeping_staff_id: uuid.UUID, scope: CampusScope) -> HousekeepingStaff:
    row = db.get(HousekeepingStaff, housekeeping_staff_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, row.campus_id)
    return row


def _validate_housekeeping_designation(db: Session, designation_id: uuid.UUID) -> Designation:
    designation = db.get(Designation, designation_id)
    if designation is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown designation_id")
    if designation.category != StaffRoleCategoryEnum.HOUSEKEEPING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Designation category ({designation.category.value}) is not HOUSEKEEPING -- "
                "Housekeeping staff must be assigned a Housekeeping designation."
            ),
        )
    return designation


@router.get("", response_model=PaginatedResponse[HousekeepingStaffRead])
def list_housekeeping_staff(
    campus_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    block: str | None = Query(None),
    shift: HousekeepingShiftEnum | None = Query(None),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[HousekeepingStaffRead]:
    query = db.query(HousekeepingStaff)
    if scope.is_global:
        # Non-global roles are always forced onto their own campus_id below;
        # a global-scope role may optionally narrow to one campus via this
        # query param -- same shape as locations.py's list endpoint.
        if campus_id is not None:
            query = query.filter(HousekeepingStaff.campus_id == campus_id)
    else:
        query = query.filter(HousekeepingStaff.campus_id == scope.campus_id)

    if location_id is not None:
        query = query.filter(HousekeepingStaff.location_id == location_id)
    if block:
        query = query.filter(HousekeepingStaff.block.ilike(f"%{block}%"))
    if shift is not None:
        query = query.filter(HousekeepingStaff.shift == shift)
    if is_active is not None:
        query = query.filter(HousekeepingStaff.is_active == is_active)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            (HousekeepingStaff.name.ilike(pattern)) | (HousekeepingStaff.bio_id.ilike(pattern))
        )

    total = query.count()
    rows = query.order_by(HousekeepingStaff.name).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("", response_model=HousekeepingStaffRead, status_code=status.HTTP_201_CREATED)
def create_housekeeping_staff(
    payload: HousekeepingStaffCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> HousekeepingStaff:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    _validate_housekeeping_designation(db, payload.designation_id)
    if db.get(Location, payload.location_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown location_id")

    existing = (
        db.query(HousekeepingStaff)
        .filter(HousekeepingStaff.campus_id == payload.campus_id, HousekeepingStaff.bio_id == payload.bio_id)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"bio_id '{payload.bio_id}' is already in use on this campus.",
        )

    row = HousekeepingStaff(
        campus_id=payload.campus_id,
        bio_id=payload.bio_id,
        name=payload.name,
        designation_id=payload.designation_id,
        location_id=payload.location_id,
        block=payload.block,
        floor_venue=payload.floor_venue,
        shift=payload.shift,
        supervisor=payload.supervisor,
        is_active=payload.is_active,
        created_by_id=current_user.id,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"bio_id '{payload.bio_id}' is already in use on this campus.",
        )

    log_create(
        db,
        actor=current_user,
        entity_type="HousekeepingStaff",
        entity=row,
        campus_context_id=row.campus_id,
        after_state=_snapshot(row),
        request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{housekeeping_staff_id}", response_model=HousekeepingStaffRead)
def update_housekeeping_staff(
    housekeeping_staff_id: uuid.UUID,
    payload: HousekeepingStaffUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> HousekeepingStaff:
    row = _get_or_404_scoped(db, housekeeping_staff_id, scope)
    before = _snapshot(row)

    if payload.designation_id is not None:
        _validate_housekeeping_designation(db, payload.designation_id)
        row.designation_id = payload.designation_id
    if payload.location_id is not None:
        if db.get(Location, payload.location_id) is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown location_id")
        row.location_id = payload.location_id
    if payload.bio_id is not None and payload.bio_id != row.bio_id:
        existing = (
            db.query(HousekeepingStaff)
            .filter(
                HousekeepingStaff.campus_id == row.campus_id,
                HousekeepingStaff.bio_id == payload.bio_id,
                HousekeepingStaff.id != row.id,
            )
            .first()
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"bio_id '{payload.bio_id}' is already in use on this campus.",
            )
        row.bio_id = payload.bio_id
    if payload.name is not None:
        row.name = payload.name
    if payload.block is not None:
        row.block = payload.block
    if payload.floor_venue is not None:
        row.floor_venue = payload.floor_venue
    if payload.shift is not None:
        row.shift = payload.shift
    if payload.supervisor is not None:
        row.supervisor = payload.supervisor
    if payload.is_active is not None:
        row.is_active = payload.is_active
    row.updated_by_id = current_user.id

    log_update(
        db,
        actor=current_user,
        entity_type="HousekeepingStaff",
        entity=row,
        campus_context_id=row.campus_id,
        before_state=before,
        after_state=_snapshot(row),
        request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{housekeeping_staff_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_housekeeping_staff(
    housekeeping_staff_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> None:
    row = _get_or_404_scoped(db, housekeeping_staff_id, scope)
    before = _snapshot(row)
    row.is_active = False
    row.updated_by_id = current_user.id

    log_delete(
        db,
        actor=current_user,
        entity_type="HousekeepingStaff",
        entity=row,
        campus_context_id=row.campus_id,
        before_state=before,
        request=request,
    )
    db.commit()
