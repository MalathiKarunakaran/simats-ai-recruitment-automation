"""Sanctioned Strength operational views (glowing-zooming-hamming.md Phase E)
-- designation-level read-models, one per staff category, sitting alongside
(not replacing) `app/services/vacancy_register.py`'s department-level rollup.

Why a new module rather than extending vacancy_register.py: vacancy_register's
own module docstring frames its whole design (one correlated-subquery outer
SELECT keyed on `Department.id`, Python-side derived-field/filter/sort/
paginate) around a **department** grain. This module's grain is one row per
current-effective `SanctionedStrength` row (i.e. per (campus, department,
designation) key) -- a different anchor entity entirely, with a genuinely
different base query shape (there is no single SQLAlchemy `Select` to anchor
correlated subqueries on here; the base row set comes from
`sanctioned_strength.current_effective_rows`, a list of ORM objects, and
everything else is resolved via batched follow-up queries in Python -- see
`list_teaching_strength_rows` below). Bolting that onto vacancy_register.py
would mean either two unrelated grains sharing one file, or contorting this
view's queries to fit vacancy_register's `Department`-anchored subquery
pattern for no real benefit. A sibling module, explicitly reusing
`current_effective_rows`/`working_count_for` (never reimplementing either),
keeps each grain's own file focused -- matching this codebase's "one file per
concern" convention (see CLAUDE.md's Repo layout section).

Phase E built the TEACHING-only version (`list_teaching_strength_rows`,
`TEACHING_STRENGTH_SORT_FIELDS`, `TEACHING_STRENGTH_STATUS_VALUES`,
`teaching_strength_status`). Phase F (glowing-zooming-hamming.md) generalizes
the read-model into `list_strength_view_rows(..., category=...)` -- the
category filter was already applied as a single Python-side
`row.category == ...` comparison (mirroring vacancy_register.py's own
category-filter placement), so adding a parameter for it was additive, not a
rewrite, exactly as this module anticipated.

Naming/refactor choices made in Phase F (documented here since they were
judgment calls, not spec-given):
- `list_teaching_strength_rows` is kept as a **thin wrapper** around the new
  `list_strength_view_rows(..., category=StaffRoleCategoryEnum.TEACHING)`
  rather than being renamed/removed at every call site. The existing
  `/views/teaching` router handler and every Phase E test call it by this
  exact name -- keeping it means Phase E's tests exercise the identical
  public entry point unchanged (byte-for-byte behavior, not just "equivalent
  behavior"), which is the explicit bar Phase F was told to clear. The new
  `/views/non-teaching` handler calls `list_strength_view_rows` directly with
  `category=StaffRoleCategoryEnum.NON_TEACHING` -- there is no
  "list_non_teaching_strength_rows" wrapper, since that endpoint has no
  pre-existing external name to preserve.
- `teaching_strength_status` -- unlike the list function, this pure function
  took no `category` parameter to begin with (its formula never depended on
  category), so there is nothing to "generalize" here, only to rename now
  that it demonstrably serves two categories: renamed to `strength_row_status`
  everywhere (this module, `tests/test_sanctioned_strength_views.py`'s Phase E
  tests updated to import the new name -- there is no behavior change to
  detect from that, so no "byte for byte" concern applies to a pure rename of
  an internal helper that isn't itself part of any HTTP contract). No thin
  wrapper kept under the old name: it was never a value other phases or the
  frontend called directly (it backs the `status` field on each row, never
  exposed as its own endpoint), so there is no external-compatibility reason
  to alias it.
- `TEACHING_STRENGTH_SORT_FIELDS` / `_SORT_DIRECTIONS` / `_STATUS_VALUES`
  constants are reused **as-is** for the Non-Teaching view too (not
  duplicated as `NON_TEACHING_STRENGTH_*` siblings): every one of these is a
  genuinely category-agnostic value set (the same row shape, same status
  vocabulary, same sortable field names) -- duplicating them under a new name
  would be two constants that must always be kept in sync by convention
  alone, which is exactly the kind of accidental-drift risk this codebase's
  "single choke point" philosophy warns against elsewhere. The constant names
  keep their Phase E `TEACHING_STRENGTH_*` prefix rather than being renamed
  to something category-neutral (e.g. `STRENGTH_VIEW_SORT_FIELDS`) purely to
  avoid an unrelated-seeming rename touching the Teaching router handler's
  existing references for no behavioral reason -- flagged here as the one
  place where "reuse the name" and "the name is the clearest possible name"
  diverge slightly; a future reader landing on `TEACHING_STRENGTH_STATUS_VALUES`
  being passed into the Non-Teaching handler may reasonably ask why -- this
  paragraph is that answer.

Column definitions:
- `approved`: current-effective `SanctionedStrength.approved_strength` for
  the (campus, department, designation) key -- from
  `sanctioned_strength.current_effective_rows`, this module's own base row
  set (see below), not reimplemented.
- `working`: live headcount for the (department, designation) key, via
  `sanctioned_strength.working_count_for` -- called with this view's own
  `category` (TEACHING or, as of Phase F, NON_TEACHING) explicitly, not left
  `None`, so it's self-documenting at the call site which category each view
  is scoped to, even though `None` would resolve to the same
  Employee-counting branch for both of them (TEACHING/NON_TEACHING/unset all
  fall through `working_count_for`'s default branch -- see that function's
  own docstring; only HOUSEKEEPING diverges, to `HousekeepingStaff`). Never
  `HousekeepingStaff` for either of these two views.
- `vacancy`: `approved - working`, **deliberately signed, not floored at
  0** -- this is the one deliberate divergence from vacancy_register.py's own
  `vacancy_count` (which floors at 0 and infers "overstaffed" as a separate
  boolean check). Here, `vacancy`'s sign is itself the direct input to
  `strength_row_status` (Vacancy > 0 / == 0 / < 0), so flooring it would
  destroy the very signal the status function needs -- see
  `strength_row_status`'s own docstring.
- `filled_pct`: `working / approved * 100`, rounded to 1dp, or `None` (not
  0.0) when `approved == 0` -- identical convention to
  vacancy_register.py's own `filled_pct` / reporting.py's
  `vacancy_closure_rate_pct`.
- `status`: see `strength_row_status` below.
- `last_join` / `last_resignation`: per-designation analogues of
  vacancy_register.py's own department-level fields (its module docstring,
  lines ~81-84), but scoped to **both** `department_id` and `designation_id`
  together (the same (department, designation) key `working_count_for` and
  `working` above use) -- not `designation_id` alone. A judgment call: the
  same Designation Master row can be linked to more than one department, so
  scoping only by `designation_id` would let an unrelated department's
  employees under a same-named designation leak into this row's
  last_join/last_resignation, which would be inconsistent with `working`'s
  own (department, designation)-scoped figure just above it. Scoping by both
  keeps every per-row figure aligned to the exact same key.
  `MAX(Employee.date_of_joining)` / `MAX(Employee.separation_date WHERE NOT
  NULL)` over **all** employees ever assigned to that (department,
  designation) key (any employment_status -- historical facts, matching
  vacancy_register.py's own convention of not restricting to ACTIVE here).
- `last_updated`: `GREATEST(this row's own SanctionedStrength.updated_at,
  MAX(Employee.updated_at) for the (department, designation) key)` -- a
  narrower analogue of vacancy_register.py's 4-input GREATEST (that one
  spans every historical SanctionedStrength revision for the whole
  department, plus Department/VacancyRequest.updated_at; this row already
  *is* one specific current-effective SanctionedStrength record, so there is
  no separate "every revision" input to fold in the way the department-level
  rollup needed).

`status` priority order and exact codes -- `strength_row_status` (this
function is category-agnostic; it never inspects `category` itself, only the
already-resolved `vacancy`/`is_inactive`/`has_pending_request` values every
caller -- Teaching or Non-Teaching -- computes the same way):

Vacancy>0 -> "VACANCY_RECRUITMENT_REQUIRED" (intended frontend label,
**flagged as a judgment call**: "Vacancy/Recruitment Required" -- the plan
document names this exact phrase once, with no separate spec doc confirming
it verbatim elsewhere in this repo (reference/RTCFR Prompt.docx is an
untracked binary Word file not machine-searchable here); using it verbatim
since it's the one concrete string the plan actually gives). Vacancy==0 ->
"FULLY_STAFFED" ("Fully Staffed"). Vacancy<0 -> "OVERSTAFFED" ("Overstaffed").
Plus two more the plan names without defining a formula for:
"APPROVAL_PENDING" ("Approval Pending") -- reuses
`VACANCY_REQUEST_IN_FLIGHT_STATUSES` (app/models/enums.py), the exact same
set vacancy_register.py's `recruitment_status_request_count` and
sanctioned_strength.py's `compute_availability_to_request` already reuse --
true when at least one VacancyRequest for this exact (campus, department,
designation) key has a status in that set. "INACTIVE" ("Inactive") -- true
when this row's own `SanctionedStrength.is_active` is False, OR its parent
`Department.is_active` is False, OR its parent `Designation.is_active` is
False. Honesty note: because this view's base row set is built from
`current_effective_rows` (which by construction only ever returns
`is_active=True` SanctionedStrength rows), the `SanctionedStrength.is_active`
half of that check can never actually be reached through this code path today
-- it's kept in the check anyway (a) for documentation/defensiveness in case
a future caller ever feeds this function rows from a different source, and
(b) because "no current-effective row at all" (the other half of the plan's
own INACTIVE description) is likewise unreachable here for the same
structural reason: a designation with no current-effective row produces no
row in this view's result set to begin with, so there is nothing to label
INACTIVE for that case -- it simply doesn't appear. The practically-reachable
trigger for INACTIVE in this view is a stale sanction against a
since-deactivated Department or Designation.

Priority order (highest first), the same style of explicit, tested priority
chain as vacancy_register.py's own `recruitment_status`
(OVERSTAFFED > FULLY_STAFFED > VACANCY_EXISTS > NO_ACTIVITY):

1. INACTIVE -- checked first. If the row's own establishment record or its
   parent Department/Designation is no longer active, none of the numeric
   approved/working/vacancy figures represent a live, actionable
   establishment -- every other check below assumes the row is live, so this
   must be resolved before any of them.
2. OVERSTAFFED (vacancy < 0) -- checked next, ahead of APPROVAL_PENDING, on
   the same reasoning vacancy_register.py's own recruitment_status checks
   OVERSTAFFED before FULLY_STAFFED/VACANCY_EXISTS: it is the most anomalous,
   most actionable numeric fact (headcount has already exceeded the
   sanction), and that fact doesn't stop being true or urgent just because a
   VacancyRequest also happens to be in flight for the same key (e.g. a
   request raised for an unrelated reason, or a stale request not yet
   closed) -- an overstaffed designation should never be masked behind a
   merely-pending-request label.
3. APPROVAL_PENDING (an in-flight VacancyRequest exists for this key) --
   checked ahead of both the "needs recruitment" and "fully staffed"
   numeric-only outcomes, since its purpose is exactly to prevent a viewer
   from reading "Vacancy/Recruitment Required" (or "Fully Staffed") and
   raising a duplicate request when one has already been raised and is
   working its way through approval for this same designation.
4. VACANCY_RECRUITMENT_REQUIRED (vacancy > 0, no pending request).
5. FULLY_STAFFED (vacancy == 0, no pending request) -- the default/floor
   outcome once nothing above applies.

See tests/test_sanctioned_strength_views.py for one regression test per
state plus a dedicated test proving this exact ordering when more than one
condition applies at once (an overstaffed key with a pending request must
still read OVERSTAFFED, not APPROVAL_PENDING).
"""

import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import CampusScope
from app.models.campus import Campus
from app.models.department import Department
from app.models.designation import Designation
from app.models.employee import Employee
from app.models.enums import VACANCY_REQUEST_IN_FLIGHT_STATUSES, StaffRoleCategoryEnum
from app.models.location import Location
from app.models.vacancy_request import VacancyRequest
from app.services.sanctioned_strength import current_effective_rows, working_count_for
from app.services.scoping import resolve_campus_filter

TEACHING_STRENGTH_SORT_FIELDS: tuple[str, ...] = (
    "campus_code",
    "department_name",
    "designation_name",
    "location_name",
    "approved",
    "working",
    "vacancy",
    "filled_pct",
    "status",
    "last_join",
    "last_resignation",
    "last_updated",
)
TEACHING_STRENGTH_SORT_DIRECTIONS: tuple[str, ...] = ("asc", "desc")
TEACHING_STRENGTH_STATUS_VALUES: tuple[str, ...] = (
    "VACANCY_RECRUITMENT_REQUIRED",
    "FULLY_STAFFED",
    "OVERSTAFFED",
    "APPROVAL_PENDING",
    "INACTIVE",
)


def _sort_key(value, reverse: bool):
    # None-safe sort key -- identical convention to vacancy_register.py's own
    # `_sort_key`: groups None values together (at the tail for ascending)
    # without ever comparing None to a real value.
    return (value is None, value)


def strength_row_status(*, vacancy: int, is_inactive: bool, has_pending_request: bool) -> str:
    """Pure function -- no DB access, no side effects, category-agnostic (see
    module docstring's Phase F naming-choices section for why this was
    renamed from `teaching_strength_status` rather than kept aliased). See
    this module's own docstring for the exact label strings and the full
    priority-order reasoning: INACTIVE > OVERSTAFFED > APPROVAL_PENDING >
    VACANCY_RECRUITMENT_REQUIRED > FULLY_STAFFED."""
    if is_inactive:
        return "INACTIVE"
    if vacancy < 0:
        return "OVERSTAFFED"
    if has_pending_request:
        return "APPROVAL_PENDING"
    if vacancy > 0:
        return "VACANCY_RECRUITMENT_REQUIRED"
    return "FULLY_STAFFED"


def list_strength_view_rows(
    db: Session,
    scope: CampusScope,
    *,
    category: StaffRoleCategoryEnum,
    limit: int,
    offset: int,
    sort_by: str,
    sort_dir: str,
    campus_code: str | None = None,
    department_id: uuid.UUID | None = None,
    designation_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
    search: str | None = None,
    status: str | None = None,
    vacancy: int | None = None,
) -> tuple[list[dict], int, dict[str, int]]:
    """Phase F (glowing-zooming-hamming.md) generalization of Phase E's
    TEACHING-only `list_teaching_strength_rows` -- returns (page_rows, total,
    status_counts), one row per current-effective SanctionedStrength row
    whose category matches the given `category` (TEACHING or NON_TEACHING --
    HOUSEKEEPING is deliberately out of scope for this function: Phase G's
    Housekeeping view is grouped by Location, not (department, designation),
    a genuinely different grain, per this repo's plan document). Every
    mechanic below (batched Department/Designation/Campus/Location lookups,
    in-flight VacancyRequest lookup, last_join/last_resignation/last_updated
    aggregation, status_counts snapshot, filters, sort, pagination) is
    unchanged from Phase E -- only the hardcoded `StaffRoleCategoryEnum.TEACHING`
    filter and the hardcoded `working_count_for(..., category=TEACHING)` call
    became parametrized on `category`.

    `status_counts` is this module's `category_counts`-shaped analogue:
    `{code: n for code in TEACHING_STRENGTH_STATUS_VALUES} | {"ALL": n}`,
    snapshotted just before the `status` filter is applied (every other
    filter -- campus/department/designation/location/search/vacancy --
    already applied), so a status-tabs-style UI can show a live per-status
    count that doesn't collapse when a different status tab is selected --
    same convention as vacancy_register.py's own `category_counts`. Named
    `status_counts` here rather than reusing the literal name
    `category_counts`: each call of this function's category is already
    fixed by its own `category` argument (see this module's docstring), so a
    `category_counts` field listing TEACHING/NON_TEACHING/HOUSEKEEPING counts
    would always read `{0, 0}` for the other two categories here and add
    nothing -- `status` is this view's actual tabbable dimension, so that's
    what gets the pre-filter-cut count snapshot.

    total is the count of rows matching every filter (including the
    Python-computed `status`/`vacancy` filters), before offset/limit
    slicing.
    """
    campus_id_filter, _scope_note = resolve_campus_filter(db, scope, campus_code)

    effective_rows = current_effective_rows(
        db, campus_id=campus_id_filter, department_id=department_id, designation_id=designation_id
    )
    category_rows = [row for row in effective_rows if row.category == category]
    if location_id is not None:
        category_rows = [row for row in category_rows if row.location_id == location_id]

    if not category_rows:
        empty_counts = {code: 0 for code in TEACHING_STRENGTH_STATUS_VALUES}
        empty_counts["ALL"] = 0
        return [], 0, empty_counts

    department_ids = {row.department_id for row in category_rows}
    designation_ids = {row.designation_id for row in category_rows}
    campus_ids = {row.campus_id for row in category_rows}
    location_ids = {row.location_id for row in category_rows if row.location_id is not None}

    department_by_id = {d.id: d for d in db.query(Department).filter(Department.id.in_(department_ids)).all()}
    designation_by_id = {
        d.id: d for d in db.query(Designation).filter(Designation.id.in_(designation_ids)).all()
    }
    campus_code_by_id = dict(db.query(Campus.id, Campus.code).filter(Campus.id.in_(campus_ids)).all())
    location_name_by_id: dict = {}
    if location_ids:
        location_name_by_id = dict(
            db.query(Location.id, Location.name).filter(Location.id.in_(location_ids)).all()
        )

    # Batched "is there an in-flight VacancyRequest for this exact (campus,
    # department, designation) key" lookup -- reuses
    # VACANCY_REQUEST_IN_FLIGHT_STATUSES (app/models/enums.py), the same set
    # vacancy_register.py's recruitment_status_request_count and
    # sanctioned_strength.py's compute_availability_to_request already reuse
    # -- not the "current effective row" rule (nothing to reuse there; this
    # is a plain status-membership count, same shape as vacancy_register.py's
    # own in_flight_count_sq).
    in_flight_rows = (
        db.query(
            VacancyRequest.campus_id,
            VacancyRequest.department_id,
            VacancyRequest.designation_id,
            func.count(VacancyRequest.id),
        )
        .filter(
            VacancyRequest.designation_id.in_(designation_ids),
            VacancyRequest.status.in_(VACANCY_REQUEST_IN_FLIGHT_STATUSES),
        )
        .group_by(VacancyRequest.campus_id, VacancyRequest.department_id, VacancyRequest.designation_id)
        .all()
    )
    in_flight_count_by_key: dict[tuple[uuid.UUID, uuid.UUID, uuid.UUID], int] = {
        (c_id, d_id, g_id): count for c_id, d_id, g_id, count in in_flight_rows
    }

    # Batched last_join/last_resignation/last_updated per (department_id,
    # designation_id) key -- see module docstring for why both, not
    # designation_id alone.
    employee_agg_rows = (
        db.query(
            Employee.department_id,
            Employee.designation_id,
            func.max(Employee.date_of_joining),
            func.max(Employee.separation_date),
            func.max(Employee.updated_at),
        )
        .filter(Employee.department_id.in_(department_ids), Employee.designation_id.in_(designation_ids))
        .group_by(Employee.department_id, Employee.designation_id)
        .all()
    )
    employee_agg_by_key: dict[tuple[uuid.UUID, uuid.UUID], tuple] = {
        (dept_id, desig_id): (last_join, last_resignation, employee_last_updated)
        for dept_id, desig_id, last_join, last_resignation, employee_last_updated in employee_agg_rows
    }

    pattern = search.strip().lower() if search else None

    results: list[dict] = []
    for row in category_rows:
        department = department_by_id.get(row.department_id)
        designation = designation_by_id.get(row.designation_id)
        # Both are guaranteed to exist (RESTRICT FKs on SanctionedStrength --
        # see app/models/sanctioned_strength.py), but resolved defensively
        # rather than assumed, matching this codebase's general style.
        department_name = department.name if department is not None else None
        designation_name = designation.name if designation is not None else None

        if pattern:
            haystack = f"{department_name or ''} {designation_name or ''}".lower()
            if pattern not in haystack:
                continue

        working = working_count_for(
            db,
            department_id=row.department_id,
            designation_id=row.designation_id,
            category=category,
        )
        approved = row.approved_strength
        row_vacancy = approved - working
        filled_pct = round(working / approved * 100, 1) if approved > 0 else None

        is_inactive = (
            not row.is_active
            or (department is not None and not department.is_active)
            or (designation is not None and not designation.is_active)
        )
        has_pending_request = (
            in_flight_count_by_key.get((row.campus_id, row.department_id, row.designation_id), 0) > 0
        )
        row_status = strength_row_status(
            vacancy=row_vacancy, is_inactive=is_inactive, has_pending_request=has_pending_request
        )

        last_join, last_resignation, employee_last_updated = employee_agg_by_key.get(
            (row.department_id, row.designation_id), (None, None, None)
        )
        last_updated = max(
            (value for value in (row.updated_at, employee_last_updated) if value is not None),
            default=row.updated_at,
        )

        results.append(
            {
                "sanctioned_strength_id": row.id,
                "campus_id": row.campus_id,
                "campus_code": campus_code_by_id.get(row.campus_id),
                "department_id": row.department_id,
                "department_name": department_name,
                "designation_id": row.designation_id,
                "designation_name": designation_name,
                "location_id": row.location_id,
                "location_name": location_name_by_id.get(row.location_id) if row.location_id else None,
                "approved": approved,
                "working": working,
                "vacancy": row_vacancy,
                "filled_pct": filled_pct,
                "status": row_status,
                "last_join": last_join,
                "last_resignation": last_resignation,
                "last_updated": last_updated,
            }
        )

    if vacancy is not None:
        results = [r for r in results if r["vacancy"] == vacancy]

    # Snapshot per-status counts here -- every filter except `status` itself
    # has now been applied (see docstring above for why this is named
    # status_counts, not category_counts).
    status_counts: dict[str, int] = {code: 0 for code in TEACHING_STRENGTH_STATUS_VALUES}
    for r in results:
        status_counts[r["status"]] += 1
    status_counts["ALL"] = len(results)

    if status is not None:
        results = [r for r in results if r["status"] == status]

    reverse = sort_dir == "desc"
    results.sort(key=lambda r: _sort_key(r[sort_by], reverse), reverse=reverse)

    total = len(results)
    page = results[offset : offset + limit]
    return page, total, status_counts


def list_teaching_strength_rows(
    db: Session,
    scope: CampusScope,
    *,
    limit: int,
    offset: int,
    sort_by: str,
    sort_dir: str,
    campus_code: str | None = None,
    department_id: uuid.UUID | None = None,
    designation_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
    search: str | None = None,
    status: str | None = None,
    vacancy: int | None = None,
) -> tuple[list[dict], int, dict[str, int]]:
    """Phase E's original entry point, kept as a thin wrapper around the
    Phase F generalization (`list_strength_view_rows`) rather than renamed or
    removed -- see this module's docstring's "Phase F naming/refactor
    choices" section for why. Every existing caller (the `/views/teaching`
    router handler, `tests/test_sanctioned_strength_views.py`'s Phase E
    tests) keeps calling this exact name with this exact signature, and gets
    byte-for-byte the same behavior as before this refactor -- this wrapper
    is the thing that guarantees that, not just a convention."""
    return list_strength_view_rows(
        db,
        scope,
        category=StaffRoleCategoryEnum.TEACHING,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
        campus_code=campus_code,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
        search=search,
        status=status,
        vacancy=vacancy,
    )
