"""Vacancy Register -- a department-level aggregate table (additive,
read-only; no new DB table, mirrors app/schemas/reporting.py's pattern of a
Pydantic response shape over a computed aggregate query).

See app/services/vacancy_register.py for the field derivations -- none of
these (other than the plain Department passthrough fields) are literal
columns.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import StaffRoleCategoryEnum
from app.schemas.common import PaginatedResponse


class VacancyRegisterRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    department_id: uuid.UUID
    department_name: str
    department_code: str | None
    supported_categories: list[StaffRoleCategoryEnum]
    is_active: bool
    campus_id: uuid.UUID
    campus_code: str

    working_count: int
    # max(approved_count - working_count, 0) -- Phase B (zany-snuggling-pie.md):
    # approved_count is now Sanctioned-Strength-backed, not
    # working_count + vacancy_count, so this can differ from the old
    # HiringSlot-derived figure.
    vacancy_count: int
    # SUM(approved_strength) across every current-effective SanctionedStrength
    # row for the department (app.services.sanctioned_strength.
    # current_effective_rows) -- Phase B: a real, independently stored
    # ceiling, no longer working_count + vacancy_count.
    approved_count: int
    # None (not 0.0) when approved_count == 0 -- there's nothing to compute a
    # percentage from, and 0.0 would misleadingly read as "confirmed zero
    # fill rate" (mirrors app/services/reporting.py's vacancy_closure_rate_pct).
    filled_pct: float | None

    requested_count: int
    approved_request_count: int
    jd_posted_count: int
    interviews_count: int
    offers_count: int
    joined_count: int

    recruitment_status: str
    # Phase B: count of VacancyRequests currently "in flight" (SUBMITTED/
    # DEAN_APPROVED/APPROVED/PUBLISHED) for this department -- see
    # app/services/vacancy_register.py's module docstring for why this is an
    # adjacent figure, not a literal "contributed to recruitment_status" count.
    recruitment_status_request_count: int
    approval_status: str
    # Phase B: count of the VacancyRequests that produced whichever
    # approval_status branch was chosen (pending count / all-time rejected
    # count / approved_request_count / 0 for NO_REQUESTS).
    approval_status_request_count: int

    last_join: date | None
    last_resignation: date | None
    last_updated: datetime


class VacancyRegisterListResponse(PaginatedResponse[VacancyRegisterRow]):
    """Additive on top of PaginatedResponse -- `items`/`total`/`limit`/
    `offset` are unchanged; `category_counts` is a snapshot of
    `{"TEACHING": n, "NON_TEACHING": n, "HOUSEKEEPING": n, "ALL": n}` across
    every active filter except `category` itself (see
    app/services/vacancy_register.py::list_vacancy_register_rows), so a
    CategoryTabs-style UI can show a live count per tab that doesn't change
    when a different tab is selected."""

    category_counts: dict[str, int]
