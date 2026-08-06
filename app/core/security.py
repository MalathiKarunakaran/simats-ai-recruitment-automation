import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from app.core.config import settings

_hasher = PasswordHasher()


def hash_password(raw_password: str) -> str:
    return _hasher.hash(raw_password)


def verify_password(raw_password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, raw_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_access_token(*, user_id: UUID, role: str, campus_id: UUID | None) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "campus_id": str(campus_id) if campus_id else None,
        "type": "access",
        # Unique per issuance so two tokens minted in the same second (e.g.
        # login immediately followed by refresh) never collide byte-for-byte.
        "jti": secrets.token_urlsafe(8),
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


def generate_opaque_token() -> str:
    """Raw, URL-safe token handed to the client (refresh / password-reset). Only its hash is stored."""
    return secrets.token_urlsafe(48)


def hash_opaque_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)


def password_reset_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=30)


def generate_otp_code() -> str:
    """6-digit numeric login code -- secrets.randbelow, not random, since
    this is a real auth credential even though it's short-lived."""
    return f"{secrets.randbelow(1_000_000):06d}"


def otp_expiry() -> datetime:
    # Deliberately shorter than password_reset_expiry's 30 minutes -- an OTP
    # is meant to be read and used within the same sitting, not saved for
    # later like a reset link might be.
    return datetime.now(timezone.utc) + timedelta(minutes=10)
