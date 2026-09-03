from pydantic import BaseModel, EmailStr, Field


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


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
