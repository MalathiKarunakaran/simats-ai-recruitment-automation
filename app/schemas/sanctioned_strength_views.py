"""Schemas for the Sanctioned Strength operational views
(app/api/v1/routers/sanctioned_strength.py's `/views/*` endpoints, backed by
app/services/sanctioned_strength_views.py). See that service module's
docstring for every field's derivation and the `status` priority order.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.common import PaginatedResponse


class TeachingStrengthRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sanctioned_strength_id: uuid.UUID
    campus_id: uuid.UUID
    campus_code: str | None
    department_id: uuid.UUID
    department_name: str | None
    designation_id: uuid.UUID
    designation_name: str | None
    location_id: uuid.UUID | None
    location_name: str | None

    approved: int
    working: int
    # approved - working, deliberately signed (not floored at 0) -- see
    # app/services/sanctioned_strength_views.py's module docstring.
    vacancy: int
    # None (not 0.0) when approved == 0.
    filled_pct: float | None
    # One of TEACHING_STRENGTH_STATUS_VALUES -- VACANCY_RECRUITMENT_REQUIRED /
    # FULLY_STAFFED / OVERSTAFFED / APPROVAL_PENDING / INACTIVE.
    status: str

    last_join: date | None
    last_resignation: date | None
    last_updated: datetime


class TeachingStrengthListResponse(PaginatedResponse[TeachingStrengthRow]):
    """Additive on top of PaginatedResponse -- `items`/`total`/`limit`/
    `offset` are unchanged; `status_counts` is a snapshot of
    `{"VACANCY_RECRUITMENT_REQUIRED": n, "FULLY_STAFFED": n, "OVERSTAFFED": n,
    "APPROVAL_PENDING": n, "INACTIVE": n, "ALL": n}` across every active
    filter except `status` itself -- see
    app/services/sanctioned_strength_views.py::list_teaching_strength_rows
    for why this is named `status_counts` rather than reusing
    vacancy_register.py's `category_counts` name."""

    status_counts: dict[str, int]
