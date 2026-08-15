"""Schemas for the Sanctioned Strength operational views
(app/api/v1/routers/sanctioned_strength.py's `/views/*` endpoints, backed by
app/services/sanctioned_strength_views.py). See that service module's
docstring for every field's derivation and the `status` priority order.

Phase F (glowing-zooming-hamming.md) adds the Non-Teaching sibling of Phase
E's Teaching row/list-response pair. Schema-sharing choice, documented here
since the plan explicitly asked for a judgment call rather than a spec-given
answer: the two **row** schemas share one base class (`_StrengthViewRowBase`)
since every field, type, and docstring is genuinely identical between them --
this is the same read-model grain (one row per current-effective
SanctionedStrength row) with only the `category` filter differing upstream
in the service layer, so duplicating 20 lines of identical field
declarations would be pure copy-paste drift risk with no offsetting clarity
gain. `TeachingStrengthRow`/`NonTeachingStrengthRow` themselves are kept as
two distinct (if trivial) subclasses, not one shared class instantiated
twice: FastAPI/Pydantic's `response_model` on each router handler benefits
from a distinct type name for /docs (Swagger schema browser) and for any
future field divergence between the two views (e.g. if Non-Teaching ever
grows a Non-Teaching-only field) without disturbing Teaching's schema.
The two **list-response** wrappers (`TeachingStrengthListResponse` /
`NonTeachingStrengthListResponse`) are *not* similarly based on one shared
non-generic parent: each is `PaginatedResponse[<its own Row type>]`, and
Pydantic v2 generics don't make a clean common non-generic base for "add a
status_counts field on top of whatever PaginatedResponse[X] this is" without
either re-introducing generics one level up (no real benefit over just
writing the two lines twice) or multiple inheritance across a pydantic
generic model (fragile, and not a pattern used anywhere else in this
codebase's schemas). Two short, near-identical wrapper classes -- each just
adding `status_counts: dict[str, int]` -- was judged the more maintainable,
convention-matching choice than either alternative.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.common import PaginatedResponse


class _StrengthViewRowBase(BaseModel):
    """Shared field set for both the Teaching and Non-Teaching operational
    views -- see this module's docstring for why the two concrete Row
    classes below are thin subclasses rather than one shared class used
    directly."""

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
    # One of TEACHING_STRENGTH_STATUS_VALUES (reused as-is for both views --
    # see app/services/sanctioned_strength_views.py's module docstring) --
    # VACANCY_RECRUITMENT_REQUIRED / FULLY_STAFFED / OVERSTAFFED /
    # APPROVAL_PENDING / INACTIVE.
    status: str

    last_join: date | None
    last_resignation: date | None
    last_updated: datetime


class TeachingStrengthRow(_StrengthViewRowBase):
    pass


class NonTeachingStrengthRow(_StrengthViewRowBase):
    pass


class TeachingStrengthListResponse(PaginatedResponse[TeachingStrengthRow]):
    """Additive on top of PaginatedResponse -- `items`/`total`/`limit`/
    `offset` are unchanged; `status_counts` is a snapshot of
    `{"VACANCY_RECRUITMENT_REQUIRED": n, "FULLY_STAFFED": n, "OVERSTAFFED": n,
    "APPROVAL_PENDING": n, "INACTIVE": n, "ALL": n}` across every active
    filter except `status` itself -- see
    app/services/sanctioned_strength_views.py::list_strength_view_rows
    for why this is named `status_counts` rather than reusing
    vacancy_register.py's `category_counts` name."""

    status_counts: dict[str, int]


class NonTeachingStrengthListResponse(PaginatedResponse[NonTeachingStrengthRow]):
    """Non-Teaching sibling of `TeachingStrengthListResponse` -- identical
    shape and identical `status_counts` semantics, just parametrized on
    `NonTeachingStrengthRow` instead of `TeachingStrengthRow`."""

    status_counts: dict[str, int]
