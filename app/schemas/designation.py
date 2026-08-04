import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum


class DesignationBase(BaseModel):
    name: str
    category: StaffRoleCategoryEnum
    qualification: str
    min_experience: str
    employment_type: EmploymentTypeEnum
    is_active: bool = True


class DesignationCreate(DesignationBase):
    department_ids: list[uuid.UUID] = Field(default_factory=list)


class DesignationUpdate(BaseModel):
    name: str | None = None
    category: StaffRoleCategoryEnum | None = None
    qualification: str | None = None
    min_experience: str | None = None
    employment_type: EmploymentTypeEnum | None = None
    is_active: bool | None = None
    department_ids: list[uuid.UUID] | None = None


class DesignationRead(DesignationBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    department_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime
