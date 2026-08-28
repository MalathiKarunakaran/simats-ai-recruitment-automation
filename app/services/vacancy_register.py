"""Vacancy Register -- a department-level aggregate table, additive on top of
the existing vacancy/approval/hiring pipeline plus the Sanctioned Strength
table (zany-snuggling-pie.md Phase A/B). No new DB table of its own; every
field here is either a plain Department passthrough or computed from
existing tables (SanctionedStrength / VacancyRequest / Employee /
JobPosting / InterviewSchedule / Offer / Application).

Campus scoping goes through the same app.services.scoping.resolve_campus_filter
used by app/services/reporting.py: a single-campus caller's campus_code query
param is always ignored in favor of their own CampusScope.campus_id.

is_active defaults to None (no filter, same convention as
app/api/v1/routers/designations.py's own is_active param) -- the frontend's
own filter defaults to "Active" and sends is_active=true explicitly on first
load, matching the Departments/Eligibility Rules pages' active-only-by-default
UX convention, but the query param itself is a plain optional tri-state.

Metric definitions (documented since none of these are literal DB columns --
see the field-by-field spec this was built from for the authoritative
version; **Phase B rewrote approved_count/vacancy_count to be Sanctioned-
Strength-backed instead of VacancyRequest/HiringSlot-derived -- see
zany-snuggling-pie.md's Context section for why "Sanctioned Strength" and
"Vacancy Request" are now two distinct concepts**):
- working_count: COUNT(Employee) with employment_status == ACTIVE, for
  employees currently assigned to the department.
- approved_count: SUM(approved_strength) across every current-effective
  SanctionedStrength row (app.services.sanctioned_strength.
  current_effective_rows -- the one reusable "which row is current" resolver,
  reused here rather than reimplemented) for every designation ever
  sanctioned within the department. **No longer** working_count +
  vacancy_count (that was a display artifact, not an independently sanctioned
  ceiling) -- it is now a real, independently stored figure that can be
  smaller than working_count (see recruitment_status's OVERSTAFFED below,
  now genuinely reachable). A department with no SanctionedStrength rows at
  all has approved_count == 0.
- vacancy_count: `max(approved_count - working_count, 0)`, computed in
  Python (not its own subquery -- it only needs the two values already
  fetched). Floored at 0 rather than going negative when working_count
  exceeds approved_count -- see recruitment_status's OVERSTAFFED, which is
  where that excess is actually surfaced.
- filled_pct: working_count / approved_count * 100, rounded to 1dp, or None
  (not 0.0 -- see reporting.py's vacancy_closure_rate_pct for the same
  None-vs-0.0 convention) when approved_count == 0. Formula unchanged from
  before Phase B; only its approved_count input changed meaning.
- requested_count / approved_request_count / jd_posted_count /
  interviews_count / offers_count / joined_count: the 6-stage pipeline funnel
  for this department (any VacancyRequest ever raised -> HR-approved-or-
  beyond -> JobPosting created -> InterviewSchedule created -> Offer created
  -> Application reached JOINED-or-later), each computed as its own
  correlated scalar subquery so none of them fan out against each other.
  Unchanged by Phase B.
- recruitment_status: OVERSTAFFED (working_count > approved_count) >
  FULLY_STAFFED (vacancy_count == 0 and working_count > 0) > VACANCY_EXISTS
  (vacancy_count > 0) > NO_ACTIVITY (neither). Formula unchanged from before
  Phase B, but OVERSTAFFED was previously documented as algebraically
  unreachable (approved_count was defined as working_count + vacancy_count,
  so working_count could never exceed it) -- since Phase B's approved_count
  is an independent, real ceiling, a department can now genuinely be
  overstaffed relative to what it's sanctioned for, and this branch is
  reachable (see test_vacancy_register.py's dedicated regression test).
- recruitment_status_request_count: sibling count field (item 28's future "N
  requests" UI label) -- the count of this department's VacancyRequests
  currently "in flight" toward filling a vacancy, i.e. status in
  {SUBMITTED, DEAN_APPROVED, APPROVED, PUBLISHED} (the same in-flight set
  Phase E's `available_to_request` formula reserves against -- reused for
  consistency, not reimplemented). Deliberately NOT a literal "how many
  requests determined this recruitment_status" count -- recruitment_status
  itself no longer depends on VacancyRequest at all post-Phase-B (it's pure
  working_count vs. SanctionedStrength-derived approved_count) -- this is an
  adjacent, still-useful "how many requests are actively pursuing this
  vacancy right now" figure for the same UI affordance.
- approval_status (priority order): APPROVAL_PENDING (any SUBMITTED/
  DEAN_APPROVED VacancyRequest) > REJECTED (most recent VacancyRequest by
  created_at is REJECTED) > APPROVED (any VacancyRequest ever reached
  _APPROVED_OR_BEYOND_STATUSES) > NO_REQUESTS. Formula unchanged by Phase B.
- approval_status_request_count: sibling count field for approval_status,
  literally counting the VacancyRequests that produced whichever branch was
  chosen -- the pending count when APPROVAL_PENDING, the all-time REJECTED
  count when REJECTED, approved_request_count when APPROVED, 0 when
  NO_REQUESTS.
- last_join / last_resignation: MAX(Employee.date_of_joining) / MAX(Employee.
  separation_date WHERE NOT NULL) over ALL employees ever assigned to the
  department (any employment_status -- historical facts, not just currently
  ACTIVE ones). Unchanged by Phase B.
- last_updated: GREATEST(Department.updated_at, MAX(VacancyRequest.
  updated_at), MAX(Employee.updated_at), MAX(SanctionedStrength.updated_at))
  for the department -- Phase B added the 4th input (every SanctionedStrength
  row for the department, current-effective or not, so an edit to any
  revision's remarks/approved_strength/effective_from is reflected here, not
  just edits to whichever row currently happens to be "current").

Implementation note: every per-department aggregate is its own correlated
scalar subquery in the outer SELECT's column list (not a join onto a query
that also carries other one-to-many joins), so none of them can fan out
against each other -- see CLAUDE.md/testing skill on why that matters here.
approved_count is the one exception: it's resolved via a single extra query
(app.services.sanctioned_strength.current_effective_rows, scoped by the same
campus_id/department_id filters already applied to the outer query) summed
in Python into a `{department_id: approved_count}` dict, rather than a
correlated subquery -- reusing Phase A's resolver as-is (its DISTINCT ON
shape doesn't correlate cleanly per-department-row without duplicating the
resolver's SQL) is worth one extra round-trip rather than reimplementing the
"current effective row" rule a second time in this file.
Because recruitment_status/approval_status/filled_pct/vacancy_count depend on
more than one raw column and can't cleanly be expressed as WHERE-filterable
SQL without a second pass, they (along with approval_status/
recruitment_status filtering, sorting, and pagination) are computed/applied
in Python after fetching every matching department row -- deliberately, per
the "~500 departments" scale this table operates at (not deferred to a
second per-page query, which would break derived-column sorting). `category`
filtering is deliberately applied in this same Python pass too (not pushed
down to SQL), rather than the category=None-shaped whole-set query being a
separate code path -- this is what lets `category_counts` be taken as a
snapshot of the fully-filtered-minus-category result set just before the
category cut, for free, without a second `GROUP BY category` round-trip.
"""

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import CampusScope
from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.campus import Campus
from app.models.department import Department
from app.models.employee import Employee
from app.models.enums import (
    VACANCY_REQUEST_IN_FLIGHT_STATUSES,
    EmploymentStatusEnum,
    StaffRoleCategoryEnum,
    VacancyRequestStatusEnum,
)
from app.models.interview import InterviewSchedule
from app.models.job_posting import JobPosting
from app.models.offer import Offer
from app.models.sanctioned_strength import SanctionedStrength
from app.models.vacancy_request import VacancyRequest
from app.services.reporting import _APPROVED_OR_BEYOND_STATUSES, _JOINED_OR_LATER_STATUSES
from app.services.sanctioned_strength import current_effective_rows
from app.services.scoping import resolve_campus_filter

SORT_FIELDS: tuple[str, ...] = (
    "department_name",
    "category",
    "approved_count",
    "working_count",
    "vacancy_count",
    "filled_pct",
    "last_join",
    "last_resignation",
    "last_updated",
)
SORT_DIRECTIONS: tuple[str, ...] = ("asc", "desc")
APPROVAL_STATUS_VALUES: tuple[str, ...] = ("APPROVAL_PENDING", "REJECTED", "APPROVED", "NO_REQUESTS")
RECRUITMENT_STATUS_VALUES: tuple[str, ...] = ("FULLY_STAFFED", "VACANCY_EXISTS", "OVERSTAFFED", "NO_ACTIVITY")

_PENDING_STATUSES = (VacancyRequestStatusEnum.SUBMITTED, VacancyRequestStatusEnum.DEAN_APPROVED)
# The set of VacancyRequest statuses that reserve against SanctionedStrength
# per zany-snuggling-pie.md's Context section (decision 2) -- now the single
# shared definition in app/models/enums.py (VACANCY_REQUEST_IN_FLIGHT_STATUSES),
# reused here (not reimplemented) for recruitment_status_request_count's "how
# many requests are actively pursuing this vacancy right now" figure, and by
# Phase E's available_to_request computation
# (app/services/sanctioned_strength.py) / submit()-time enforcement
# (app/services/vacancy_workflow.py).
_IN_FLIGHT_STATUSES = VACANCY_REQUEST_IN_FLIGHT_STATUSES


def _sort_key(value, reverse: bool):
    # None-safe sort key: groups None values together (at the tail for an
    # ascending sort) without ever comparing None to a real value, which
    # would raise TypeError for int/float/date columns.
    return (value is None, value)


# The public `sort_by` values are part of the API and the frontend already
# sends them, so `category` survives the column going multi-valued -- it just
# resolves to the new row key here rather than being renamed.
_SORT_VALUE_KEYS = {"category": "supported_categories"}


def _row_sort_value(row: dict, sort_by: str):
    """The comparable scalar behind a `sort_by` field.

    `supported_categories` is a list, which would sort by identity of its
    members rather than anything a user would recognise, so it collapses to
    its joined value ("NON_TEACHING,TEACHING") -- deterministic, and it keeps
    departments with the same category set adjacent.
    """
    value = row[_SORT_VALUE_KEYS.get(sort_by, sort_by)]
    if isinstance(value, list):
        return ",".join(member.value for member in value)
    return value


def list_vacancy_register_rows(
    db: Session,
    scope: CampusScope,
    *,
    limit: int,
    offset: int,
    sort_by: str,
    sort_dir: str,
    campus_code: str | None = None,
    category: StaffRoleCategoryEnum | None = None,
    department_id: uuid.UUID | None = None,
    search: str | None = None,
    approval_status: str | None = None,
    recruitment_status: str | None = None,
    is_active: bool | None = None,
) -> tuple[list[dict], int, dict[str, int]]:
    """Returns (page_rows, total, category_counts).

    total is the count of departments matching every filter (including the
    Python-computed approval_status/recruitment_status filters and the
    category filter itself), before offset/limit slicing.

    category_counts is `{"TEACHING": n, "NON_TEACHING": n, "HOUSEKEEPING": n,
    "ALL": n}` reflecting every filter (campus/is_active/department_id/
    search/approval_status/recruitment_status) EXCEPT category -- so
    switching between category tabs never changes another tab's displayed
    count."""

    campus_id_filter, _scope_note = resolve_campus_filter(db, scope, campus_code)

    dept = Department.id  # correlation anchor, used by every subquery below

    working_count_sq = (
        select(func.count(func.distinct(Employee.id)))
        .where(Employee.department_id == dept, Employee.employment_status == EmploymentStatusEnum.ACTIVE)
        .correlate(Department)
        .scalar_subquery()
    )

    requested_count_sq = (
        select(func.count(func.distinct(VacancyRequest.id)))
        .where(VacancyRequest.department_id == dept)
        .correlate(Department)
        .scalar_subquery()
    )
    approved_request_count_sq = (
        select(func.count(func.distinct(VacancyRequest.id)))
        .where(VacancyRequest.department_id == dept, VacancyRequest.status.in_(_APPROVED_OR_BEYOND_STATUSES))
        .correlate(Department)
        .scalar_subquery()
    )
    # Count (not just a boolean) -- also feeds approval_status_request_count
    # when approval_status == APPROVAL_PENDING.
    pending_count_sq = (
        select(func.count(VacancyRequest.id))
        .where(VacancyRequest.department_id == dept, VacancyRequest.status.in_(_PENDING_STATUSES))
        .correlate(Department)
        .scalar_subquery()
    )
    # All-time REJECTED count (not just "is the most recent one rejected") --
    # feeds approval_status_request_count when approval_status == REJECTED.
    rejected_count_sq = (
        select(func.count(VacancyRequest.id))
        .where(VacancyRequest.department_id == dept, VacancyRequest.status == VacancyRequestStatusEnum.REJECTED)
        .correlate(Department)
        .scalar_subquery()
    )
    # Feeds recruitment_status_request_count -- see module docstring for why
    # this is an adjacent figure, not a literal "contributed to the
    # recruitment_status determination" count.
    in_flight_count_sq = (
        select(func.count(VacancyRequest.id))
        .where(VacancyRequest.department_id == dept, VacancyRequest.status.in_(_IN_FLIGHT_STATUSES))
        .correlate(Department)
        .scalar_subquery()
    )
    most_recent_status_sq = (
        select(VacancyRequest.status)
        .where(VacancyRequest.department_id == dept)
        .order_by(VacancyRequest.created_at.desc())
        .limit(1)
        .correlate(Department)
        .scalar_subquery()
    )

    jd_posted_count_sq = (
        select(func.count(func.distinct(JobPosting.id)))
        .select_from(JobPosting)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .where(VacancyRequest.department_id == dept)
        .correlate(Department)
        .scalar_subquery()
    )
    interviews_count_sq = (
        select(func.count(func.distinct(InterviewSchedule.id)))
        .select_from(InterviewSchedule)
        .join(Application, InterviewSchedule.application_id == Application.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .where(VacancyRequest.department_id == dept)
        .correlate(Department)
        .scalar_subquery()
    )
    offers_count_sq = (
        select(func.count(func.distinct(Offer.id)))
        .select_from(Offer)
        .join(Application, Offer.application_id == Application.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .where(VacancyRequest.department_id == dept)
        .correlate(Department)
        .scalar_subquery()
    )
    joined_count_sq = (
        select(func.count(func.distinct(Application.id)))
        .select_from(Application)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .where(VacancyRequest.department_id == dept, Application.status.in_(_JOINED_OR_LATER_STATUSES))
        .correlate(Department)
        .scalar_subquery()
    )

    last_join_sq = (
        select(func.max(Employee.date_of_joining))
        .where(Employee.department_id == dept)
        .correlate(Department)
        .scalar_subquery()
    )
    last_resignation_sq = (
        select(func.max(Employee.separation_date))
        .where(Employee.department_id == dept, Employee.separation_date.isnot(None))
        .correlate(Department)
        .scalar_subquery()
    )
    vr_last_updated_sq = (
        select(func.max(VacancyRequest.updated_at))
        .where(VacancyRequest.department_id == dept)
        .correlate(Department)
        .scalar_subquery()
    )
    employee_last_updated_sq = (
        select(func.max(Employee.updated_at))
        .where(Employee.department_id == dept)
        .correlate(Department)
        .scalar_subquery()
    )
    # Phase B's 4th last_updated input -- every SanctionedStrength row for
    # the department (current-effective or not), so an edit to any revision
    # is reflected, not just the currently-effective one.
    sanctioned_strength_last_updated_sq = (
        select(func.max(SanctionedStrength.updated_at))
        .where(SanctionedStrength.department_id == dept)
        .correlate(Department)
        .scalar_subquery()
    )
    # Postgres GREATEST() ignores NULL arguments (only NULL if every argument
    # is NULL) -- Department.updated_at is NOT NULL, so this is never NULL.
    last_updated_expr = func.greatest(
        Department.updated_at,
        vr_last_updated_sq,
        employee_last_updated_sq,
        sanctioned_strength_last_updated_sq,
    )

    stmt = (
        select(
            Department.id.label("department_id"),
            Department.name.label("department_name"),
            Department.code.label("department_code"),
            Department.supported_categories.label("supported_categories"),
            Department.is_active.label("is_active"),
            Department.campus_id.label("campus_id"),
            Campus.code.label("campus_code"),
            working_count_sq.label("working_count"),
            requested_count_sq.label("requested_count"),
            approved_request_count_sq.label("approved_request_count"),
            jd_posted_count_sq.label("jd_posted_count"),
            interviews_count_sq.label("interviews_count"),
            offers_count_sq.label("offers_count"),
            joined_count_sq.label("joined_count"),
            pending_count_sq.label("pending_count"),
            rejected_count_sq.label("rejected_count"),
            in_flight_count_sq.label("in_flight_count"),
            most_recent_status_sq.label("most_recent_status"),
            last_join_sq.label("last_join"),
            last_resignation_sq.label("last_resignation"),
            last_updated_expr.label("last_updated"),
        )
        .select_from(Department)
        .join(Campus, Department.campus_id == Campus.id)
    )

    if campus_id_filter is not None:
        stmt = stmt.where(Department.campus_id == campus_id_filter)
    if is_active is not None:
        stmt = stmt.where(Department.is_active == is_active)
    # category is deliberately NOT applied at the SQL stage here -- it's
    # applied in Python below, after every other filter, so that
    # `category_counts` (computed just before the category cut) reflects the
    # full filtered-minus-category set. This still reuses the exact same
    # correlated-subquery fetch as the category=None case always has, not a
    # second/duplicate query.
    if department_id is not None:
        stmt = stmt.where(Department.id == department_id)
    if search:
        pattern = f"%{search}%"
        employee_match = (
            select(Employee.id)
            .where(
                Employee.department_id == Department.id,
                or_(
                    Employee.full_name.ilike(pattern),
                    Employee.designation.ilike(pattern),
                    Employee.employee_code.ilike(pattern),
                ),
            )
            .correlate(Department)
            .exists()
        )
        stmt = stmt.where(or_(Department.name.ilike(pattern), employee_match))

    rows = db.execute(stmt).all()

    # approved_count is resolved via Phase A's shared "current effective row"
    # resolver rather than a correlated subquery (see module docstring) --
    # one extra query, scoped by the same campus/department filters already
    # applied above, summed in Python into a {department_id: approved_count}
    # dict.
    approved_by_department: dict[uuid.UUID, int] = {}
    for ss_row in current_effective_rows(db, campus_id=campus_id_filter, department_id=department_id):
        approved_by_department[ss_row.department_id] = (
            approved_by_department.get(ss_row.department_id, 0) + ss_row.approved_strength
        )

    results: list[dict] = []
    for row in rows:
        working_count = int(row.working_count or 0)
        approved_count = approved_by_department.get(row.department_id, 0)
        vacancy_count = max(approved_count - working_count, 0)
        filled_pct = round(working_count / approved_count * 100, 1) if approved_count > 0 else None

        if working_count > approved_count:
            row_recruitment_status = "OVERSTAFFED"
        elif vacancy_count == 0 and working_count > 0:
            row_recruitment_status = "FULLY_STAFFED"
        elif vacancy_count > 0:
            row_recruitment_status = "VACANCY_EXISTS"
        else:
            row_recruitment_status = "NO_ACTIVITY"

        pending_count = int(row.pending_count or 0)
        rejected_count = int(row.rejected_count or 0)
        approved_request_count = int(row.approved_request_count or 0)

        if pending_count > 0:
            row_approval_status = "APPROVAL_PENDING"
            row_approval_status_request_count = pending_count
        elif row.most_recent_status == VacancyRequestStatusEnum.REJECTED:
            row_approval_status = "REJECTED"
            row_approval_status_request_count = rejected_count
        elif approved_request_count:
            row_approval_status = "APPROVED"
            row_approval_status_request_count = approved_request_count
        else:
            row_approval_status = "NO_REQUESTS"
            row_approval_status_request_count = 0

        results.append(
            {
                "department_id": row.department_id,
                "department_name": row.department_name,
                "department_code": row.department_code,
                "supported_categories": list(row.supported_categories or []),
                "is_active": row.is_active,
                "campus_id": row.campus_id,
                "campus_code": row.campus_code,
                "working_count": working_count,
                "vacancy_count": vacancy_count,
                "approved_count": approved_count,
                "filled_pct": filled_pct,
                "requested_count": int(row.requested_count or 0),
                "approved_request_count": approved_request_count,
                "jd_posted_count": int(row.jd_posted_count or 0),
                "interviews_count": int(row.interviews_count or 0),
                "offers_count": int(row.offers_count or 0),
                "joined_count": int(row.joined_count or 0),
                "recruitment_status": row_recruitment_status,
                "recruitment_status_request_count": int(row.in_flight_count or 0),
                "approval_status": row_approval_status,
                "approval_status_request_count": row_approval_status_request_count,
                "last_join": row.last_join,
                "last_resignation": row.last_resignation,
                "last_updated": row.last_updated,
            }
        )

    if approval_status is not None:
        results = [r for r in results if r["approval_status"] == approval_status]
    if recruitment_status is not None:
        results = [r for r in results if r["recruitment_status"] == recruitment_status]

    # Snapshot per-category counts here -- every filter except `category`
    # itself has now been applied, so these counts are what each CategoryTabs
    # tab should show regardless of which tab is currently selected.
    # Counts OVERLAP now that a department supports several categories at
    # once -- a department listing TEACHING and NON_TEACHING is counted under
    # both tabs. `ALL` stays a distinct department count (not the sum), which
    # is exactly what the All tab lists, so no department is shown twice.
    category_counts: dict[str, int] = {
        member.value: sum(1 for r in results if member in r["supported_categories"])
        for member in StaffRoleCategoryEnum
    }
    category_counts["ALL"] = len(results)

    if category is not None:
        results = [r for r in results if category in r["supported_categories"]]

    reverse = sort_dir == "desc"
    results.sort(key=lambda r: _sort_key(_row_sort_value(r, sort_by), reverse), reverse=reverse)

    total = len(results)
    page = results[offset : offset + limit]
    return page, total, category_counts
