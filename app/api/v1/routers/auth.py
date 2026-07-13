from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core import security
from app.core.deps import get_current_active_user, get_db
from app.core.rate_limit import RateLimiter
from app.models.auth_token import PasswordResetToken, RefreshToken
from app.models.user import User
from app.schemas.token import (
    LogoutRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    PasswordResetRequestResponse,
    RefreshRequest,
    TokenPair,
)
from app.schemas.user import UserRead
from app.services.audit import log_auth_event

router = APIRouter(prefix="/auth", tags=["auth"])

# Brute-force/enumeration-timing-relevant endpoints only -- not applied
# globally, so legitimate bulk API usage elsewhere is unaffected. 30/min on
# login is generous enough for a busy HR admin driving many short-lived
# tokens through a multi-step workflow in one sitting, while still cutting
# an unrestricted brute-force attempt down by >95%; password-reset-request
# has no legitimate reason for a user to submit many requests rapidly, so
# it stays tighter.
_login_rate_limit = RateLimiter(max_requests=30, window_seconds=60, name="login")
_password_reset_rate_limit = RateLimiter(max_requests=5, window_seconds=60, name="password-reset-request")


def _issue_token_pair(db: Session, user: User, request: Request) -> TokenPair:
    access_token = security.create_access_token(
        user_id=user.id, role=user.role.value, campus_id=user.campus_id
    )
    raw_refresh = security.generate_opaque_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=security.hash_opaque_token(raw_refresh),
            expires_at=security.refresh_token_expiry(),
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    )
    return TokenPair(access_token=access_token, refresh_token=raw_refresh)


@router.post("/login", response_model=TokenPair, dependencies=[Depends(_login_rate_limit)])
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> TokenPair:
    # form_data.username carries the email (OAuth2PasswordRequestForm's field
    # name is fixed as "username" -- this is what makes Swagger's Authorize
    # button work out of the box).
    user = db.query(User).filter(User.email == form_data.username).one_or_none()

    generic_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
    )

    if user is None or not security.verify_password(form_data.password, user.password_hash):
        log_auth_event(db, actor=user, action="LOGIN_FAILED", request=request, status_code=401)
        db.commit()
        raise generic_error

    if not user.is_active:
        log_auth_event(db, actor=user, action="LOGIN_FAILED", request=request, status_code=401)
        db.commit()
        raise generic_error

    user.last_login_at = datetime.now(timezone.utc)
    tokens = _issue_token_pair(db, user, request)
    log_auth_event(db, actor=user, action="LOGIN_SUCCESS", request=request, status_code=200)
    db.commit()
    return tokens


@router.post("/refresh", response_model=TokenPair)
def refresh(
    request: Request,
    payload: RefreshRequest,
    db: Session = Depends(get_db),
) -> TokenPair:
    token_hash = security.hash_opaque_token(payload.refresh_token)
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).one_or_none()

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
    )

    if row is None or not row.is_active or row.expires_at < datetime.now(timezone.utc):
        raise invalid

    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise invalid

    # Rotate: revoke the presented refresh token and issue a brand-new pair.
    row.revoked_at = datetime.now(timezone.utc)
    tokens = _issue_token_pair(db, user, request)
    log_auth_event(db, actor=user, action="TOKEN_REFRESHED", request=request, status_code=200)
    db.commit()
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    payload: LogoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    token_hash = security.hash_opaque_token(payload.refresh_token)
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == token_hash, RefreshToken.user_id == current_user.id)
        .one_or_none()
    )
    if row is not None:
        row.revoked_at = datetime.now(timezone.utc)
    log_auth_event(db, actor=current_user, action="LOGOUT", request=request, status_code=204)
    db.commit()


@router.post(
    "/password-reset-request",
    response_model=PasswordResetRequestResponse,
    dependencies=[Depends(_password_reset_rate_limit)],
)
def password_reset_request(
    request: Request,
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
) -> PasswordResetRequestResponse:
    user = db.query(User).filter(User.email == payload.email).one_or_none()

    if user is not None and user.is_active:
        raw_token = security.generate_opaque_token()
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=security.hash_opaque_token(raw_token),
                expires_at=security.password_reset_expiry(),
            )
        )
        # Phase 1 stub: no email delivery (that's the Notification Agent, a
        # later phase). The raw token is only ever surfaced here for local
        # dev/testing -- never persisted in plaintext.
        print(f"[password-reset-stub] token for {user.email}: {raw_token}")
        log_auth_event(
            db, actor=user, action="PASSWORD_RESET_REQUESTED", request=request, status_code=200
        )

    # Same generic response whether or not the email exists, so this endpoint
    # can't be used to enumerate registered accounts.
    db.commit()
    return PasswordResetRequestResponse()


@router.post("/password-reset-confirm", status_code=status.HTTP_204_NO_CONTENT)
def password_reset_confirm(
    request: Request,
    payload: PasswordResetConfirm,
    db: Session = Depends(get_db),
) -> None:
    token_hash = security.hash_opaque_token(payload.token)
    row = db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == token_hash).one_or_none()

    if row is None or not row.is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    user.password_hash = security.hash_password(payload.new_password)
    row.used_at = datetime.now(timezone.utc)

    # Revoke every active session for this user -- standard practice after a
    # credential reset, and explicitly covered by the Phase 1 test suite.
    active_tokens = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .all()
    )
    for t in active_tokens:
        t.revoked_at = datetime.now(timezone.utc)

    log_auth_event(
        db, actor=user, action="PASSWORD_RESET_CONFIRMED", request=request, status_code=204
    )
    db.commit()


@router.get("/me", response_model=UserRead)
def read_me(current_user: User = Depends(get_current_active_user)) -> User:
    return current_user
