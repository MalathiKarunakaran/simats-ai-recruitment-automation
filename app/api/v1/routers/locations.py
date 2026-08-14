"""Location Master (glowing-zooming-hamming.md Phase B), extended in Phase C
with a DELETE dependency guard once `SanctionedStrength.location_id` exists.
DELETE below is blocked (409) while any active SanctionedStrength row still
references this location, mirroring `sanctioned_strength.py`'s own
`working_count_for()`-based delete guard and `departments.py`'s delete-guard
message style.

Structurally the closest template is `app/api/v1/routers/departments.py`
(campus-scoped, category-carrying, soft-delete master data), with one
deliberate RBAC deviation: write access here also includes
RECRUITMENT_OFFICER, mapping the original spec's "HR Assistant" role onto
this codebase's existing RECRUITMENT_OFFICER role (plan decision 4) -- a
broader write set than Department's own `_WRITE_ROLES`.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db, require_roles
from app.models.campus import Campus
from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.location import Location
from app.models.sanctioned_strength import SanctionedStrength
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.location import LocationCreate, LocationRead, LocationUpdate
from app.services.audit import log_create, log_delete, log_update

router = APIRouter(prefix="/locations", tags=["locations"])

# Same shape as departments.py's _WRITE_ROLES, plus RECRUITMENT_OFFICER --
# a deliberate, plan-confirmed deviation (glowing-zooming-hamming.md decision
# 4): the spec's "HR Assistant" role maps onto RECRUITMENT_OFFICER, which
# gets direct write/deactivate access here (unlike Department/Designation).
_WRITE_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_OFFICER)


def _location_snapshot(location: Location) -> dict:
    return {
        "campus_id": location.campus_id,
        "name": location.name,
        "block_building": location.block_building,
        "floor_venue": location.floor_venue,
        "category": location.category.value if location.category else None,
        "is_active": location.is_active,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _get_or_404_scoped(db: Session, location_id: uuid.UUID, scope: CampusScope) -> Location:
    location = db.get(Location, location_id)
    if location is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, location.campus_id)
    return location


@router.get("", response_model=PaginatedResponse[LocationRead])
def list_locations(
    campus_id: uuid.UUID | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    search: str | None = Query(None),
    include_inactive: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[LocationRead]:
    query = db.query(Location)
    if scope.is_global:
        # Non-global roles are always forced onto their own campus_id below;
        # a global-scope role may optionally narrow to one campus via this
        # query param.
        if campus_id is not None:
            query = query.filter(Location.campus_id == campus_id)
    else:
        query = query.filter(Location.campus_id == scope.campus_id)

    if category is not None:
        query = query.filter(Location.category == category)
    if search:
        query = query.filter(Location.name.ilike(f"%{search}%"))
    if not include_inactive:
        query = query.filter(Location.is_active.is_(True))

    total = query.count()
    rows = query.order_by(Location.name).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("", response_model=LocationRead, status_code=status.HTTP_201_CREATED)
def create_location(
    payload: LocationCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> Location:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")

    location = Location(
        campus_id=payload.campus_id,
        name=payload.name,
        block_building=payload.block_building,
        floor_venue=payload.floor_venue,
        category=payload.category,
        is_active=payload.is_active,
    )
    db.add(location)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="Location",
        entity=location,
        campus_context_id=location.campus_id,
        after_state=_location_snapshot(location),
        request=request,
    )
    db.commit()
    db.refresh(location)
    return location


@router.patch("/{location_id}", response_model=LocationRead)
def update_location(
    location_id: uuid.UUID,
    payload: LocationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Location:
    location = _get_or_404_scoped(db, location_id, scope)

    before = _location_snapshot(location)
    if payload.name is not None:
        location.name = payload.name
    if payload.block_building is not None:
        location.block_building = payload.block_building
    if payload.floor_venue is not None:
        location.floor_venue = payload.floor_venue
    if payload.category is not None:
        location.category = payload.category
    if payload.is_active is not None:
        location.is_active = payload.is_active

    log_update(
        db,
        actor=current_user,
        entity_type="Location",
        entity=location,
        campus_context_id=location.campus_id,
        before_state=before,
        after_state=_location_snapshot(location),
        request=request,
    )
    db.commit()
    db.refresh(location)
    return location


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    location_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> None:
    # Phase C (glowing-zooming-hamming.md) dependency guard -- now that
    # SanctionedStrength.location_id exists, block the soft delete while any
    # active SanctionedStrength row still references this location, mirroring
    # departments.py's own delete-guard style (count + 409 message).
    location = _get_or_404_scoped(db, location_id, scope)

    active_sanctioned_strength = (
        db.query(SanctionedStrength)
        .filter(SanctionedStrength.location_id == location.id, SanctionedStrength.is_active.is_(True))
        .count()
    )
    if active_sanctioned_strength > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{active_sanctioned_strength} active sanctioned-strength record(s) reference this "
                "location, cannot delete."
            ),
        )

    before = _location_snapshot(location)
    location.is_active = False

    log_delete(
        db,
        actor=current_user,
        entity_type="Location",
        entity=location,
        campus_context_id=location.campus_id,
        before_state=before,
        request=request,
    )
    db.commit()
