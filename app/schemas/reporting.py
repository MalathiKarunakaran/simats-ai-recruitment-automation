from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class DashboardKPIResponse(BaseModel):
    scope_note: str
    total_applications: int
    open_positions: int
    interviews_today: int
    joinings_today: int
    offers_pending: int
    campus_wise_hiring: list[dict[str, Any]]
    # One row per StaffRoleCategoryEnum value (always exactly 3), regardless
    # of this response's own role_category filter -- see the docstring in
    # app/services/reporting.py::get_dashboard_kpis for why this field is
    # deliberately never narrowed by that param, unlike every other field
    # here. Replaces the frontend's old workaround of calling this endpoint
    # 3x (once per role_category) and only reading total_applications.
    category_wise_breakdown: list[dict[str, Any]]
    average_time_to_hire_days: float | None
    # None (not 0.0) when there's no APPROVED-or-beyond vacancy request in
    # scope to compute a rate from -- 0.0 would misleadingly read as "zero
    # closure rate" rather than "not enough data yet" (CLAUDE.md B1).
    vacancy_closure_rate_pct: float | None
    source_wise_breakdown: list[dict[str, Any]]
    rejected_count: int
    withdrawn_count: int


class ReportResponse(BaseModel):
    """One generic shape for all 7 Module-12 report types rather than 7
    near-identical row models -- a pragmatic first cut; each report's row
    shape is documented in app/services/reporting.py next to its builder."""

    scope_note: str
    generated_at: datetime
    rows: list[dict[str, Any]]


class ADBriefingResponse(BaseModel):
    scope_note: str
    generated_at: datetime
    period_label: str
    kpi_headline: dict[str, Any]
    campus_role_breakdown: list[dict[str, Any]]


class WeeklyStatusRow(BaseModel):
    group_label: str
    attended: int
    selected: int
    waiting: int
    rejected: int
    upcoming_join: int | None = None
    joined: int | None = None


class WeeklyRecruitmentStatusResponse(BaseModel):
    scope_note: str
    generated_at: datetime
    period_label: str
    start_date: date
    end_date: date
    total_interviewed: int
    total_selected: int
    total_waiting: int
    total_rejected: int
    total_joined: int
    selection_rate_pct: float | None
    joined_by_category: dict[str, int]
    teaching_rows: list[WeeklyStatusRow]
    non_teaching_rows: list[WeeklyStatusRow]
