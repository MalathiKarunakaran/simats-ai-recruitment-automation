"""Vacancy Register -- a department-level aggregate table, additive on top of
the existing vacancy/approval/hiring pipeline. No new DB table; every field
here is either a plain Department passthrough or computed from existing
tables (VacancyRequest / ApprovedVacancy / HiringSlot / JobPosting /
Application / InterviewSchedule / Offer / Employee).

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
version):
- working_count: COUNT(Employee) with employment_status == ACTIVE, for
  employees currently assigned to the department.
- vacancy_count: sum, over the department's VacancyRequests that ever passed
  HR approval (app.services.reporting._APPROVED_OR_BEYOND_STATUSES), of
  "still-needed" positions -- OPEN/RESERVED HiringSlot count once a
  JobPosting exists (published), else the full ApprovedVacancy.total_positions
  when approved-but-not-yet-published (no slots exist yet at that point).
- approved_count: working_count + vacancy_count. A derived display value,
  never an independently stored "approved strength" figure.
- filled_pct: working_count / approved_count * 100, rounded to 1dp, or None
  (not 0.0 -- see reporting.py's vacancy_closure_rate_pct for the same
  None-vs-0.0 convention) when approved_count == 0.
- requested_count / approved_request_count / jd_posted_count /
  interviews_count / offers_count / joined_count: the 6-stage pipeline funnel
  for this department (any VacancyRequest ever raised -> HR-approved-or-
  beyond -> JobPosting created -> InterviewSchedule created -> Offer created
  -> Application reached JOINED-or-later), each computed as its own
  correlated scalar subquery so none of them fan out against each other.
- recruitment_status: OVERSTAFFED (working_count > approved_count -- kept as
  a defensive check for legacy/imported-data inconsistencies even though it's
  algebraically unreachable given approved_count's own derivation) >
  FULLY_STAFFED (vacancy_count == 0 and working_count > 0) > VACANCY_EXISTS
  (vacancy_count > 0) > NO_ACTIVITY (neither).
- approval_status (priority order): APPROVAL_PENDING (any SUBMITTED/
  DEAN_APPROVED VacancyRequest) > REJECTED (most recent VacancyRequest by
  created_at is REJECTED) > APPROVED (any VacancyRequest ever reached
  _APPROVED_OR_BEYOND_STATUSES) > NO_REQUESTS.
- last_join / last_resignation: MAX(Employee.date_of_joining) / MAX(Employee.
  separation_date WHERE NOT NULL) over ALL employees ever assigned to the
  department (any employment_status -- historical facts, not just currently
  ACTIVE ones).
- last_updated: GREATEST(Department.updated_at, MAX(VacancyRequest.
  updated_at), MAX(Employee.updated_at)) for the department.

Implementation note: every per-department aggregate is its own correlated
scalar subquery in the outer SELECT's column list (not a join onto a query
that also carries other one-to-many joins), so none of them can fan out
against each other -- see CLAUDE.md/testing skill on why that matters here.
Because recruitment_status/approval_status/filled_pct depend on more than one
raw column and can't cleanly be expressed as WHERE-filterable SQL without a
second pass, they (along with approval_status/recruitment_status filtering,
sorting, and pagination) are computed/applied in Python after fetching every
matching department row -- deliberately, per the "~500 departments" scale
this table operates at (not deferred to a second per-page query, which would
break derived-column sorting). `category` filtering is deliberately applied
in this same Python pass too (not pushed down to SQL), rather than the
category=None-shaped whole-set query being a separate code path -- this is
what lets `category_counts` be taken as a snapshot of the fully-filtered-
minus-category result set just before the category cut, for free, without a
second `GROUP BY category` round-trip.
"""

import uuid

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import CampusScope
from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.campus import Campus
from app.models.department import Department
from app.models.employee import Employee
from app.models.enums import (
    EmploymentStatusEnum,
    HiringSlotStatusEnum,
    StaffRoleCategoryEnum,
    VacancyRequestStatusEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.interview import InterviewSchedule
from app.models.job_posting import JobPosting
from app.models.offer import Offer
from app.models.vacancy_request import VacancyRequest
from app.services.reporting import _APPROVED_OR_BEYOND_STATUSES, _JOINED_OR_LATER_STATUSES
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


def _sort_key(value, reverse: bool):
    # None-safe sort key: groups None values together (at the tail for an
    # ascending sort) without ever comparing None to a real value, which
    # would raise TypeError for int/float/date columns.
    return (value is None, value)


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

    open_or_reserved_slot_count = (
        select(func.count(HiringSlot.id))
        .where(
            HiringSlot.approved_vacancy_id == ApprovedVacancy.id,
            HiringSlot.status.in_((HiringSlotStatusEnum.OPEN, HiringSlotStatusEnum.RESERVED)),
        )
        .correlate(ApprovedVacancy)
        .scalar_subquery()
    )
    vacancy_count_sq = (
        select(
            func.coalesce(
                func.sum(
                    case(
                        (JobPosting.id.isnot(None), open_or_reserved_slot_count),
                        else_=ApprovedVacancy.total_positions,
                    )
                ),
                0,
            )
        )
        .select_from(VacancyRequest)
        .join(ApprovedVacancy, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .outerjoin(JobPosting, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .where(VacancyRequest.department_id == dept, VacancyRequest.status.in_(_APPROVED_OR_BEYOND_STATUSES))
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
    has_pending_sq = (
        select(func.count(VacancyRequest.id))
        .where(VacancyRequest.department_id == dept, VacancyRequest.status.in_(_PENDING_STATUSES))
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
    # Postgres GREATEST() ignores NULL arguments (only NULL if every argument
    # is NULL) -- Department.updated_at is NOT NULL, so this is never NULL.
    last_updated_expr = func.greatest(Department.updated_at, vr_last_updated_sq, employee_last_updated_sq)

    stmt = (
        select(
            Department.id.label("department_id"),
            Department.name.label("department_name"),
            Department.code.label("department_code"),
            Department.category.label("category"),
            Department.is_active.label("is_active"),
            Department.campus_id.label("campus_id"),
            Campus.code.label("campus_code"),
            working_count_sq.label("working_count"),
            vacancy_count_sq.label("vacancy_count"),
            requested_count_sq.label("requested_count"),
            approved_request_count_sq.label("approved_request_count"),
            jd_posted_count_sq.label("jd_posted_count"),
            interviews_count_sq.label("interviews_count"),
            offers_count_sq.label("offers_count"),
            joined_count_sq.label("joined_count"),
            has_pending_sq.label("has_pending"),
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

    results: list[dict] = []
    for row in rows:
        working_count = int(row.working_count or 0)
        vacancy_count = int(row.vacancy_count or 0)
        approved_count = working_count + vacancy_count
        filled_pct = round(working_count / approved_count * 100, 1) if approved_count > 0 else None

        if working_count > approved_count:
            row_recruitment_status = "OVERSTAFFED"
        elif vacancy_count == 0 and working_count > 0:
            row_recruitment_status = "FULLY_STAFFED"
        elif vacancy_count > 0:
            row_recruitment_status = "VACANCY_EXISTS"
        else:
            row_recruitment_status = "NO_ACTIVITY"

        if row.has_pending:
            row_approval_status = "APPROVAL_PENDING"
        elif row.most_recent_status == VacancyRequestStatusEnum.REJECTED:
            row_approval_status = "REJECTED"
        elif row.approved_request_count:
            row_approval_status = "APPROVED"
        else:
            row_approval_status = "NO_REQUESTS"

        results.append(
            {
                "department_id": row.department_id,
                "department_name": row.department_name,
                "department_code": row.department_code,
                "category": row.category,
                "is_active": row.is_active,
                "campus_id": row.campus_id,
                "campus_code": row.campus_code,
                "working_count": working_count,
                "vacancy_count": vacancy_count,
                "approved_count": approved_count,
                "filled_pct": filled_pct,
                "requested_count": int(row.requested_count or 0),
                "approved_request_count": int(row.approved_request_count or 0),
                "jd_posted_count": int(row.jd_posted_count or 0),
                "interviews_count": int(row.interviews_count or 0),
                "offers_count": int(row.offers_count or 0),
                "joined_count": int(row.joined_count or 0),
                "recruitment_status": row_recruitment_status,
                "approval_status": row_approval_status,
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
    category_counts: dict[str, int] = {member.value: 0 for member in StaffRoleCategoryEnum}
    for r in results:
        if r["category"] is not None:
            category_counts[r["category"].value] += 1
    category_counts["ALL"] = len(results)

    if category is not None:
        results = [r for r in results if r["category"] == category]

    reverse = sort_dir == "desc"
    results.sort(key=lambda r: _sort_key(r[sort_by], reverse), reverse=reverse)

    total = len(results)
    page = results[offset : offset + limit]
    return page, total, category_counts
