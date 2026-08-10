import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum
from app.schemas.common import PaginatedResponse


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


class DesignationListResponse(PaginatedResponse[DesignationRead]):
    """Additive on top of PaginatedResponse -- `items`/`total`/`limit`/
    `offset` are unchanged; `category_counts` is a snapshot of
    `{"TEACHING": n, "NON_TEACHING": n, "HOUSEKEEPING": n, "ALL": n}` across
    every active filter (department_id/is_active) except `category` itself,
    so a CategoryTabs-style UI can show a live count per tab that doesn't
    change when a different tab is selected."""

    category_counts: dict[str, int]
