"""Shapes for the joining-records read API (docs/specs/joining-screens.md).

Read-only over the four synced tables, like the talent pool's: the sheets
are the record and `services/sheet_sync.py` is their only writer. The one
write is Step A2's app-owned checklist marks on a provisional order
(`OrderMarksUpdate`), stored in their own table, never in the sheet's.

`NONE_KEY` ("none") is the key a NULL normalised value is counted under in
every summary dict, and the value the list filters accept to match it, so a
"no category" tile opens exactly the rows it counted.
"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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


class MarkedItem(BaseModel):
    """One checklist item of a provisional order (Step A2). `effective` is the
    app mark when there is one, else the sheet's value -- the value every
    tile, filter and screen uses. `sheet` is the sheet's value read the same
    way (Done/Not done as true/false for the five checklist items), and
    `sheet_raw` the sheet's own text. The Registrar order and orientation
    items have no sheet column, so for them `sheet` is always null and
    `source` is "sheet" only in the sense of "no app mark"."""

    effective: bool | date | str | None
    sheet: bool | str | None
    sheet_raw: str | None
    app: bool | date | str | None
    source: Literal["app", "sheet"]
    marked_by: str | None = None
    marked_at: datetime | None = None


class OrderRead(BaseModel):
    """The sheet's columns as synced, plus `items`: every markable field
    (keys = `provisional_order_marks` columns) with its effective value."""

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
    items: dict[str, MarkedItem] = {}


OrderStatusMark = Literal["ISSUED", "PENDING"]
OutcomeMark = Literal[
    "PERMANENT_ORDER_RECEIVED",
    "PROBATION_EXTENDED",
    "NOT_RECOMMENDED",
    "LEFT",
    "REJOIN",
    "TRA",
    "FAMILY_WAY",
    "NO_SUBMIT_PG",
    "LONG_LEAVE",
]


class OrderMarksUpdate(BaseModel):
    """PATCH body. Only the fields SENT are changed; a field sent as null
    clears the app mark (back to the sheet's value). A blank room is a
    clear too."""

    model_config = ConfigDict(extra="forbid")

    id_card_done: bool | None = None
    food_app_done: bool | None = None
    arms_done: bool | None = None
    app_360_done: bool | None = None
    adfa_file_done: bool | None = None
    room_allotted: str | None = Field(None, max_length=255)
    order_status: OrderStatusMark | None = None
    outcome: OutcomeMark | None = None
    registrar_order_issued: bool | None = None
    registrar_order_date: date | None = None
    orientation_conducted: bool | None = None
    orientation_date: date | None = None

    @field_validator("room_allotted")
    @classmethod
    def _blank_room_clears(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


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
    # Step A2's two app-only items; "pending" = not marked yes in the app.
    registrar_order_issued: int
    registrar_order_pending: int
    orientation_conducted: int
    orientation_pending: int
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
    approved: bool = True


class UnmatchedDepartmentRow(BaseModel):
    """A Faculty-tab department name that matched no listed approved
    department. "Not set" is the label for a blank Dept cell. It carries the
    same faculty counts as an approved row; the approved figures (count,
    additional, gap) are null because the Approved_Depts tab has none."""

    name: str
    members: int
    active: int
    active_additional: int
    left: int
    on_leave: int
    hods: list[str]
    approved: bool = False
    count: None = None
    additional_count: None = None
    approved_total: None = None
    gap: None = None


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
