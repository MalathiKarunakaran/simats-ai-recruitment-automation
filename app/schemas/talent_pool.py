"""Shapes for the talent pool read API (2026-10-23).

Read-only throughout: there is no Create/Update model in this file and that
is deliberate -- the Google Sheet is the system of record, and the only
writer of `talent_pool_entries` is the sync. If a screen ever needs to edit
a pool entry, that is a decision to re-make, not a schema to quietly add.

`TalentPoolEntryRead` omits `content_hash` (sync bookkeeping, meaningless to
a reader) and `raw` (every sheet column, often dozens of keys) so the list
endpoint stays small on 25 rows. `TalentPoolEntryDetail` adds `raw` back for
the single-entry view, which is the one place it is actually rendered.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import TalentPoolSourceTabEnum


class TalentPoolEntryRead(BaseModel):
    """One row of the register. Every modelled column except `raw` and
    `content_hash` -- see the module docstring for why those two are out."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_tab: TalentPoolSourceTabEnum

    full_name: str
    email: str | None
    phone: str | None

    dept_raw: str | None
    dept_group: str | None
    applied_post: str | None
    applied_on: date | None

    sheet_status: str
    status_from_remark: bool
    eligibility: str | None
    eligibility_raw: str | None

    interview_on_raw: str | None
    called_by: str | None
    source: str | None
    remarks: str | None
    resume_url: str | None

    application_id: uuid.UUID | None
    is_active: bool
    sheet_row_number: int | None

    created_at: datetime
    updated_at: datetime


class TalentPoolEntryDetail(TalentPoolEntryRead):
    """The single-entry view, which additionally renders every sheet column
    as header -> value so a column nobody modelled is still visible."""

    raw: dict


class DepartmentRow(BaseModel):
    """One row of the by-department table. `open` counts every status that
    is not Selected / Waiting List / Rejected, which on the teaching tab is
    the same set as Pending but on NTS also sweeps up RNR, On Hold,
    Interview Scheduled, Not Interested and No outcome -- one column, two
    labels, documented here so the two tabs cannot drift apart."""

    department: str
    total: int
    eligible: int
    selected: int
    waiting: int
    rejected: int
    open: int


class MonthlyPoint(BaseModel):
    """`month` is "YYYY-MM". Always 12 of these, oldest first, zeros
    included -- a month with no candidates must still draw a bar, or the
    chart silently rescales and implies a trend that is not there."""

    month: str
    added: int
    selected: int


class BreakdownItem(BaseModel):
    label: str
    count: int


class TalentPoolBreakdowns(BaseModel):
    """Only the lists relevant to the tab are filled; the rest come back as
    empty lists rather than being omitted, so the frontend's types do not
    need to change per tab."""

    source: list[BreakdownItem] = []
    called_by: list[BreakdownItem] = []
    eligibility: list[BreakdownItem] = []
    applied_post: list[BreakdownItem] = []
    call_outcomes: list[BreakdownItem] = []


class TalentPoolSyncInfo(BaseModel):
    """Freshness, read back from the latest TALENT_POOL_SYNCED audit row.

    All three fields are None until a sync has actually run. That is a real
    state, not an error: this step built the read side first, so a fresh
    database legitimately has entries (seeded or imported) and no sync
    history. The frontend's stale-sync banner must therefore treat None as
    "never synced" and not as "stale by an infinite amount".
    """

    last_sync_at: datetime | None = None
    # Shown exactly as the sheet reported it ("14-10-2026, 04.51 pm"), not
    # reformatted -- it is the sheet's own claim about itself, and parsing it
    # into a real datetime would invent a timezone nobody stated.
    sheet_last_update: str | None = None
    last_sync_counts: dict[str, int] | None = None


class TalentPoolSummary(BaseModel):
    source_tab: TalentPoolSourceTabEnum
    total: int

    by_status: dict[str, int]
    by_eligibility: dict[str, int]
    # What "Eligible" counts, returned rather than hardcoded in the UI so the
    # tile's sub-line and the API can never disagree about the definition.
    eligible_definition: list[str]
    eligible_pending: int

    by_department: list[DepartmentRow]
    department_mode: str
    department_count: int

    monthly: list[MonthlyPoint]
    # Entries with no readable date, excluded from `monthly` and reported
    # under the chart so the bars are never quietly short of the total.
    undated: int

    breakdowns: TalentPoolBreakdowns

    last_sync_at: datetime | None = None
    sheet_last_update: str | None = None
    last_sync_counts: dict[str, int] | None = None
