from datetime import datetime
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
    average_time_to_hire_days: float | None
    vacancy_closure_rate_pct: float
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
