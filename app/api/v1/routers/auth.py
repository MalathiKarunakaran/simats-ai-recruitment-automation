from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.client_ip import client_ip
from app.core.config import settings
from app.core import security
from app.core.deps import get_current_active_user, get_db
from app.core.rate_limit import RateLimiter
from app.core.session_cookie import (
    clear_refresh_cookie,
    read_refresh_cookie,
    require_csrf_protection,
    set_refresh_cookie,
)
from app.models.auth_token import LoginOtp, PasswordResetToken, RefreshToken
from app.models.user import User
from app.schemas.token import (
    OtpRequest,
    LoginOptionsResponse,
    OtpRequestResponse,
    OtpVerify,
    PasswordResetConfirm,
    PasswordResetRequest,
    PasswordResetRequestResponse,
    TokenPair,
)
from app.schemas.user import UserRead
from app.services.audit import log_auth_event
from app.services.n8n_client import get_n8n_client

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
# otp-request: no legitimate reason to request many codes rapidly, same
# cadence as password-reset-request. otp-verify: tighter than login's 30/min
# on purpose -- a 6-digit code is only ~1M possibilities, so guessing must
# stay impractical even within its own 10-minute expiry window (10/min caps
# a single window to 100 guesses, well under 0.01% coverage).
_otp_request_rate_limit = RateLimiter(max_requests=5, window_seconds=60, name="otp-request")
_otp_verify_rate_limit = RateLimiter(max_requests=10, window_seconds=60, name="otp-verify")


def _issue_token_pair(db: Session, user: User, request: Request, response: Response) -> TokenPair:
    """Mint an access JWT for the body and a rotating refresh token for the
    HttpOnly cookie (audit M1). The raw refresh token goes into the cookie
    on `response` and nowhere else -- only its hash is stored."""
    access_token = security.create_access_token(
        user_id=user.id, role=user.role.value, campus_id=user.campus_id
    )
    raw_refresh = security.generate_opaque_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=security.hash_opaque_token(raw_refresh),
            expires_at=security.refresh_token_expiry(),
            ip_address=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    )
    set_refresh_cookie(response, raw_refresh)
    return TokenPair(
        access_token=access_token,
        must_change_password=user.must_change_password,
    )


@router.post("/login", response_model=TokenPair, dependencies=[Depends(_login_rate_limit)])
def login(
    request: Request,
    response: Response,
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
    tokens = _issue_token_pair(db, user, request, response)
    log_auth_event(db, actor=user, action="LOGIN_SUCCESS", request=request, status_code=200)
    db.commit()
    return tokens


_EMAIL_LOGIN_UNAVAILABLE = (
    "Email login is currently unavailable. Please sign in with your password."
)
_RESET_EMAIL_UNAVAILABLE = (
    "Password reset by email is currently unavailable. Please contact an administrator "
    "to have your password reset."
)


def _require_email_delivery(detail: str) -> None:
    """Audit H1 (2026-09-03). Outside production a missing mail integration
    degrades to printing the secret on the server console so the flow can be
    exercised locally. In production that fallback is forbidden: the request
    is refused up front with a 503 that says what to do instead, BEFORE any
    user lookup, so the answer is identical for known and unknown emails."""
    if settings.is_production and not settings.email_delivery_configured:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


def _deliver_or_stub(webhook: str, payload: dict, *, stub_line: str, unavailable_detail: str) -> None:
    """Send `payload` through the named n8n webhook. If delivery is not
    configured or fails: outside production print `stub_line` (the dev
    console fallback -- the ONLY place a login code or reset token is ever
    written out, and never in production); in production raise 503 so the
    caller is never told something was sent when it was not."""
    client = get_n8n_client()
    if client is not None:
        try:
            client.post_webhook(webhook, payload)
            return
        except httpx.HTTPError:
            if settings.is_production:
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=unavailable_detail)
            # fall through to the dev-visible console line
    if settings.is_production:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=unavailable_detail)
    print(stub_line)


def _send_otp_code(user: User, code: str) -> None:
    _deliver_or_stub(
        "send-otp-email",
        {"to": user.email, "full_name": user.full_name, "code": code},
        stub_line=f"[otp-login-stub] code for {user.email}: {code}",
        unavailable_detail=_EMAIL_LOGIN_UNAVAILABLE,
    )


def _send_password_reset(user: User, raw_token: str) -> None:
    _deliver_or_stub(
        "send-password-reset-email",
        {"to": user.email, "full_name": user.full_name, "token": raw_token},
        stub_line=f"[password-reset-stub] token for {user.email}: {raw_token}",
        unavailable_detail=_RESET_EMAIL_UNAVAILABLE,
    )


@router.get("/login-options", response_model=LoginOptionsResponse)
def login_options() -> LoginOptionsResponse:
    """Public, cheap, unauthenticated: which sign-in methods the login page
    may offer. OTP is reported unavailable when production has no email
    delivery, so the page never shows a button that ends in a 503."""
    return LoginOptionsResponse(otp_email_login=settings.otp_email_login_available)


@router.post(
    "/otp-request",
    response_model=OtpRequestResponse,
    dependencies=[Depends(_otp_request_rate_limit)],
)
def otp_request(
    request: Request,
    payload: OtpRequest,
    db: Session = Depends(get_db),
) -> OtpRequestResponse:
    _require_email_delivery(_EMAIL_LOGIN_UNAVAILABLE)

    user = db.query(User).filter(User.email == payload.email).one_or_none()

    if user is not None and user.is_active:
        code = security.generate_otp_code()
        db.add(
            LoginOtp(
                user_id=user.id,
                code_hash=security.hash_password(code),
                expires_at=security.otp_expiry(),
            )
        )
        _send_otp_code(user, code)
        log_auth_event(db, actor=user, action="OTP_REQUESTED", request=request, status_code=200)

    # Same generic response whether or not the email exists, so this
    # endpoint can't be used to enumerate registered accounts -- identical
    # reasoning to password_reset_request below.
    db.commit()
    return OtpRequestResponse()


@router.post(
    "/otp-verify",
    response_model=TokenPair,
    dependencies=[Depends(_otp_verify_rate_limit)],
)
def otp_verify(
    request: Request,
    response: Response,
    payload: OtpVerify,
    db: Session = Depends(get_db),
) -> TokenPair:
    user = db.query(User).filter(User.email == payload.email).one_or_none()

    generic_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or code"
    )

    if user is None or not user.is_active:
        raise generic_error

    # code_hash isn't uniquely indexed (see LoginOtp's docstring), so check
    # every still-valid row for this user rather than an exact-match lookup.
    candidates = (
        db.query(LoginOtp)
        .filter(LoginOtp.user_id == user.id, LoginOtp.used_at.is_(None))
        .all()
    )
    matched = next(
        (row for row in candidates if row.is_valid and security.verify_password(payload.code, row.code_hash)),
        None,
    )

    if matched is None:
        log_auth_event(db, actor=user, action="LOGIN_FAILED", request=request, status_code=401)
        db.commit()
        raise generic_error

    matched.used_at = datetime.now(timezone.utc)
    user.last_login_at = datetime.now(timezone.utc)
    tokens = _issue_token_pair(db, user, request, response)
    log_auth_event(db, actor=user, action="LOGIN_SUCCESS", request=request, status_code=200)
    db.commit()
    return tokens


@router.post("/refresh", response_model=TokenPair, dependencies=[Depends(require_csrf_protection)])
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenPair:
    """Rotate the session. The refresh token is read from the HttpOnly
    cookie only (audit M1) -- there is no request body. An invalid, expired,
    revoked or missing cookie is a plain logged-out state: 401, and the
    stale cookie is cleared so the browser stops presenting it."""
    def invalid() -> HTTPException:
        # An HTTPException builds its own response, so the cookie-clearing
        # header is handed to it explicitly rather than set on `response`.
        clear_refresh_cookie(response)
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"set-cookie": response.headers["set-cookie"]},
        )

    raw_refresh = read_refresh_cookie(request)
    if raw_refresh is None:
        raise invalid()

    token_hash = security.hash_opaque_token(raw_refresh)
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).one_or_none()

    if row is None or not row.is_active or row.expires_at < datetime.now(timezone.utc):
        raise invalid()

    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise invalid()

    # Rotate: revoke the presented refresh token and issue a brand-new pair.
    row.revoked_at = datetime.now(timezone.utc)
    tokens = _issue_token_pair(db, user, request, response)
    log_auth_event(db, actor=user, action="TOKEN_REFRESHED", request=request, status_code=200)
    db.commit()
    return tokens


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_csrf_protection)],
)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """Revoke the refresh token presented in the cookie (if it is this
    user's) and clear the cookie. Idempotent: a missing or foreign cookie
    still clears and still answers 204."""
    raw_refresh = read_refresh_cookie(request)
    if raw_refresh is not None:
        token_hash = security.hash_opaque_token(raw_refresh)
        row = (
            db.query(RefreshToken)
            .filter(RefreshToken.token_hash == token_hash, RefreshToken.user_id == current_user.id)
            .one_or_none()
        )
        if row is not None:
            row.revoked_at = datetime.now(timezone.utc)
    clear_refresh_cookie(response)
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
    _require_email_delivery(_RESET_EMAIL_UNAVAILABLE)

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
        # Emailed via n8n when configured; printed to the dev console
        # otherwise -- and never printed in production (503 instead). The raw
        # token is never persisted in plaintext.
        _send_password_reset(user, raw_token)
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
