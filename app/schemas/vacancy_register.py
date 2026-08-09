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


class VacancyRegisterRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    department_id: uuid.UUID
    department_name: str
    department_code: str | None
    category: StaffRoleCategoryEnum | None
    is_active: bool
    campus_id: uuid.UUID
    campus_code: str

    working_count: int
    vacancy_count: int
    # Derived (working_count + vacancy_count) -- NOT an independently stored
    # "approved strength" figure; there is no such column anywhere.
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
    approval_status: str

    last_join: date | None
    last_resignation: date | None
    last_updated: datetime
