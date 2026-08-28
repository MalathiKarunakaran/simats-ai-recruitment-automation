import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.enums import StaffRoleCategoryEnum
from app.schemas.common import PaginatedResponse


def _clean_categories(value: list[StaffRoleCategoryEnum] | None) -> list[StaffRoleCategoryEnum] | None:
    """De-duplicate while preserving the caller's order, and reject an
    explicitly empty list.

    A department supporting nothing would silently reject every designation
    aimed at it, so an empty list is always a client mistake -- but `None`
    (the field simply omitted) stays legal and means "don't change this",
    which is what `DepartmentUpdate`'s partial-patch semantics need.
    """
    if value is None:
        return None
    if not value:
        raise ValueError("supported_categories must list at least one staff category")
    seen: dict[StaffRoleCategoryEnum, None] = {}
    for category in value:
        seen.setdefault(category, None)
    return list(seen)


class DepartmentBase(BaseModel):
    name: str
    code: str | None = None
    # Multi-valued as of 2026-08-28: a department may contain TEACHING and
    # NON_TEACHING staff at once. See `Department.supported_categories`.
    supported_categories: list[StaffRoleCategoryEnum] | None = None
    parent_group: str | None = None
    description: str | None = None
    is_active: bool = True

    _clean = field_validator("supported_categories")(_clean_categories)


class DepartmentCreate(DepartmentBase):
    campus_id: uuid.UUID


class DepartmentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    supported_categories: list[StaffRoleCategoryEnum] | None = None
    parent_group: str | None = None
    description: str | None = None
    is_active: bool | None = None

    _clean = field_validator("supported_categories")(_clean_categories)


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
    when a different tab is selected.

    Since a department may support several categories, the per-category
    counts now OVERLAP (a CSE supporting TEACHING and NON_TEACHING is counted
    in both) and therefore no longer sum to `ALL`. `ALL` is a distinct count
    of departments, which is what the "All" tab actually shows -- deliberately
    not the sum, so no department appears twice.
    """

    category_counts: dict[str, int]
