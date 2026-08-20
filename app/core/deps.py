import uuid
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.coordinator_capability_grant import CoordinatorCapabilityGrant
from app.models.enums import GLOBAL_SCOPE_ROLES, CoordinatorCapabilityEnum, UserRoleEnum
from app.models.user import User

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


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
