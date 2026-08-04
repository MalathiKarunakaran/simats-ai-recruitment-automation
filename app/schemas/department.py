import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import StaffRoleCategoryEnum


class DepartmentBase(BaseModel):
    name: str
    code: str | None = None
    category: StaffRoleCategoryEnum | None = None
    parent_group: str | None = None
    is_active: bool = True


class DepartmentCreate(DepartmentBase):
    campus_id: uuid.UUID


class DepartmentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    category: StaffRoleCategoryEnum | None = None
    parent_group: str | None = None
    is_active: bool | None = None


class DepartmentRead(DepartmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
