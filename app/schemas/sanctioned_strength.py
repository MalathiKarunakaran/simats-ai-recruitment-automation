"""Schemas for the Sanctioned Strength CRUD + history endpoints
(app/api/v1/routers/sanctioned_strength.py) and the designation-level
breakdown endpoint (app/api/v1/routers/vacancy_register.py, backed by
app/services/sanctioned_strength.py::list_department_designation_breakdown).

See app/models/sanctioned_strength.py for the "current-effective row" rule
and app/services/sanctioned_strength.py for the resolver every read path
shares.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import SanctionedStrengthChangeSourceEnum, StaffRoleCategoryEnum
from app.schemas.common import PaginatedResponse


class SanctionedStrengthCreate(BaseModel):
    campus_id: uuid.UUID
    department_id: uuid.UUID
    designation_id: uuid.UUID
    # `category` is deliberately NOT accepted here -- it's always taken from
    # the designation's own category (and validated to match the
    # department's category, item 6), never client-supplied, so the two can
    # never silently diverge.
    approved_strength: int = Field(ge=0)
    effective_from: date
    remarks: str | None = None


class SanctionedStrengthUpdate(BaseModel):
    """Deliberately narrow: only the 3 fields a revision can actually change.
    campus_id/department_id/designation_id/category are immutable after
    creation (a change of key is a new SanctionedStrength row, not an edit
    of this one) -- and none of the Vacancy Register's derived read-model
    fields (approved_count, working_count, etc.) belong on this table at
    all, so there is nothing to accidentally expose here."""

    approved_strength: int | None = Field(default=None, ge=0)
    effective_from: date | None = None
    remarks: str | None = None


class SanctionedStrengthRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    department_id: uuid.UUID
    designation_id: uuid.UUID
    category: StaffRoleCategoryEnum
    approved_strength: int
    effective_from: date
    remarks: str | None
    is_active: bool
    created_by_id: uuid.UUID
    updated_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class SanctionedStrengthHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sanctioned_strength_id: uuid.UUID
    old_value: int | None
    new_value: int
    changed_by_id: uuid.UUID
    changed_at: datetime
    source: SanctionedStrengthChangeSourceEnum
    bulk_upload_log_id: uuid.UUID | None


class SanctionedStrengthHistoryListResponse(PaginatedResponse[SanctionedStrengthHistoryRead]):
    pass


class DepartmentDesignationBreakdownRow(BaseModel):
    """One row per designation currently linked (via designation_departments)
    to a department -- `approved` is Phase A's current-effective
    SanctionedStrength.approved_strength (0 if this designation has never
    been sanctioned for this department), `working` is a live COUNT(Employee)
    (employment_status == ACTIVE, department_id + designation_id match --
    accurate via Employee.designation_id), `vacancy` is
    `max(approved - working, 0)`, same floor-at-zero convention as the
    Vacancy Register's own vacancy_count."""

    designation_id: uuid.UUID
    designation_name: str
    approved: int
    working: int
    vacancy: int


class DepartmentDesignationBreakdownResponse(BaseModel):
    items: list[DepartmentDesignationBreakdownRow]
