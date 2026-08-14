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
    # Phase C (glowing-zooming-hamming.md) -- optional for Teaching/
    # Non-Teaching, required for Housekeeping (enforced in the router, since
    # it depends on the resolved designation category, not a static schema
    # rule).
    location_id: uuid.UUID | None = None


class SanctionedStrengthUpdate(BaseModel):
    """Deliberately narrow: only the fields a revision can actually change.
    campus_id/department_id/designation_id/category are immutable after
    creation (a change of key is a new SanctionedStrength row, not an edit
    of this one) -- and none of the Vacancy Register's derived read-model
    fields (approved_count, working_count, etc.) belong on this table at
    all, so there is nothing to accidentally expose here. `location_id` is
    the one exception to "immutable after creation" -- Housekeeping rows may
    need to be re-pointed at a corrected Location without a full new row."""

    approved_strength: int | None = Field(default=None, ge=0)
    effective_from: date | None = None
    remarks: str | None = None
    location_id: uuid.UUID | None = None


class SanctionedStrengthRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    department_id: uuid.UUID
    designation_id: uuid.UUID
    location_id: uuid.UUID | None
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
    Vacancy Register's own vacancy_count.

    `sanctioned_strength_id` is the current-effective SanctionedStrength
    row's own id (None when this designation has never been sanctioned for
    this department -- approved=0 by construction in that case). Phase D's
    frontend needs this to know whether an inline edit/soft-delete/history
    request should target an existing row (PATCH/DELETE/GET .../history) or
    whether "Approved" is still editable-to-create via a fresh POST.

    `effective_from`/`remarks` are the current-effective row's own values
    (None, same as `sanctioned_strength_id`, when this designation has never
    been sanctioned for this department) -- the frontend uses these to
    pre-fill an edit form alongside `approved_strength`, which the PATCH
    endpoint (`SanctionedStrengthUpdate`) has always accepted for all three
    fields.

    `location_id`/`location_name` (Phase C, glowing-zooming-hamming.md) are
    the current-effective row's own `location_id` and the resolved
    Location's `name` -- both None when this designation has never been
    sanctioned for this department, or when the current-effective row has no
    `location_id` set (Teaching/Non-Teaching rows, which stay optional)."""

    designation_id: uuid.UUID
    designation_name: str
    sanctioned_strength_id: uuid.UUID | None
    approved: int
    working: int
    vacancy: int
    effective_from: date | None
    remarks: str | None
    location_id: uuid.UUID | None
    location_name: str | None


class DepartmentDesignationBreakdownResponse(BaseModel):
    items: list[DepartmentDesignationBreakdownRow]


class SanctionedStrengthAvailabilityRead(BaseModel):
    """Phase E's availability strip (GET /sanctioned-strength/availability),
    backed by app/services/sanctioned_strength.py::compute_availability_to_request
    -- the same function app/services/vacancy_workflow.py::submit() calls to
    enforce the "Only N posts available to request" 409. `available_to_request`
    is deliberately not clamped to >= 0 here (unlike `vacant`) -- see that
    function's docstring."""

    approved: int
    working: int
    vacant: int
    already_requested: int
    available_to_request: int
