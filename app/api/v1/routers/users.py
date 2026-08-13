import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core import security
from app.core.deps import (
    CampusScope,
    enforce_campus_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    require_roles,
)
from app.models.campus import Campus
from app.models.coordinator_capability_grant import CoordinatorCapabilityGrant
from app.models.department import Department
from app.models.enums import USER_MANAGEMENT_ROLES, CoordinatorCapabilityEnum, UserRoleEnum
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.user import (
    CoordinatorCapabilitiesRead,
    CoordinatorCapabilitiesUpdate,
    UserCreate,
    UserRead,
    UserSelfUpdate,
    UserUpdate,
)
from app.services.audit import log_create, log_update

router = APIRouter(prefix="/users", tags=["users"])


def _user_snapshot(user: User) -> dict:
    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
        "campus_id": user.campus_id,
        "department_id": user.department_id,
        "is_active": user.is_active,
        "phone_number": user.phone_number,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.get("", response_model=PaginatedResponse[UserRead])
def list_users(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[UserRead]:
    query = db.query(User)
    if not scope.is_global:
        query = query.filter(User.campus_id == scope.campus_id)
    total = query.count()
    rows = query.order_by(User.created_at).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*USER_MANAGEMENT_ROLES)),
) -> User:
    if db.query(User).filter(User.email == payload.email).one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    if payload.campus_id is not None and db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    if payload.department_id is not None and db.get(Department, payload.department_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department_id")

    user = User(
        email=payload.email,
        password_hash=security.hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        campus_id=payload.campus_id,
        department_id=payload.department_id,
        phone_number=payload.phone_number,
    )
    db.add(user)
    db.flush()  # populate user.id for the audit row before commit
    log_create(
        db,
        actor=current_user,
        entity_type="User",
        entity=user,
        campus_context_id=user.campus_id,
        after_state=_user_snapshot(user),
        request=request,
    )
    db.commit()
    db.refresh(user)
    return user


@router.get("/me", response_model=UserRead)
def read_own_profile(current_user: User = Depends(get_current_active_user)) -> User:
    return current_user


@router.patch("/me", response_model=UserRead)
def update_own_profile(
    payload: UserSelfUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> User:
    before = _user_snapshot(current_user)
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.phone_number is not None:
        current_user.phone_number = payload.phone_number
    if payload.password is not None:
        current_user.password_hash = security.hash_password(payload.password)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=current_user,
        campus_context_id=current_user.campus_id,
        before_state=before,
        after_state=_user_snapshot(current_user),
        request=request,
    )
    db.commit()
    db.refresh(current_user)
    return current_user


# NOTE: routes below use a /{user_id} path param and must stay declared after
# the /me routes above -- FastAPI matches in declaration order, so /me would
# otherwise be swallowed as an (invalid) UUID path param.


@router.get("/{user_id}", response_model=UserRead)
def get_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    scope: CampusScope = Depends(get_campus_scope),
) -> User:
    if user_id == current_user.id:
        return current_user

    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    enforce_campus_match(scope, target.campus_id)
    return target


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*USER_MANAGEMENT_ROLES)),
) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before = _user_snapshot(target)

    if payload.campus_id is not None and db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    if payload.department_id is not None and db.get(Department, payload.department_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department_id")

    for field in ("full_name", "role", "campus_id", "department_id", "phone_number", "is_active"):
        value = getattr(payload, field)
        if value is not None:
            setattr(target, field, value)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=target,
        campus_context_id=target.campus_id,
        before_state=before,
        after_state=_user_snapshot(target),
        request=request,
    )
    db.commit()
    db.refresh(target)
    return target


def _capabilities_of(db: Session, user_id: uuid.UUID) -> list[CoordinatorCapabilityEnum]:
    rows = db.query(CoordinatorCapabilityGrant).filter(CoordinatorCapabilityGrant.user_id == user_id).all()
    return [row.capability for row in rows]


@router.get("/{user_id}/capabilities", response_model=CoordinatorCapabilitiesRead)
def get_user_capabilities(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> CoordinatorCapabilitiesRead:
    """Readable by SUPER_ADMIN (any user) or by the user themselves (their
    own record only) -- deliberately narrower than get_user's broader
    campus-scoped staff read, since this exposes what a coordinator is
    allowed to do, not just their profile."""
    if user_id != current_user.id and current_user.role != UserRoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return CoordinatorCapabilitiesRead(capabilities=_capabilities_of(db, target.id))


@router.put("/{user_id}/capabilities", response_model=CoordinatorCapabilitiesRead)
def set_user_capabilities(
    user_id: uuid.UUID,
    payload: CoordinatorCapabilitiesUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.SUPER_ADMIN)),
) -> CoordinatorCapabilitiesRead:
    """Full replace: the caller sends the complete desired capability set for
    the target RECRUITMENT_COORDINATOR; the server diffs against current
    grants and adds/removes rows to reach that exact end state in one call."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if target.role != UserRoleEnum.RECRUITMENT_COORDINATOR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Capability grants only apply to RECRUITMENT_COORDINATOR users",
        )

    existing = (
        db.query(CoordinatorCapabilityGrant).filter(CoordinatorCapabilityGrant.user_id == target.id).all()
    )
    existing_by_capability = {row.capability: row for row in existing}
    desired = set(payload.capabilities)

    before = sorted(cap.value for cap in existing_by_capability)

    for capability, row in existing_by_capability.items():
        if capability not in desired:
            db.delete(row)

    for capability in desired:
        if capability not in existing_by_capability:
            db.add(
                CoordinatorCapabilityGrant(
                    user_id=target.id,
                    capability=capability,
                    granted_by_id=current_user.id,
                )
            )

    after = sorted(cap.value for cap in desired)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=target,
        campus_context_id=target.campus_id,
        before_state={"capabilities": before},
        after_state={"capabilities": after},
        request=request,
    )
    db.commit()

    return CoordinatorCapabilitiesRead(capabilities=_capabilities_of(db, target.id))
