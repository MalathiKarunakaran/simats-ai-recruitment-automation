from pydantic import BaseModel, EmailStr, Field


class TokenPair(BaseModel):
    """The access half of a session. The refresh token travels ONLY in the
    HttpOnly cookie set alongside this body (app/core/session_cookie.py,
    audit M1) -- it is never in a response body, so script never sees it."""

    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetRequestResponse(BaseModel):
    detail: str = "If that email is registered, a password reset link has been generated."


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class OtpRequest(BaseModel):
    email: EmailStr


class OtpRequestResponse(BaseModel):
    detail: str = "If that email is registered, a login code has been sent."


class OtpVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class LoginOptionsResponse(BaseModel):
    """Which sign-in methods the server can honour right now. Read by the
    login page before it offers anything (audit H1, 2026-09-03)."""

    password_login: bool = True
    otp_email_login: bool
