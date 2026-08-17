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

Phase G (glowing-zooming-hamming.md) adds `HousekeepingStrengthRow` /
`HousekeepingStrengthListResponse` for the Location-grained Housekeeping
view. `HousekeepingStrengthRow` is deliberately **NOT** a subclass of
`_StrengthViewRowBase`, unlike Teaching/Non-Teaching -- it's a genuinely
different field set, not a trivial variant: no `department_id`/
`department_name`/`designation_id`/`designation_name`/`sanctioned_strength_id`
at all (this view's row can aggregate more than one SanctionedStrength row
across more than one designation -- there is no single one of any of those
per row; see app/services/sanctioned_strength_views.py's module docstring,
Phase G judgment call #5), `approved`/`working` renamed to `required`/
`available` (this view's own vocabulary, matching the plan's own column
names for this table), a `shifts: list[str]` field with no Teaching/
Non-Teaching analogue, and a `vacancy` that is *floored* at 0 (judgment call
#2 in that same docstring) rather than signed like the shared base class's
`vacancy` field. Forcing this into `_StrengthViewRowBase` (even as a
subclass overriding half the fields) would fight the base class's own
purpose -- documenting one shared 20-field shape -- for no gain, so this row
is its own independent `BaseModel` instead.

`HousekeepingStrengthRow` deliberately has no `last_join`/`last_resignation`/
`last_updated` fields (unlike the shared base class) -- flagged here as a
scope decision, not a silent omission: those three fields' existing
derivation (per-`(department_id, designation_id)` `Employee` aggregation, see
`_StrengthViewRowBase`'s own field comments and
app/services/sanctioned_strength_views.py's Column definitions section) has
no clean analogue at this view's Location grain (an aggregate over N
SanctionedStrength rows across possibly-multiple designations, with
`Employee` not even being the relevant occupancy table for Housekeeping in
the first place -- `HousekeepingStaff` is). Inventing a new "last join/
resignation for this location" derivation was out of scope for what the
Phase G dispatch brief asked for and is flagged here for the human reviewer
to confirm before merge, per that brief's own instruction to flag rather
than silently omit.

Phase K (glowing-zooming-hamming.md) adds the aggregate KPI summary fields
(Approved/Required, Working/Available, Vacancy totals) to all 3 list-response
classes below, additive alongside the existing `status_counts` field. Total
Records / Fully Staffed / Recruitment Required are deliberately NOT
duplicated here -- a caller reads those straight off the existing
`status_counts` dict (`status_counts["ALL"]`, `status_counts["FULLY_STAFFED"]`,
`status_counts["VACANCY_RECRUITMENT_REQUIRED"]`). Each of the 3 response
classes gets its own explicitly-named fields (`approved_total`/
`working_total`/`vacancy_total` for Teaching/Non-Teaching,
`required_total`/`available_total`/`vacancy_total` for Housekeeping) rather
than a shared base class -- matching this module's own stated preference
(see `NonTeachingStrengthListResponse`'s docstring just below: "identical
shape... just parametrized") for light duplication across these 3 response
classes over a shared non-generic base, for the same
Pydantic-v2-generics-don't-compose reason given there. See
app/services/sanctioned_strength_views.py's own docstrings
(`list_strength_view_rows`/`list_housekeeping_strength_rows`) for each
total's exact derivation, in particular why Housekeeping's `vacancy_total`
is computed as `required_total - available_total` directly rather than by
summing each row's own already-floored `vacancy` field.
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
    vacancy_register.py's `category_counts` name.

    `approved_total`/`working_total`/`vacancy_total` (Phase K) are the
    aggregate KPI summary shown above the table, snapshotted at the same
    point as `status_counts` (every filter except `status` already applied).
    `vacancy_total` is a plain sum of each row's own already-signed
    `vacancy` field -- see `list_strength_view_rows`'s own docstring."""

    status_counts: dict[str, int]
    approved_total: int
    working_total: int
    vacancy_total: int


class NonTeachingStrengthListResponse(PaginatedResponse[NonTeachingStrengthRow]):
    """Non-Teaching sibling of `TeachingStrengthListResponse` -- identical
    shape and identical `status_counts`/KPI-total semantics, just
    parametrized on `NonTeachingStrengthRow` instead of `TeachingStrengthRow`."""

    status_counts: dict[str, int]
    approved_total: int
    working_total: int
    vacancy_total: int


class HousekeepingStrengthRow(BaseModel):
    """Phase G's Location-grained Housekeeping row -- see this module's
    docstring for why this is a standalone `BaseModel`, not a
    `_StrengthViewRowBase` subclass, and for the fields deliberately left
    out (department_id/designation_id/sanctioned_strength_id,
    last_join/last_resignation/last_updated)."""

    model_config = ConfigDict(from_attributes=True)

    campus_id: uuid.UUID | None
    campus_code: str | None
    location_id: uuid.UUID
    location_name: str | None
    block: str | None
    floor_venue: str | None
    # Distinct, sorted HousekeepingShiftEnum values (as strings) present
    # among this location's active roster -- [] if the roster is empty. See
    # app/services/sanctioned_strength_views.py's module docstring, Phase G
    # judgment call #4.
    shifts: list[str]

    # SUM(approved_strength) across every current-effective HOUSEKEEPING
    # SanctionedStrength row at this location (judgment call #1).
    required: int
    # Live COUNT of active HousekeepingStaff rows at this location, across
    # every designation there (judgment call #1).
    available: int
    # max(required - available, 0) -- floored, unlike Teaching/Non-Teaching's
    # signed `vacancy` (judgment call #2). `status` below can read
    # OVERSTAFFED even when this field reads 0.
    vacancy: int
    # One of TEACHING_STRENGTH_STATUS_VALUES (reused as-is here too -- see
    # app/services/sanctioned_strength_views.py's module docstring).
    status: str


class HousekeepingStrengthListResponse(PaginatedResponse[HousekeepingStrengthRow]):
    """Housekeeping sibling of `TeachingStrengthListResponse` /
    `NonTeachingStrengthListResponse` -- same additive `status_counts`
    convention, parametrized on `HousekeepingStrengthRow`.

    `required_total`/`available_total`/`vacancy_total` (Phase K) are this
    view's own KPI summary, snapshotted at the same point as
    `status_counts`. `vacancy_total` is deliberately **NOT** the sum of each
    row's own floored `vacancy` field -- it is `required_total -
    available_total`, computed from the two raw sums directly, mirroring
    `app/services/reporting.py`'s `_sanctioned_strength_totals()` (the Phase
    I dashboard tile) exactly. See
    `list_housekeeping_strength_rows`'s own docstring for the full
    reasoning: flooring each row first and summing would systematically
    overstate the aggregate by discarding every overstaffed location's
    negative contribution instead of netting it against real vacancies
    elsewhere -- a negative `vacancy_total` here honestly means "net
    overstaffed across this filtered scope"."""

    status_counts: dict[str, int]
    required_total: int
    available_total: int
    vacancy_total: int
