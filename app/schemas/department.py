import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import StaffRoleCategoryEnum
from app.schemas.common import PaginatedResponse


class DepartmentBase(BaseModel):
    name: str
    code: str | None = None
    category: StaffRoleCategoryEnum | None = None
    parent_group: str | None = None
    description: str | None = None
    is_active: bool = True


class DepartmentCreate(DepartmentBase):
    campus_id: uuid.UUID


class DepartmentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    category: StaffRoleCategoryEnum | None = None
    parent_group: str | None = None
    description: str | None = None
    is_active: bool | None = None


class DepartmentRead(DepartmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class DepartmentListResponse(PaginatedResponse[DepartmentRead]):
    """Additive on top of PaginatedResponse -- `items`/`total`/`limit`/
    `offset` are unchanged; `category_counts` is a snapshot of
    `{"TEACHING": n, "NON_TEACHING": n, "HOUSEKEEPING": n, "ALL": n}` across
    every active filter (search/campus_id/is_active) except `category`
    itself, mirroring `DesignationListResponse`'s own shape exactly so a
    CategoryTabs-style UI can show a live count per tab that doesn't change
    when a different tab is selected."""

    category_counts: dict[str, int]
