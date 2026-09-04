import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import CoordinatorCapabilityEnum, PermissionEnum, UserRoleEnum

# Audit L2 (2026-09-04): the one password-length rule, applied to every path
# that sets a password -- user creation, self-service change, admin reset and
# the emailed reset. Mirrored in frontend/src/auth/passwordPolicy.ts.
PASSWORD_MIN_LENGTH = 12


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)
    full_name: str
    role: UserRoleEnum
    campus_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    phone_number: str | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: UserRoleEnum | None = None
    campus_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    phone_number: str | None = None
    is_active: bool | None = None


class UserSelfUpdate(BaseModel):
    full_name: str | None = None
    phone_number: str | None = None
    password: str | None = Field(default=None, min_length=PASSWORD_MIN_LENGTH)


class AdminPasswordReset(BaseModel):
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRoleEnum
    campus_id: uuid.UUID | None
    department_id: uuid.UUID | None
    is_active: bool
    is_email_verified: bool
    must_change_password: bool
    deactivation_protected: bool
    phone_number: str | None
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CoordinatorCapabilitiesRead(BaseModel):
    capabilities: list[CoordinatorCapabilityEnum]


class CoordinatorCapabilitiesUpdate(BaseModel):
    """Full-replace request: the caller sends the complete desired set of
    granted capabilities in one call -- the server diffs against the
    current grants and adds/removes rows accordingly (one call = one
    deterministic end state, not a series of individual toggle calls)."""

    capabilities: list[CoordinatorCapabilityEnum]


class UserPermissionsRead(BaseModel):
    permissions: list[PermissionEnum]


class UserPermissionsUpdate(BaseModel):
    """Full-replace request, same semantics as CoordinatorCapabilitiesUpdate."""

    permissions: list[PermissionEnum]


class UserDepartmentScopeRead(BaseModel):
    department_ids: list[uuid.UUID]


class UserDepartmentScopeUpdate(BaseModel):
    """Full-replace request, same semantics as CoordinatorCapabilitiesUpdate."""

    department_ids: list[uuid.UUID]
