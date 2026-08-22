import uuid
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.coordinator_capability_grant import CoordinatorCapabilityGrant
from app.models.enums import GLOBAL_SCOPE_ROLES, CoordinatorCapabilityEnum, PermissionEnum, UserRoleEnum
from app.models.user import User
from app.models.user_department_scope import user_department_scope

__all__ = ["get_db"]

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    from app.core.security import decode_token  # local import avoids a module cycle at import time

    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        raise credentials_exception

    if payload.get("type") != "access":
        raise credentials_exception

    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    user = db.get(User, uuid.UUID(user_id))
    if user is None:
        raise credentials_exception

    return user


# Endpoints a user with must_change_password=True is still allowed to hit --
# just enough to read their own identity, set a new password, and manage
# their session, so a forced-reset user isn't locked out of the app before
# they can comply. Verbatim (method, path) pairs, matched against
# Request.url.path -- keep in sync with how routers are actually registered
# in app/api/v1/api.py (prefix="/api/v1") and app/main.py, not guessed.
_PASSWORD_CHANGE_ALLOWLIST: frozenset[tuple[str, str]] = frozenset(
    {
        ("PATCH", "/api/v1/users/me"),
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/auth/logout"),
        ("POST", "/api/v1/auth/refresh"),
    }
)


def get_current_active_user(
    request: Request, current_user: User = Depends(get_current_user)
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")

    if current_user.must_change_password:
        path = request.url.path.rstrip("/") or "/"
        if (request.method, path) not in _PASSWORD_CHANGE_ALLOWLIST:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="PASSWORD_CHANGE_REQUIRED"
            )

    return current_user


def require_roles(*allowed_roles: UserRoleEnum):
    def _checker(current_user: User = Depends(get_current_active_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return _checker


def require_roles_or_coordinator_capability(capability: CoordinatorCapabilityEnum, *other_allowed_roles: UserRoleEnum):
    """Like require_roles, but a RECRUITMENT_COORDINATOR is additionally
    allowed through if (and only if) they hold a CoordinatorCapabilityGrant
    for `capability` -- every other role in `other_allowed_roles` keeps plain
    unconditional access, unchanged from require_roles. Specific to
    RECRUITMENT_COORDINATOR by design; not a generic multi-role grant system."""

    def _checker(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ) -> User:
        if current_user.role in other_allowed_roles:
            return current_user
        if current_user.role == UserRoleEnum.RECRUITMENT_COORDINATOR:
            has_grant = (
                db.query(CoordinatorCapabilityGrant)
                .filter_by(user_id=current_user.id, capability=capability)
                .first()
                is not None
            )
            if has_grant:
                return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action",
        )

    return _checker


def require_permission(*permissions: PermissionEnum):
    """Like require_roles, but ANY of the given permissions passing has_permission()
    lets the caller through (OR semantics). SUPER_ADMIN bypass lives inside
    has_permission itself, not duplicated here."""

    def _checker(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ) -> User:
        from app.services.permissions import has_permission  # local import avoids a cycle, mirrors get_current_user's own pattern

        if not any(has_permission(db, current_user, p) for p in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return _checker


@dataclass
class CampusScope:
    is_global: bool
    campus_id: uuid.UUID | None


def get_campus_scope(current_user: User = Depends(get_current_active_user)) -> CampusScope:
    if current_user.role in GLOBAL_SCOPE_ROLES:
        return CampusScope(is_global=True, campus_id=None)
    return CampusScope(is_global=False, campus_id=current_user.campus_id)


def enforce_campus_match(scope: CampusScope, resource_campus_id: uuid.UUID | None) -> None:
    """Single-resource guard: 404 (not 403) on cross-campus access so an
    unauthorized caller can't tell the resource exists at all."""
    if scope.is_global:
        return
    if resource_campus_id is None or resource_campus_id != scope.campus_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


@dataclass
class DepartmentScope:
    is_restricted: bool
    department_ids: frozenset[uuid.UUID] | None


def get_department_scope(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> DepartmentScope:
    """Phase 4 of the permission-matrix epic: an opt-in narrowing of
    `GLOBAL_SCOPE_ROLES`' (minus SUPER_ADMIN) organization-wide visibility to
    a specific set of departments, driven entirely by whether the user has
    any `user_department_scope` rows.

    Unlike `CampusScope` (which is a hard split between "global" and "scoped
    to exactly one home campus" for every non-global role), department scope
    is purely additive opt-in narrowing on top of the existing campus-scope
    mechanism: a `GLOBAL_SCOPE_ROLES` user with zero `user_department_scope`
    rows is fully unrestricted here (`is_restricted=False`) -- identical to
    today's behavior before this mechanism existed. Only once at least one
    row exists for that user does this become a real restriction, narrowing
    them to exactly those departments (still AND-combined with whatever
    `CampusScope` already applies, never a replacement for it).

    SUPER_ADMIN is always unrestricted (same unconditional bypass as
    `CampusScope`'s `is_global`), and any role *outside*
    `GLOBAL_SCOPE_ROLES` (e.g. CAMPUS_HOD, RECRUITMENT_OFFICER) is always
    unrestricted by this mechanism too, regardless of whether it happens to
    have `user_department_scope` rows -- that table is also used by the
    pre-existing GET/PUT /users/{id}/department-scope CRUD endpoints for
    other roles (e.g. CAMPUS_HOD), and this dependency deliberately does not
    enforce anything for roles this phase was not asked to cover.
    """
    if current_user.role == UserRoleEnum.SUPER_ADMIN or current_user.role not in GLOBAL_SCOPE_ROLES:
        return DepartmentScope(is_restricted=False, department_ids=None)
    rows = (
        db.execute(
            select(user_department_scope.c.department_id).where(
                user_department_scope.c.user_id == current_user.id
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return DepartmentScope(is_restricted=False, department_ids=None)
    return DepartmentScope(is_restricted=True, department_ids=frozenset(rows))


def enforce_department_match(scope: DepartmentScope, resource_department_id: uuid.UUID | None) -> None:
    """Single-resource guard, same 404-not-403 shape as `enforce_campus_match`
    -- an unauthorized caller can't tell the resource exists at all. A no-op
    when `scope.is_restricted` is False (the common case: SUPER_ADMIN, any
    non-`GLOBAL_SCOPE_ROLES` role, or a `GLOBAL_SCOPE_ROLES` user with no
    configured `user_department_scope` rows)."""
    if not scope.is_restricted:
        return
    if resource_department_id is None or resource_department_id not in scope.department_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
