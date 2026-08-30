from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class PipelineFunnelStage(BaseModel):
    """One bucket of `DashboardKPIResponse.application_pipeline_funnel` --
    see app/services/reporting.py::get_dashboard_kpis's own comment for the
    exhaustive 12(+legacy)-status -> 7-bucket mapping."""

    stage: str
    count: int


class CriticalVacancyRow(BaseModel):
    """One row of `DashboardKPIResponse.critical_vacancies` -- a
    VACANCY_RECRUITMENT_REQUIRED-status row surfaced from the Sanctioned
    Strength views (see app/services/reporting.py::_critical_vacancy_rows).
    `location` is only ever populated for Housekeeping rows (and optionally
    Teaching/Non-Teaching rows that have a Location set) -- see that
    function's docstring for the Housekeeping field-mapping judgment call."""

    department: str
    designation: str
    location: str | None
    category: str
    vacancy_count: int


class RecentEmployeeEventRow(BaseModel):
    """One row of `DashboardKPIResponse.recent_joins` /
    `.recent_resignations`."""

    employee_name: str
    department: str | None
    designation: str
    campus: str
    date: date


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
    # Phase I (glowing-zooming-hamming.md) Sanctioned Strength dashboard
    # tile -- see app/services/reporting.py::_sanctioned_strength_totals for
    # the aggregation. Unlike category_wise_breakdown, these three DO
    # respect this response's own role_category filter. sanctioned_vacancy_total
    # is deliberately signed (not floored at 0) -- a negative value means the
    # scope in view is net overstaffed overall.
    sanctioned_approved_total: int
    sanctioned_working_total: int
    sanctioned_vacancy_total: int
    # Dashboard-redesign additions (2026-08-30). `recruitment_required_count`
    # counts current-effective sanctioned rows whose vacancy is > 0 -- a COUNT
    # OF ROWS needing recruitment, deliberately not the same thing as
    # `sanctioned_vacancy_total`, which is a signed SUM OF HEADCOUNT and can
    # even be negative when a scope is net overstaffed.
    #
    # pending_requests_count / pending_approvals_count split the two-stage
    # Dean -> HR workflow into NON-OVERLAPPING counts (SUBMITTED awaits a
    # Dean; DEAN_APPROVED awaits HR), so the two KPI cards never
    # double-count one request.
    #
    # The three vacancy_by_* lists share one row shape:
    # {key, label, approved, working, vacancy}, vacancy signed like
    # sanctioned_vacancy_total. See reporting.py::_vacancy_by_dimension.
    recruitment_required_count: int
    pending_requests_count: int
    pending_approvals_count: int
    vacancy_by_department: list[dict[str, Any]]
    vacancy_by_campus: list[dict[str, Any]]
    vacancy_by_category: list[dict[str, Any]]
    # Additive fields (Step 3, dashboard-kpi-additions-backend) -- see
    # app/services/reporting.py::get_dashboard_kpis for each field's own
    # scoping/derivation notes.
    urgent_vacancy_count: int
    application_pipeline_funnel: list[PipelineFunnelStage]
    critical_vacancies: list[CriticalVacancyRow]
    recent_joins: list[RecentEmployeeEventRow]
    recent_resignations: list[RecentEmployeeEventRow]


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
