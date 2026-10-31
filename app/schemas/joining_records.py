"""Shapes for the joining-records read API (docs/specs/joining-screens.md).

Read-only throughout, like the talent pool's: the sheets are the record and
`services/sheet_sync.py` is the only writer of these four tables, so there
is no Create/Update model here.

`NONE_KEY` ("none") is the key a NULL normalised value is counted under in
every summary dict, and the value the list filters accept to match it, so a
"no category" tile opens exactly the rows it counted.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import TalentPoolSourceTabEnum

NONE_KEY = "none"


class MonthCount(BaseModel):
    month: str  # YYYY-MM
    count: int


class CountItem(BaseModel):
    """One row of a breakdown. `value` is what the list filter takes (the
    stored code, or "none"); `count` is what that filter returns."""

    value: str
    count: int


# --- New Joinees ---------------------------------------------------------------


class JoineeSummary(BaseModel):
    total: int
    by_category: dict[str, int]
    by_employment_state: dict[str, int]
    by_campus: list[CountItem]
    monthly: list[MonthCount]
    undated: int
    # Rows the latest real New Joinees sync flagged (by sheet row number).
    flagged: int
    linked_talent_pool: int
    last_sync_at: datetime | None


class JoineeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bio_id: str | None
    new_bio_id: str | None
    staff_id: str | None
    app_no: str | None
    full_name: str | None
    employee_type_raw: str | None
    category: str | None
    college_raw: str | None
    campus_code: str | None
    status_raw: str | None
    employment_state: str | None
    joined_on: date | None
    joined_on_raw: str | None
    designation: str | None
    department_raw: str | None
    dept_new_raw: str | None
    reporting_to: str | None
    talent_pool_entry_id: uuid.UUID | None
    is_active: bool
    sheet_row_number: int | None


class LinkedTalentPoolEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_tab: TalentPoolSourceTabEnum
    sheet_status: str
    full_name: str
    is_active: bool


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bio_id: str | None
    emp_id: str | None
    full_name: str | None
    order_on: date | None
    order_on_raw: str | None
    probation_end_on: date | None
    probation_end_on_raw: str | None
    order_status: str | None
    order_status_raw: str | None
    outcome: str | None
    outcome_raw: str | None
    id_card: str | None
    food_app: str | None
    arms: str | None
    app_360: str | None
    file_submitted_adfa: str | None
    room_allotted: str | None
    sheet_joinee_id: uuid.UUID | None
    is_active: bool
    sheet_row_number: int | None


class JoineeDetail(JoineeRead):
    interview_on: date | None
    interview_on_raw: str | None
    prov_order_given_on: date | None
    prov_order_given_on_raw: str | None
    send_on: date | None
    send_on_raw: str | None
    received_on: date | None
    received_on_raw: str | None
    relieving_order_submitted: str | None
    original_submitted: str | None
    appointment_order: str | None
    raw: dict
    talent_pool_entry: LinkedTalentPoolEntry | None = None
    provisional_order: OrderRead | None = None


# --- Provisional Orders --------------------------------------------------------


class OrderSummary(BaseModel):
    total: int
    by_order_status: dict[str, int]
    by_outcome: dict[str, int]
    # Relative to `today` (the server's date, returned so the screen can say so).
    probation_due30: int
    probation_overdue: int
    probation_ended: int
    unlinked: int
    today: date
    last_sync_at: datetime | None


# --- New Departments -----------------------------------------------------------


class ApprovedDepartmentRow(BaseModel):
    id: uuid.UUID
    name: str
    notes: str | None
    count: int | None
    count_raw: str | None
    additional_count: int | None
    additional_count_raw: str | None
    approved_total: int
    members: int
    # Members not marked LEFT (on-leave staff still hold the post).
    active: int
    active_additional: int
    left: int
    on_leave: int
    hods: list[str]
    gap: int
    is_active: bool


class UnmatchedDepartmentRow(BaseModel):
    """A Faculty-tab department name that matched no listed approved
    department. "Not set" is the label for a blank Dept cell."""

    name: str
    members: int


class DepartmentsSummary(BaseModel):
    departments: list[ApprovedDepartmentRow]
    unmatched: list[UnmatchedDepartmentRow]
    faculty_total: int
    unmatched_total: int
    last_sync_at: datetime | None


class FacultyRead(BaseModel):
    id: uuid.UUID
    bio_id: str | None
    full_name: str | None
    dept_raw: str | None
    new_department_id: uuid.UUID | None
    department_name: str | None
    role: str | None
    remark_raw: str | None
    status_raw: str | None
    is_additional: bool
    top_dept: bool
    top25_raw: str | None
    employment_state: str | None
    parent_dept_note: str | None
    sheet_joinee_id: uuid.UUID | None
    joinee_name: str | None
    joinee_designation: str | None
    is_active: bool
    sheet_row_number: int | None
