"""Module 12 (Reporting Agent) + Module 15 (Executive Dashboard).

Every function here is a read-only aggregate query over existing tables --
no new DB tables, no persisted report history. Campus scoping goes through
the same app.services.scoping.resolve_campus_filter used by Hermes (Phase
4), so a single-campus caller's campus_code query param is always ignored
in favor of their own CampusScope.campus_id.

Unlike Hermes's tools (which tolerate a bad campus_code/role_category by
degrading to an empty result, because failing an LLM tool call mid-loop is
worse than a graceful non-answer), these are direct human-facing REST
endpoints: validate_campus_code/validate_role_category raise a normal 422
on an invalid value. Routers call those *before* resolve_campus_filter, so
resolve_campus_filter's own NO_CAMPUS_MATCH branch is never exercised here.

Metric definitions (documented since none of these are literal DB fields):
- open_positions: count of HiringSlot rows with status == OPEN.
- time_to_hire_days (one hire): Employee's linked Application.applied_at
  (date) -> JoiningRecord.actual_joining_date, in days. Only computed for
  hires that actually reached Employee creation.
- vacancy_closure_rate_pct: closed / (approved-or-later) * 100 -- the
  denominator is every vacancy that ever passed HR approval (APPROVED,
  PUBLISHED, or CLOSED); a vacancy still in DRAFT/SUBMITTED/REJECTED was
  never a "closable" vacancy in the first place.
- campus_wise_hiring: per campus, hired_count (Employee rows), open_count
  (open HiringSlot rows), and in_progress_count (non-terminal Application
  rows) -- the open/in_progress pair mirrors the grouping already used by
  build_ad_briefing_summary's campus_role_breakdown, just collapsed to
  campus-only instead of campus x role_category.
- category_wise_breakdown: the campus_wise_hiring idea, collapsed the other
  way -- one row per StaffRoleCategoryEnum value (always exactly 3, in
  TEACHING/NON_TEACHING/HOUSEKEEPING enum order, zero-filled rather than
  omitted when a category has no rows yet, same "don't silently vanish"
  reasoning as campus_wise_hiring's campus list). Each row has applications
  (Application rows, via the denormalized Application.role_category column),
  open_positions (open HiringSlot rows, via HiringSlot -> ApprovedVacancy ->
  VacancyRequest.role_category, same join open_positions itself uses), and
  hires (Employee rows, via Employee -> Application.role_category). Always
  scoped by the endpoint's own campus_code/scope (a campus-scoped HOD only
  ever sees their own campus's numbers here, like every other field), and
  applications additionally respects start_date/end_date exactly like
  total_applications does when a range is given. Deliberately does **not**
  respect the endpoint's own role_category query param, unlike every other
  field above -- this is meant to be an always-all-3-categories at-a-glance
  breakdown card, replacing the frontend's old workaround of calling this
  endpoint three times (once per role_category) and only reading
  total_applications from each response. open_positions/hires are point-in-
  time and were never date-filtered even for the single-category top-line
  stats, so the breakdown doesn't date-filter them either, for consistency.
- sanctioned_approved_total / sanctioned_working_total / sanctioned_vacancy_total
  (Phase I, glowing-zooming-hamming.md): the Sanctioned Strength dashboard
  tile, built by `_sanctioned_strength_totals` -- SUM(approved_strength) /
  SUM(working_count_for(...)) across every current-effective
  SanctionedStrength row in scope (via `current_effective_rows`, same
  resolver `sanctioned_strength_reconciliation_report` uses), and
  approved_total - working_total for the vacancy figure. Unlike
  category_wise_breakdown above, these three DO respect this call's own
  role_category filter (they're top-strip KPI tiles, not the always-all-3
  card). sanctioned_vacancy_total is deliberately signed, not floored at 0
  per row before summing -- see `_sanctioned_strength_totals`'s own
  docstring for why a negative aggregate (net overstaffed) is the honest
  answer here.
- source_wise_breakdown: applications bucketed by Candidate.source via a
  case-insensitive substring match ("referr..." -> Reference, "...mail..."
  -> Mail, anything else -> Other). Candidate.source is deliberately free
  text (see app/models/candidate.py) with no controlled vocabulary, so this
  is a best-effort bucketing, not an exact enum match.
- start_date/end_date (optional): when given, narrows total_applications,
  interviews (today's date-only default becomes range-scoped), joinings,
  rejected_count, withdrawn_count, and source_wise_breakdown to
  Application.applied_at (or the equivalent business timestamp) within the
  range. Omitting both preserves the exact prior all-time/today behavior --
  this is additive, not a breaking change to existing callers.
  build_ad_briefing_summary accepts the same two params (threaded straight
  into get_dashboard_kpis) so the weekly-director-briefing PPTX can be scoped
  to "this week" instead of always meaning "today" -- campus_role_breakdown's
  own open/in_pipeline/hired columns stay point-in-time regardless (mirrors
  campus_wise_hiring's hired_count, which is likewise never date-filtered).
- Each of the 7 REPORT_BUILDERS also accepts the same optional start_date/
  end_date, each narrowed to the business timestamp that best matches what
  the report is counting (not always applied_at): recruitment_funnel_report
  -> Application.applied_at, campus_role_hiring_report -> Employee.
  date_of_joining, interview_report -> InterviewSchedule.scheduled_at,
  offer_report -> Offer.created_at, joining_report -> JoiningRecord.
  created_at (not actual_joining_date -- a still-PENDING record has no
  actual_joining_date yet, and excluding in-progress joinings from "this
  month's joining activity" would defeat the point), vacancy_report ->
  VacancyRequest.created_at, time_to_hire_report -> JoiningRecord.
  actual_joining_date (scopes to hires that *completed* within the range).
  Omitting both preserves the exact prior all-time behavior for every report.

Weekly Recruitment Status (build_weekly_recruitment_status) -- mirrors a real
hand-built weekly PPTX for the Director/AD/PD meeting. None of its columns
are literal schema fields; they're all inferred from the source file's own
internal arithmetic:
- panel_result bucketing: Application.panel_result is free text
  (app/models/application.py) that recruitment staff type by hand after each
  interview. Matched case-insensitively and trimmed: "selected" -> selected
  bucket, "waiting"/"waiting list" -> waiting bucket, "rejected" -> rejected
  bucket. Anything else (null, blank, other text) is excluded from all three
  buckets for that row -- there is no "unclassified" bucket.
- "Attended" convention: a row's attended count is defined as
  selected + waiting + rejected for that row, NOT an independent count of
  everyone with an interview_scheduled_date in the week. This guarantees
  Attended always reconciles exactly with the visible breakdown, matching
  the source file's own arithmetic (its TS/NTS total rows are exact sums of
  their Selected/Waiting/Rejected columns).
- Weekly cohort = Application.interview_scheduled_date within
  [start_date, end_date] inclusive. Teaching Staff rows are grouped by
  Campus.code and have no upcoming_join/joined columns (intentional
  asymmetry with the NTS table, matching the source file). Non-Teaching
  Staff rows cover role_category in (NON_TEACHING, HOUSEKEEPING) --
  "NTS" in the source file means both -- grouped by
  VacancyRequest.position_title (a job/position title like "Electrician",
  not this app's formal Department entity).
- Upcoming Join / Joined (NTS rows, the 3 category tiles, and the top-level
  KPIs) are each independent queries, NOT restricted to the weekly interview
  cohort, since joining is a later pipeline stage that can happen in any
  week regardless of when the interview happened.
"""

import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, DepartmentScope
from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.campus import Campus
from app.models.candidate import Candidate
from app.models.department import Department
from app.models.employee import Employee
from app.models.enums import (
    APPLICATION_TERMINAL_STATUSES,
    CAMPUS_CODES,
    VACANCY_REQUEST_IN_FLIGHT_STATUSES,
    ApplicationStatusEnum,
    EmploymentStatusEnum,
    HiringSlotStatusEnum,
    InterviewScheduleStatusEnum,
    OfferStatusEnum,
    StaffRoleCategoryEnum,
    VacancyPriorityEnum,
    VacancyRequestStatusEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.interview import InterviewSchedule
from app.models.job_posting import JobPosting
from app.models.joining import JoiningRecord
from app.models.offer import Offer
from app.models.vacancy_request import VacancyRequest
from app.services.sanctioned_strength import current_effective_rows, resolved_working_for, working_count_for
from app.services.sanctioned_strength_views import (
    list_housekeeping_strength_rows,
    list_strength_view_rows,
    list_teaching_strength_rows,
)
from app.services.scoping import resolve_campus_filter

_NON_TERMINAL_OFFER_STATUSES = (OfferStatusEnum.DRAFT, OfferStatusEnum.SENT)
_APPROVED_OR_BEYOND_STATUSES = (
    VacancyRequestStatusEnum.APPROVED,
    VacancyRequestStatusEnum.PUBLISHED,
    VacancyRequestStatusEnum.CLOSED,
)
# A VacancyRequest in any of these statuses is no longer "urgent" in any
# actionable sense -- it's either done (CLOSED) or dead (REJECTED/CANCELLED).
_VACANCY_REQUEST_NOT_URGENT_STATUSES = (
    VacancyRequestStatusEnum.CLOSED,
    VacancyRequestStatusEnum.REJECTED,
    VacancyRequestStatusEnum.CANCELLED,
)

# application_pipeline_funnel (Step 3, dashboard-kpi-additions-backend) --
# collapses the real 12-value ApplicationStatusEnum into the coarser funnel
# language used elsewhere in this refinement effort. Exhaustive over every
# current enum member (verified: 1+1+2+1+2+5+2 = 12 members, one bucket
# each). The Postgres native `application_status_enum` type also still
# physically contains 8 pre-rename legacy labels (ELIGIBLE, SHORTLISTED,
# INTERVIEW_SCHEDULED, TECHNICAL_INTERVIEW, HR_INTERVIEW, JOINING_PENDING,
# ONBOARDING_COMPLETE, EMPLOYEE_CREATED -- see ApplicationStatusEnum's own
# docstring) that Postgres can never DROP VALUE. They are NOT included in
# this map: migration ba2e30350b8a already forward-UPDATEd every real
# `applications.status` row off of these labels the moment they were retired,
# and no code has written them since (ApplicationStatusEnum, the Python enum
# actually used to construct new rows, doesn't even have these members
# anymore). A row that somehow still carried one of these labels couldn't be
# hydrated by this query anyway -- SQLAlchemy's native `Enum` type raises a
# lookup error converting a string outside the mapped Python enum's members
# back into that enum on any `Application.status`-selecting query in this
# codebase, not just this one -- so there's nothing to defensively fold here.
_FUNNEL_BUCKET_ORDER: tuple[str, ...] = (
    "Applied",
    "Screening",
    "Interview",
    "Selected",
    "Offer",
    "Joined",
    "Rejected",
)
_FUNNEL_BUCKET_BY_STATUS: dict[ApplicationStatusEnum, str] = {
    ApplicationStatusEnum.APPLIED: "Applied",
    ApplicationStatusEnum.SCREENING: "Screening",
    ApplicationStatusEnum.CALLED_FOR_INTERVIEW: "Interview",
    ApplicationStatusEnum.INTERVIEWED: "Interview",
    ApplicationStatusEnum.SELECTED: "Selected",
    ApplicationStatusEnum.OFFER_SENT: "Offer",
    ApplicationStatusEnum.OFFER_ACCEPTED: "Offer",
    ApplicationStatusEnum.JOINING_CONFIRMED: "Joined",
    ApplicationStatusEnum.JOINED: "Joined",
    ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED: "Joined",
    ApplicationStatusEnum.ORIENTATION_COMPLETE: "Joined",
    ApplicationStatusEnum.HANDED_OVER_TO_HOD: "Joined",
    ApplicationStatusEnum.REJECTED: "Rejected",
    ApplicationStatusEnum.WITHDRAWN: "Rejected",
}
assert set(_FUNNEL_BUCKET_BY_STATUS) == set(ApplicationStatusEnum), (
    "application_pipeline_funnel's bucket map must cover every ApplicationStatusEnum member exactly once"
)

# critical_vacancies (Step 3, dashboard-kpi-additions-backend).
_CRITICAL_VACANCY_STATUS = "VACANCY_RECRUITMENT_REQUIRED"
_CRITICAL_VACANCY_LIMIT = 10
# Large enough to fetch every real VACANCY_RECRUITMENT_REQUIRED row in one
# call per category rather than risk truncating before the Python-side
# cross-category sort -- there is no unpaginated mode on these functions, but
# passing `status=` lets Postgres/Python do the status filtering already
# built into list_strength_view_rows/list_housekeeping_strength_rows instead
# of re-filtering in this module, so this is the only extra knob needed.
_CRITICAL_VACANCY_FETCH_LIMIT = 5000


def validate_campus_code(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    if normalized not in CAMPUS_CODES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown campus_code '{value}'. Valid campus codes: {', '.join(CAMPUS_CODES)}.",
        )
    return normalized


def validate_role_category(value: str | None) -> StaffRoleCategoryEnum | None:
    if value is None:
        return None
    if value not in StaffRoleCategoryEnum.__members__:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown role_category '{value}'. Valid values: {', '.join(StaffRoleCategoryEnum.__members__)}.",
        )
    return StaffRoleCategoryEnum[value]


def validate_date_range(start_date: date | None, end_date: date | None) -> None:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="start_date must not be after end_date",
        )


def _optional_date_range(start_date: date | None, end_date: date | None) -> tuple[datetime | None, datetime | None]:
    """UTC datetime bounds for filtering a report by a business timestamp, or
    (None, None) when neither was given -- callers only apply a filter when
    the respective bound isn't None, so omitting both preserves the exact
    prior all-time behavior of every report builder."""
    range_start = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc) if start_date else None
    range_end = (
        datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
        if end_date
        else None
    )
    return range_start, range_end


def _time_to_hire_days(
    db: Session,
    campus_id_filter,
    role_category: StaffRoleCategoryEnum | None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[dict]:
    query = (
        db.query(Employee, Application, JoiningRecord, VacancyRequest, Campus)
        .join(Application, Employee.application_id == Application.id)
        .join(JoiningRecord, JoiningRecord.application_id == Application.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .join(Campus, Employee.campus_id == Campus.id)
        .filter(JoiningRecord.actual_joining_date.isnot(None))
    )
    if campus_id_filter is not None:
        query = query.filter(Employee.campus_id == campus_id_filter)
    if role_category is not None:
        query = query.filter(VacancyRequest.role_category == role_category)
    if start_date is not None:
        query = query.filter(JoiningRecord.actual_joining_date >= start_date)
    if end_date is not None:
        query = query.filter(JoiningRecord.actual_joining_date <= end_date)

    results = []
    for employee, application, joining_record, vacancy_request, campus in query.all():
        days = (joining_record.actual_joining_date - application.applied_at.date()).days
        results.append({"campus_code": campus.code, "role_category": vacancy_request.role_category.value, "days": days})
    return results


def _sanctioned_strength_totals(
    db: Session,
    campus_id_filter,
    role_category: StaffRoleCategoryEnum | None,
    department_id: uuid.UUID | None = None,
    designation_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
) -> tuple[int, int, int, int]:
    """Phase I (glowing-zooming-hamming.md) dashboard tile. Reuses
    `current_effective_rows`/`working_count_for` (this module's own
    sanctioned-strength resolvers -- the exact per-row call shape
    `sanctioned_strength_reconciliation_report` above already makes, so a
    HOUSEKEEPING row's working count reflects live `HousekeepingStaff`, not
    `Employee`) rather than a parallel computation.

    `sanctioned_vacancy_total = sanctioned_approved_total -
    sanctioned_working_total`, computed from the two summed totals --
    deliberately NOT the sum of each row's own vacancy floored at 0 first
    (unlike vacancy_register.py's per-row `vacancy_count`, or this module's
    own reconciliation report's `over_by`, both of which describe a single
    key's own local vacancy/overcommit and so floor so "no vacancy" and
    "overstaffed" both read as 0). Flooring each row first and summing after
    would silently discard every overstaffed row's negative contribution
    instead of letting it net against real vacancies elsewhere, and would
    systematically overstate this aggregate. The plain
    `approved_total - working_total` is the honest net figure for a single
    top-line dashboard number -- a negative result means the scope (this
    campus, or system-wide) is net overstaffed overall, not that there are
    no vacancies.
    """
    current_rows = current_effective_rows(db, campus_id=campus_id_filter)
    if role_category is not None:
        current_rows = [row for row in current_rows if row.category == role_category]
    # Drill-down filters (2026-08-30). Applied in Python against the rows this
    # resolver already returned, matching this module's established
    # batch-then-filter style rather than pushing predicates into
    # current_effective_rows, whose signature every other caller shares.
    if department_id is not None:
        current_rows = [row for row in current_rows if row.department_id == department_id]
    if designation_id is not None:
        current_rows = [row for row in current_rows if row.designation_id == designation_id]
    if location_id is not None:
        current_rows = [row for row in current_rows if row.location_id == location_id]

    approved_total = sum(row.approved_strength for row in current_rows)
    working_total = sum(_resolved_working(db, row) for row in current_rows)
    vacancy_total = approved_total - working_total
    recruitment_required_count = sum(
        1 for row in current_rows if row.approved_strength - _resolved_working(db, row) > 0
    )
    return approved_total, working_total, vacancy_total, recruitment_required_count


def _resolved_working(db: Session, row) -> int:
    """One current-effective row's Working figure, honouring `working_override`.

    Routed through `resolved_working_for` (2026-08-30) so this dashboard tile
    reports the SAME number the Sanctioned Strength screen does. It previously
    called `working_count_for` directly, which meant a manually-entered
    headcount showed on the Sanctioned Strength page but not here -- and since
    this deployment has no HR feed, that gap read as Working 0 / Vacancy =
    Approved on a dashboard sitting next to a page showing real figures.

    Note this is deliberately NOT the same decision as
    `sanctioned_strength_reconciliation_report`, which still counts live
    Employee rows on purpose: that report exists precisely to compare the
    sanction against the actual roster, so an override must not launder
    itself into it. This tile is a summary of the operational view, so it
    must agree with the operational view.
    """
    return resolved_working_for(
        row,
        working_count_for(
            db,
            department_id=row.department_id,
            designation_id=row.designation_id,
            category=row.category,
            location_id=row.location_id,
        ),
    )


def _vacancy_by_dimension(
    db: Session,
    campus_id_filter,
    role_category: StaffRoleCategoryEnum | None,
    *,
    department_id: uuid.UUID | None = None,
    designation_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
    dimension: str,
) -> list[dict]:
    """Vacancy grouped by department / campus / category, for the dashboard's
    three vacancy charts (2026-08-30).

    Built from the SAME `current_effective_rows` + `_resolved_working` pair
    the top-line tiles use, so a chart can never disagree with the number in
    the KPI card above it -- the failure mode of computing each chart from its
    own query. Every filter the tiles honour is honoured here too, which is
    what makes "Campus = SSE, Category = Teaching, Department = CSE" narrow
    the charts as well as the cards.

    `vacancy` is signed, not floored: an overstaffed department contributes
    its negative figure so the bars net honestly against each other, matching
    `_sanctioned_strength_totals`' own documented choice. Callers wanting a
    "recruitment required" view should filter on `vacancy > 0` rather than
    relying on a floor applied here.

    Rows with zero approved AND zero working are dropped -- they carry no
    information and would pad a bar chart with empty categories. A group that
    is genuinely all-zero because everything is filled still appears, with
    vacancy 0, because that IS meaningful.
    """
    current_rows = current_effective_rows(db, campus_id=campus_id_filter)
    if role_category is not None:
        current_rows = [row for row in current_rows if row.category == role_category]
    if department_id is not None:
        current_rows = [row for row in current_rows if row.department_id == department_id]
    if designation_id is not None:
        current_rows = [row for row in current_rows if row.designation_id == designation_id]
    if location_id is not None:
        current_rows = [row for row in current_rows if row.location_id == location_id]

    if dimension == "department":
        names = dict(db.query(Department.id, Department.name).all())
        key_of = lambda row: row.department_id  # noqa: E731
        label_of = lambda key: names.get(key, "Unknown")  # noqa: E731
    elif dimension == "campus":
        names = dict(db.query(Campus.id, Campus.code).all())
        key_of = lambda row: row.campus_id  # noqa: E731
        label_of = lambda key: names.get(key, "Unknown")  # noqa: E731
    elif dimension == "category":
        key_of = lambda row: row.category  # noqa: E731
        label_of = lambda key: key.value  # noqa: E731
    else:  # pragma: no cover - guarded by the three call sites above
        raise ValueError(f"Unknown dimension {dimension!r}")

    buckets: dict = {}
    for row in current_rows:
        key = key_of(row)
        approved, working = buckets.get(key, (0, 0))
        buckets[key] = (approved + row.approved_strength, working + _resolved_working(db, row))

    results = [
        {
            "key": str(key.value if hasattr(key, "value") else key),
            "label": label_of(key),
            "approved": approved,
            "working": working,
            "vacancy": approved - working,
        }
        for key, (approved, working) in buckets.items()
        if approved or working
    ]
    # Highest vacancy first -- the dashboard's charts and table both lead with
    # where recruitment is most needed.
    results.sort(key=lambda r: (-r["vacancy"], r["label"]))
    return results


def _critical_vacancy_rows(db: Session, scope: CampusScope, campus_code: str | None) -> list[dict]:
    """Top-10 (across all 3 categories combined) VACANCY_RECRUITMENT_REQUIRED
    rows for the `critical_vacancies` dashboard card -- reuses the existing
    Phase E/F/G Sanctioned Strength view functions
    (`list_teaching_strength_rows` / `list_strength_view_rows(...,
    NON_TEACHING)` / `list_housekeeping_strength_rows`) rather than a new
    query, via each function's own `status=` filter kwarg (so the
    VACANCY_RECRUITMENT_REQUIRED filtering happens inside those functions,
    not re-done here in Python) and a large `limit` so nothing is truncated
    before this function's own cross-category sort/top-10 cut.

    Department scope: these view functions take a `DepartmentScope` alongside
    `CampusScope` (Phase 4 of the permission-matrix epic), but
    `GET /dashboard/kpis` has never threaded department-scope through any of
    its other aggregations (`_sanctioned_strength_totals` above calls
    `current_effective_rows` the same way, with no department scope either)
    -- so this passes the unrestricted `DepartmentScope` instance
    (`is_restricted=False`), matching this endpoint's existing behavior
    rather than introducing department scoping nowhere else on this endpoint
    has it.

    Housekeeping rows have a genuinely different grain (Location, not
    department/designation -- see `list_housekeeping_strength_rows`'s own
    docstring) and so have no `department_name`/`designation_name` fields at
    all. Mapped onto this card's uniform (department, designation, location)
    shape as a judgment call: `department="Housekeeping"` (there is no real
    department concept at this grain; `category` already says
    "HOUSEKEEPING" so this is mostly a human-readable label) and
    `designation=<location_name>` (a housekeeping row's location *is* its
    identifying dimension, the closest analogue to a Teaching/Non-Teaching
    row's designation), with `location=<block>` filled in as the finer-
    grained sub-location detail. Flagged here since the plan's row shape was
    written with Teaching/Non-Teaching's department+designation grain in
    mind and doesn't have a clean fit for Housekeeping's Location grain.
    """
    unrestricted_dept_scope = DepartmentScope(is_restricted=False, department_ids=None)
    rows: list[dict] = []

    teaching_rows, *_rest = list_teaching_strength_rows(
        db,
        scope,
        unrestricted_dept_scope,
        limit=_CRITICAL_VACANCY_FETCH_LIMIT,
        offset=0,
        sort_by="vacancy",
        sort_dir="desc",
        campus_code=campus_code,
        status=_CRITICAL_VACANCY_STATUS,
    )
    for row in teaching_rows:
        rows.append(
            {
                "department": row["department_name"] or "-",
                "designation": row["designation_name"] or "-",
                "location": row["location_name"],
                "category": StaffRoleCategoryEnum.TEACHING.value,
                "vacancy_count": row["vacancy"],
            }
        )

    non_teaching_rows, *_rest = list_strength_view_rows(
        db,
        scope,
        unrestricted_dept_scope,
        category=StaffRoleCategoryEnum.NON_TEACHING,
        limit=_CRITICAL_VACANCY_FETCH_LIMIT,
        offset=0,
        sort_by="vacancy",
        sort_dir="desc",
        campus_code=campus_code,
        status=_CRITICAL_VACANCY_STATUS,
    )
    for row in non_teaching_rows:
        rows.append(
            {
                "department": row["department_name"] or "-",
                "designation": row["designation_name"] or "-",
                "location": row["location_name"],
                "category": StaffRoleCategoryEnum.NON_TEACHING.value,
                "vacancy_count": row["vacancy"],
            }
        )

    housekeeping_rows, *_rest = list_housekeeping_strength_rows(
        db,
        scope,
        unrestricted_dept_scope,
        limit=_CRITICAL_VACANCY_FETCH_LIMIT,
        offset=0,
        sort_by="vacancy",
        sort_dir="desc",
        campus_code=campus_code,
        status=_CRITICAL_VACANCY_STATUS,
    )
    for row in housekeeping_rows:
        rows.append(
            {
                "department": "Housekeeping",
                "designation": row["location_name"] or "-",
                "location": row["block"],
                "category": StaffRoleCategoryEnum.HOUSEKEEPING.value,
                "vacancy_count": row["vacancy"],
            }
        )

    rows.sort(key=lambda r: r["vacancy_count"], reverse=True)
    return rows[:_CRITICAL_VACANCY_LIMIT]


def dashboard_strength_table_rows(
    db: Session,
    scope: CampusScope,
    *,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    department_id: uuid.UUID | None = None,
    designation_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
    recruitment_status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """The dashboard's main table: one row per current-effective sanctioned
    strength row, with the full Campus/Department/Designation/Category/
    Location/Sanctioned/Working/Vacancy/Filled%/Status shape (2026-08-30).

    Reuses the same three Sanctioned Strength view services the operational
    screens use (`list_teaching_strength_rows`,
    `list_strength_view_rows(..., NON_TEACHING)`,
    `list_housekeeping_strength_rows`) rather than adding a fourth query, so
    Working here honours `working_override` exactly as those screens do and
    the table cannot disagree with the screen it mirrors.

    Deliberately NOT `_critical_vacancy_rows`, which this sits beside: that
    one hard-filters to VACANCY_RECRUITMENT_REQUIRED and cuts to ten, because
    it backs a "what is worst right now" card. A main table showing only
    understaffed rows could never render a FULLY_STAFFED or OVERSTAFFED badge,
    which the brief explicitly asks for -- so `recruitment_status` here is an
    OPTIONAL filter, absent by default.

    Housekeeping's genuinely different grain (Location, not
    department+designation) is mapped the same way `_critical_vacancy_rows`
    maps it, so the two never describe the same row differently -- see that
    function's docstring for the reasoning.

    Sorted by vacancy descending across all categories, per the brief's "sort
    by highest vacancy first". `total` is the count before the offset/limit
    slice so a caller can paginate.
    """
    unrestricted_dept_scope = DepartmentScope(is_restricted=False, department_ids=None)
    rows: list[dict] = []

    def _wanted(category: StaffRoleCategoryEnum) -> bool:
        return role_category is None or role_category == category

    common = {
        "limit": _CRITICAL_VACANCY_FETCH_LIMIT,
        "offset": 0,
        "sort_by": "vacancy",
        "sort_dir": "desc",
        "campus_code": campus_code,
        "status": recruitment_status,
    }

    if _wanted(StaffRoleCategoryEnum.TEACHING):
        teaching_rows, *_rest = list_teaching_strength_rows(db, scope, unrestricted_dept_scope, **common)
        rows.extend(
            _dashboard_table_row(row, StaffRoleCategoryEnum.TEACHING) for row in teaching_rows
        )

    if _wanted(StaffRoleCategoryEnum.NON_TEACHING):
        non_teaching_rows, *_rest = list_strength_view_rows(
            db, scope, unrestricted_dept_scope, category=StaffRoleCategoryEnum.NON_TEACHING, **common
        )
        rows.extend(
            _dashboard_table_row(row, StaffRoleCategoryEnum.NON_TEACHING) for row in non_teaching_rows
        )

    if _wanted(StaffRoleCategoryEnum.HOUSEKEEPING):
        housekeeping_rows, *_rest = list_housekeeping_strength_rows(db, scope, unrestricted_dept_scope, **common)
        rows.extend(_housekeeping_table_row(row) for row in housekeeping_rows)

    # department/designation/location narrowing happens here rather than being
    # pushed into each view function: the Housekeeping view has no
    # department_id or designation_id at all, so a shared predicate applied
    # after row-shaping is the only place all three categories can be filtered
    # consistently.
    if department_id is not None:
        rows = [row for row in rows if row["department_id"] == str(department_id)]
    if designation_id is not None:
        rows = [row for row in rows if row["designation_id"] == str(designation_id)]
    if location_id is not None:
        rows = [row for row in rows if row["location_id"] == str(location_id)]

    rows.sort(key=lambda r: r["vacancy"], reverse=True)
    return rows[offset : offset + limit], len(rows)


def _dashboard_table_row(row: dict, category: StaffRoleCategoryEnum) -> dict:
    """Teaching/Non-Teaching view row -> the dashboard table's shape."""
    return {
        "sanctioned_strength_id": str(row["sanctioned_strength_id"]),
        "campus_code": row.get("campus_code"),
        "department_id": str(row["department_id"]) if row.get("department_id") else None,
        "department_name": row.get("department_name") or "-",
        "designation_id": str(row["designation_id"]) if row.get("designation_id") else None,
        "designation_name": row.get("designation_name") or "-",
        "category": category.value,
        "location_id": str(row["location_id"]) if row.get("location_id") else None,
        "location_name": row.get("location_name"),
        "approved": row["approved"],
        "working": row["working"],
        "vacancy": row["vacancy"],
        "filled_pct": row.get("filled_pct"),
        "status": row["status"],
    }


def _housekeeping_table_row(row: dict) -> dict:
    """Housekeeping is Location-grained, so it has no department/designation
    to report. Mapped exactly as `_critical_vacancy_rows` maps it so the two
    surfaces never describe one row two ways: the location stands in for the
    designation, and there is no real department at this grain.

    Its `vacancy` is already floored at 0 by that view (unlike Teaching's
    signed figure) -- see `list_housekeeping_strength_rows`. Left as the view
    reports it rather than re-derived here, so the dashboard table and the
    Housekeeping screen agree.
    """
    return {
        "sanctioned_strength_id": None,
        "campus_code": row.get("campus_code"),
        "department_id": None,
        "department_name": "Housekeeping",
        "designation_id": None,
        "designation_name": row.get("location_name") or "-",
        "category": StaffRoleCategoryEnum.HOUSEKEEPING.value,
        "location_id": str(row["location_id"]) if row.get("location_id") else None,
        "location_name": row.get("block"),
        "approved": row["required"],
        "working": row["available"],
        "vacancy": row["vacancy"],
        "filled_pct": None if not row["required"] else round(row["available"] / row["required"] * 100, 1),
        "status": row["status"],
    }


def _recent_employee_rows(employees: list[Employee], event_date_attr: str) -> list[dict]:
    """Shared row-shaping for `recent_joins`/`recent_resignations` --
    `event_date_attr` is `"date_of_joining"` or `"separation_date"`, the
    Employee column each of those two fields is ordered by. Uses
    `Employee.designation` (the plain, always-populated string column) and
    `Employee.department.name` (relationship-traversed, may be None --
    `Employee.department_id` is nullable)."""
    return [
        {
            "employee_name": employee.full_name,
            "department": employee.department.name if employee.department is not None else None,
            "designation": employee.designation,
            "campus": employee.campus.code,
            "date": getattr(employee, event_date_attr),
        }
        for employee in employees
    ]


def get_dashboard_kpis(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    department_id: uuid.UUID | None = None,
    designation_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    # "Today" cards (interviews/joinings) fall back to the literal calendar
    # day when no range is given, preserving prior behavior exactly; a range
    # widens that window instead of always meaning "today".
    if start_date is not None or end_date is not None:
        range_start = (
            datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc) if start_date else today_start
        )
        range_end = (
            datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
            if end_date
            else today_end
        )
    else:
        range_start, range_end = today_start, today_end

    app_query = db.query(Application)
    if role_category is not None:
        app_query = (
            app_query.join(JobPosting, Application.job_posting_id == JobPosting.id)
            .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.role_category == role_category)
        )
    if campus_id_filter is not None:
        app_query = app_query.filter(Application.campus_id == campus_id_filter)
    # Only apply date narrowing when a range was actually requested -- the
    # no-args call must keep returning the exact same all-time count as
    # before this parameter existed.
    if start_date is not None:
        app_query = app_query.filter(Application.applied_at >= range_start)
    if end_date is not None:
        app_query = app_query.filter(Application.applied_at < range_end)
    total_applications = app_query.count()

    rejected_count = app_query.filter(Application.status == ApplicationStatusEnum.REJECTED).count()
    withdrawn_count = app_query.filter(Application.status == ApplicationStatusEnum.WITHDRAWN).count()

    source_bucket = case(
        (Candidate.source.ilike("%referr%"), "Reference"),
        (Candidate.source.ilike("%mail%"), "Mail"),
        else_="Other",
    )
    source_query = app_query.join(Candidate, Application.candidate_id == Candidate.id).with_entities(
        source_bucket, func.count(Application.id)
    ).group_by(source_bucket)
    source_wise_breakdown = [{"source": bucket, "count": count} for bucket, count in source_query.all()]

    slot_query = (
        db.query(HiringSlot)
        .join(ApprovedVacancy, HiringSlot.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .filter(HiringSlot.status == HiringSlotStatusEnum.OPEN)
    )
    if campus_id_filter is not None:
        slot_query = slot_query.filter(ApprovedVacancy.campus_id == campus_id_filter)
    if role_category is not None:
        slot_query = slot_query.filter(VacancyRequest.role_category == role_category)
    open_positions = slot_query.count()

    interview_query = (
        db.query(InterviewSchedule)
        .join(Application, InterviewSchedule.application_id == Application.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .filter(
            InterviewSchedule.status == InterviewScheduleStatusEnum.SCHEDULED,
            InterviewSchedule.scheduled_at >= range_start,
            InterviewSchedule.scheduled_at < range_end,
        )
    )
    if campus_id_filter is not None:
        interview_query = interview_query.filter(InterviewSchedule.campus_id == campus_id_filter)
    if role_category is not None:
        interview_query = interview_query.filter(VacancyRequest.role_category == role_category)
    interviews_today = interview_query.count()

    joining_today_query = (
        db.query(JoiningRecord)
        .join(Application, JoiningRecord.application_id == Application.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .filter(
            JoiningRecord.actual_joining_date >= range_start.date(),
            JoiningRecord.actual_joining_date < range_end.date(),
        )
    )
    if campus_id_filter is not None:
        joining_today_query = joining_today_query.filter(Application.campus_id == campus_id_filter)
    if role_category is not None:
        joining_today_query = joining_today_query.filter(VacancyRequest.role_category == role_category)
    joinings_today = joining_today_query.count()

    offer_query = (
        db.query(Offer)
        .join(Application, Offer.application_id == Application.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .filter(Offer.status.in_(_NON_TERMINAL_OFFER_STATUSES))
    )
    if campus_id_filter is not None:
        offer_query = offer_query.filter(Application.campus_id == campus_id_filter)
    if role_category is not None:
        offer_query = offer_query.filter(VacancyRequest.role_category == role_category)
    if start_date is not None:
        offer_query = offer_query.filter(Offer.created_at >= range_start)
    if end_date is not None:
        offer_query = offer_query.filter(Offer.created_at < range_end)
    offers_pending = offer_query.count()

    hiring_query = db.query(Campus.code, func.count(Employee.id)).select_from(Employee).join(
        Campus, Employee.campus_id == Campus.id
    )
    if role_category is not None:
        hiring_query = (
            hiring_query.join(Application, Employee.application_id == Application.id)
            .join(JobPosting, Application.job_posting_id == JobPosting.id)
            .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.role_category == role_category)
        )
    if campus_id_filter is not None:
        hiring_query = hiring_query.filter(Employee.campus_id == campus_id_filter)
    hiring_query = hiring_query.group_by(Campus.code)
    hired_by_campus = dict(hiring_query.all())

    # Same open/in-progress grouping build_ad_briefing_summary already
    # computes per (campus, role_category) -- collapsed to campus-only here
    # for the dashboard's campus-wise table.
    open_by_campus_query = (
        db.query(Campus.code, func.count(HiringSlot.id))
        .select_from(HiringSlot)
        .join(ApprovedVacancy, HiringSlot.approved_vacancy_id == ApprovedVacancy.id)
        .join(Campus, ApprovedVacancy.campus_id == Campus.id)
        .filter(HiringSlot.status == HiringSlotStatusEnum.OPEN)
    )
    if role_category is not None:
        open_by_campus_query = open_by_campus_query.join(
            VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id
        ).filter(VacancyRequest.role_category == role_category)
    if campus_id_filter is not None:
        open_by_campus_query = open_by_campus_query.filter(ApprovedVacancy.campus_id == campus_id_filter)
    open_by_campus = dict(open_by_campus_query.group_by(Campus.code).all())

    in_progress_by_campus_query = (
        db.query(Campus.code, func.count(Application.id))
        .select_from(Application)
        .join(Campus, Application.campus_id == Campus.id)
        .filter(~Application.status.in_(APPLICATION_TERMINAL_STATUSES))
    )
    if role_category is not None:
        in_progress_by_campus_query = (
            in_progress_by_campus_query.join(JobPosting, Application.job_posting_id == JobPosting.id)
            .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.role_category == role_category)
        )
    if campus_id_filter is not None:
        in_progress_by_campus_query = in_progress_by_campus_query.filter(Application.campus_id == campus_id_filter)
    in_progress_by_campus = dict(in_progress_by_campus_query.group_by(Campus.code).all())

    # Campuses with zero activity across all three metrics used to silently
    # disappear from this table entirely -- a genuinely-empty campus and a
    # bug that dropped it were indistinguishable to the viewer. Always start
    # from the resolved scope's own campus code(s) -- either the single
    # selected campus or every active campus -- so a real zero-everywhere
    # campus still gets a zero-filled row instead of vanishing (CLAUDE.md
    # B3; campus_id is NOT NULL on VacancyRequest, so nothing is actually
    # nullable here -- the disappearing-row symptom was real, the ticket's
    # "nullable campus" diagnosis wasn't).
    if campus_id_filter is not None:
        scoped_campus_codes = {code for (code,) in db.query(Campus.code).filter(Campus.id == campus_id_filter).all()}
    else:
        scoped_campus_codes = {code for (code,) in db.query(Campus.code).filter(Campus.is_active.is_(True)).all()}
    all_campus_codes = scoped_campus_codes | set(hired_by_campus) | set(open_by_campus) | set(in_progress_by_campus)
    campus_wise_hiring = [
        {
            "campus_code": code,
            "hired_count": hired_by_campus.get(code, 0),
            "open_count": open_by_campus.get(code, 0),
            "in_progress_count": in_progress_by_campus.get(code, 0),
        }
        for code in sorted(all_campus_codes)
    ]

    # category_wise_breakdown -- always all 3 StaffRoleCategoryEnum values,
    # regardless of this call's own role_category filter (see the module
    # docstring). Respects campus scope like every other field; applications
    # additionally respects start_date/end_date like total_applications does.
    apps_by_category_query = db.query(Application.role_category, func.count(Application.id))
    if campus_id_filter is not None:
        apps_by_category_query = apps_by_category_query.filter(Application.campus_id == campus_id_filter)
    if start_date is not None:
        apps_by_category_query = apps_by_category_query.filter(Application.applied_at >= range_start)
    if end_date is not None:
        apps_by_category_query = apps_by_category_query.filter(Application.applied_at < range_end)
    apps_by_category = dict(apps_by_category_query.group_by(Application.role_category).all())

    open_by_category_query = (
        db.query(VacancyRequest.role_category, func.count(HiringSlot.id))
        .select_from(HiringSlot)
        .join(ApprovedVacancy, HiringSlot.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .filter(HiringSlot.status == HiringSlotStatusEnum.OPEN)
    )
    if campus_id_filter is not None:
        open_by_category_query = open_by_category_query.filter(ApprovedVacancy.campus_id == campus_id_filter)
    open_by_category = dict(open_by_category_query.group_by(VacancyRequest.role_category).all())

    hires_by_category_query = (
        db.query(Application.role_category, func.count(Employee.id))
        .select_from(Employee)
        .join(Application, Employee.application_id == Application.id)
    )
    if campus_id_filter is not None:
        hires_by_category_query = hires_by_category_query.filter(Employee.campus_id == campus_id_filter)
    hires_by_category = dict(hires_by_category_query.group_by(Application.role_category).all())

    category_wise_breakdown = [
        {
            "role_category": category.value,
            "applications": apps_by_category.get(category, 0),
            "open_positions": open_by_category.get(category, 0),
            "hires": hires_by_category.get(category, 0),
        }
        for category in StaffRoleCategoryEnum
    ]

    ttf_entries = _time_to_hire_days(db, campus_id_filter, role_category)
    average_time_to_hire_days = (
        round(sum(e["days"] for e in ttf_entries) / len(ttf_entries), 1) if ttf_entries else None
    )

    vr_base_query = db.query(VacancyRequest).filter(VacancyRequest.status.in_(_APPROVED_OR_BEYOND_STATUSES))
    if campus_id_filter is not None:
        vr_base_query = vr_base_query.filter(VacancyRequest.campus_id == campus_id_filter)
    if role_category is not None:
        vr_base_query = vr_base_query.filter(VacancyRequest.role_category == role_category)
    ever_approved = vr_base_query.count()
    closed = vr_base_query.filter(VacancyRequest.status == VacancyRequestStatusEnum.CLOSED).count()
    # None (not 0.0) with nothing to compute from -- 0.0 previously read as
    # "confirmed zero closure rate" even when there was no APPROVED-or-beyond
    # request in scope at all (CLAUDE.md B1). DRAFT/CANCELLED/REJECTED are
    # already excluded from both closed and ever_approved -- neither is in
    # _APPROVED_OR_BEYOND_STATUSES.
    vacancy_closure_rate_pct = round(closed / ever_approved * 100, 1) if ever_approved else None

    # Phase I (glowing-zooming-hamming.md) -- unlike category_wise_breakdown
    # above, these three respect this call's own role_category filter, same
    # as every other top-line KPI field (open_positions, interviews_today,
    # ...); they're top-strip tiles, not the always-all-3-categories card.
    (
        sanctioned_approved_total,
        sanctioned_working_total,
        sanctioned_vacancy_total,
        recruitment_required_count,
    ) = _sanctioned_strength_totals(
        db,
        campus_id_filter,
        role_category,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
    )

    # Pending Requests / Pending Approvals (2026-08-30) -- the two-stage
    # Dean -> HR workflow split into two NON-OVERLAPPING counts, so the two
    # KPI cards never double-count the same request: SUBMITTED is waiting on
    # a Dean, DEAN_APPROVED is waiting on HR's final approval. Current-state
    # counts, no date-range filter, same convention as urgent_vacancy_count
    # below.
    pending_base = db.query(VacancyRequest)
    if campus_id_filter is not None:
        pending_base = pending_base.filter(VacancyRequest.campus_id == campus_id_filter)
    if role_category is not None:
        pending_base = pending_base.filter(VacancyRequest.role_category == role_category)
    if department_id is not None:
        pending_base = pending_base.filter(VacancyRequest.department_id == department_id)
    if designation_id is not None:
        pending_base = pending_base.filter(VacancyRequest.designation_id == designation_id)
    pending_requests_count = pending_base.filter(
        VacancyRequest.status == VacancyRequestStatusEnum.SUBMITTED
    ).count()
    pending_approvals_count = pending_base.filter(
        VacancyRequest.status == VacancyRequestStatusEnum.DEAN_APPROVED
    ).count()

    vacancy_by_department = _vacancy_by_dimension(
        db,
        campus_id_filter,
        role_category,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
        dimension="department",
    )
    vacancy_by_campus = _vacancy_by_dimension(
        db,
        campus_id_filter,
        role_category,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
        dimension="campus",
    )
    vacancy_by_category = _vacancy_by_dimension(
        db,
        campus_id_filter,
        role_category,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
        dimension="category",
    )

    # urgent_vacancy_count (Step 3, dashboard-kpi-additions-backend) -- a
    # current-state count (no date-range filter, unlike the "today" cards
    # above), so an already-CLOSED/REJECTED/CANCELLED request no longer
    # counts as "urgent". role_category filters directly against
    # VacancyRequest's own native column -- no join needed, unlike
    # Application-based fields elsewhere in this function.
    urgent_query = db.query(VacancyRequest).filter(
        VacancyRequest.priority == VacancyPriorityEnum.URGENT,
        ~VacancyRequest.status.in_(_VACANCY_REQUEST_NOT_URGENT_STATUSES),
    )
    if campus_id_filter is not None:
        urgent_query = urgent_query.filter(VacancyRequest.campus_id == campus_id_filter)
    if role_category is not None:
        urgent_query = urgent_query.filter(VacancyRequest.role_category == role_category)
    urgent_vacancy_count = urgent_query.count()

    # application_pipeline_funnel (Step 3) -- a single grouped-count query
    # (not 7), current-snapshot (no date-range filter), scoped the same way
    # total_applications is (join-through-VacancyRequest only when
    # role_category is given). See _FUNNEL_BUCKET_BY_STATUS above for the
    # full status -> bucket mapping and the legacy-label non-issue note.
    funnel_query = db.query(Application.status, func.count(Application.id))
    if role_category is not None:
        funnel_query = (
            funnel_query.join(JobPosting, Application.job_posting_id == JobPosting.id)
            .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.role_category == role_category)
        )
    if campus_id_filter is not None:
        funnel_query = funnel_query.filter(Application.campus_id == campus_id_filter)
    funnel_counts_by_status = dict(funnel_query.group_by(Application.status).all())
    funnel_bucket_counts = dict.fromkeys(_FUNNEL_BUCKET_ORDER, 0)
    for status_value, count in funnel_counts_by_status.items():
        funnel_bucket_counts[_FUNNEL_BUCKET_BY_STATUS[status_value]] += count
    application_pipeline_funnel = [
        {"stage": stage, "count": funnel_bucket_counts[stage]} for stage in _FUNNEL_BUCKET_ORDER
    ]

    # critical_vacancies (Step 3) -- see _critical_vacancy_rows's own
    # docstring for the reuse/scoping/Housekeeping-field-mapping notes.
    # Deliberately ignores this call's own role_category filter (like
    # category_wise_breakdown) -- it's an always-all-3-categories "what needs
    # attention" card, not a top-line KPI tile the role_category param narrows.
    critical_vacancies = _critical_vacancy_rows(db, scope, campus_code)

    # recent_joins / recent_resignations (Step 3) -- top 10 Employee rows,
    # scoped by campus like every other field. recent_resignations excludes
    # RESIGNED rows with a null separation_date (shouldn't happen in
    # practice, but ordering by a nullable column isn't nulls-safe by
    # default) rather than crash on one.
    recent_joins_query = db.query(Employee).order_by(Employee.date_of_joining.desc())
    if campus_id_filter is not None:
        recent_joins_query = recent_joins_query.filter(Employee.campus_id == campus_id_filter)
    recent_joins = _recent_employee_rows(recent_joins_query.limit(10).all(), "date_of_joining")

    recent_resignations_query = (
        db.query(Employee)
        .filter(Employee.employment_status == EmploymentStatusEnum.RESIGNED, Employee.separation_date.isnot(None))
        .order_by(Employee.separation_date.desc())
    )
    if campus_id_filter is not None:
        recent_resignations_query = recent_resignations_query.filter(Employee.campus_id == campus_id_filter)
    recent_resignations = _recent_employee_rows(recent_resignations_query.limit(10).all(), "separation_date")

    return {
        "scope_note": scope_note,
        "total_applications": total_applications,
        "open_positions": open_positions,
        "interviews_today": interviews_today,
        "joinings_today": joinings_today,
        "offers_pending": offers_pending,
        "campus_wise_hiring": campus_wise_hiring,
        "category_wise_breakdown": category_wise_breakdown,
        "average_time_to_hire_days": average_time_to_hire_days,
        "vacancy_closure_rate_pct": vacancy_closure_rate_pct,
        "source_wise_breakdown": source_wise_breakdown,
        "rejected_count": rejected_count,
        "withdrawn_count": withdrawn_count,
        "sanctioned_approved_total": sanctioned_approved_total,
        "sanctioned_working_total": sanctioned_working_total,
        "sanctioned_vacancy_total": sanctioned_vacancy_total,
        # Additive dashboard-redesign fields (2026-08-30). All derived from
        # the same current_effective_rows + _resolved_working pair as the
        # three totals above, so no chart or card can disagree with another.
        "recruitment_required_count": recruitment_required_count,
        "pending_requests_count": pending_requests_count,
        "pending_approvals_count": pending_approvals_count,
        "vacancy_by_department": vacancy_by_department,
        "vacancy_by_campus": vacancy_by_campus,
        "vacancy_by_category": vacancy_by_category,
        "urgent_vacancy_count": urgent_vacancy_count,
        "application_pipeline_funnel": application_pipeline_funnel,
        "critical_vacancies": critical_vacancies,
        "recent_joins": recent_joins,
        "recent_resignations": recent_resignations,
    }


def recruitment_funnel_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    range_start, range_end = _optional_date_range(start_date, end_date)
    # role_category grouping uses the denormalized Application.role_category
    # column (Phase 1) rather than the JobPosting -> ApprovedVacancy ->
    # VacancyRequest join chain -- Application is already the query's FROM
    # (it's the only model appearing in the join onclause below), so this is
    # a free column, not an extra join. The filter is likewise applied
    # directly against it now instead of via the join chain.
    query = db.query(
        Campus.code, Application.role_category, Application.status, func.count(Application.id)
    ).join(Campus, Application.campus_id == Campus.id)
    if role_category is not None:
        query = query.filter(Application.role_category == role_category)
    if campus_id_filter is not None:
        query = query.filter(Application.campus_id == campus_id_filter)
    if range_start is not None:
        query = query.filter(Application.applied_at >= range_start)
    if range_end is not None:
        query = query.filter(Application.applied_at < range_end)
    query = query.group_by(Campus.code, Application.role_category, Application.status)
    rows = [
        {"campus_code": code, "role_category": rc.value, "status": s.value, "count": count}
        for code, rc, s, count in query.all()
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def campus_role_hiring_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    query = (
        db.query(Campus.code, VacancyRequest.role_category, func.count(Employee.id))
        .select_from(Employee)
        .join(Campus, Employee.campus_id == Campus.id)
        .join(Application, Employee.application_id == Application.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
    )
    if campus_id_filter is not None:
        query = query.filter(Employee.campus_id == campus_id_filter)
    if role_category is not None:
        query = query.filter(VacancyRequest.role_category == role_category)
    if start_date is not None:
        query = query.filter(Employee.date_of_joining >= start_date)
    if end_date is not None:
        query = query.filter(Employee.date_of_joining <= end_date)
    query = query.group_by(Campus.code, VacancyRequest.role_category)
    rows = [
        {"campus_code": code, "role_category": rc.value, "hired_count": count} for code, rc, count in query.all()
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def interview_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    range_start, range_end = _optional_date_range(start_date, end_date)
    # role_category grouping reaches Application.role_category (denormalized,
    # Phase 1) via a single unconditional join to Application, instead of the
    # 3-hop JobPosting -> ApprovedVacancy -> VacancyRequest chain the old
    # role_category-only filter used -- cheaper since we now always need
    # Application joined anyway (for the group-by), and the filter reuses the
    # same join.
    query = (
        db.query(
            Campus.code,
            Application.role_category,
            InterviewSchedule.status,
            InterviewSchedule.interview_type,
            func.count(InterviewSchedule.id),
        )
        .join(Campus, InterviewSchedule.campus_id == Campus.id)
        .join(Application, InterviewSchedule.application_id == Application.id)
    )
    if role_category is not None:
        query = query.filter(Application.role_category == role_category)
    if campus_id_filter is not None:
        query = query.filter(InterviewSchedule.campus_id == campus_id_filter)
    if range_start is not None:
        query = query.filter(InterviewSchedule.scheduled_at >= range_start)
    if range_end is not None:
        query = query.filter(InterviewSchedule.scheduled_at < range_end)
    query = query.group_by(
        Campus.code, Application.role_category, InterviewSchedule.status, InterviewSchedule.interview_type
    )
    rows = [
        {"campus_code": code, "role_category": rc.value, "status": s.value, "interview_type": it.value, "count": count}
        for code, rc, s, it, count in query.all()
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def offer_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    range_start, range_end = _optional_date_range(start_date, end_date)
    # Application is already unconditionally joined here, so role_category
    # grouping/filtering uses its denormalized role_category column
    # (Phase 1) directly -- no extra join needed at all, unlike the old
    # JobPosting -> ApprovedVacancy -> VacancyRequest chain the role_category
    # filter used to add conditionally.
    query = (
        db.query(Campus.code, Application.role_category, Offer.status, func.count(Offer.id))
        .select_from(Offer)
        .join(Application, Offer.application_id == Application.id)
        .join(Campus, Application.campus_id == Campus.id)
    )
    if role_category is not None:
        query = query.filter(Application.role_category == role_category)
    if campus_id_filter is not None:
        query = query.filter(Application.campus_id == campus_id_filter)
    if range_start is not None:
        query = query.filter(Offer.created_at >= range_start)
    if range_end is not None:
        query = query.filter(Offer.created_at < range_end)
    query = query.group_by(Campus.code, Application.role_category, Offer.status)
    rows = [
        {"campus_code": code, "role_category": rc.value, "status": s.value, "count": count}
        for code, rc, s, count in query.all()
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def joining_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    range_start, range_end = _optional_date_range(start_date, end_date)
    # Application is already unconditionally joined here, so role_category
    # grouping/filtering uses its denormalized role_category column
    # (Phase 1) directly, same rationale as offer_report above.
    query = (
        db.query(Campus.code, Application.role_category, JoiningRecord.onboarding_completed_at)
        .select_from(JoiningRecord)
        .join(Application, JoiningRecord.application_id == Application.id)
        .join(Campus, Application.campus_id == Campus.id)
    )
    if role_category is not None:
        query = query.filter(Application.role_category == role_category)
    if campus_id_filter is not None:
        query = query.filter(Application.campus_id == campus_id_filter)
    if range_start is not None:
        query = query.filter(JoiningRecord.created_at >= range_start)
    if range_end is not None:
        query = query.filter(JoiningRecord.created_at < range_end)

    counts: dict[tuple[str, str, str], int] = {}
    for code, rc, completed_at in query.all():
        key = (code, rc.value, "COMPLETE" if completed_at is not None else "PENDING")
        counts[key] = counts.get(key, 0) + 1
    rows = [
        {"campus_code": code, "role_category": rc_value, "onboarding_status": onboarding_status, "count": count}
        for (code, rc_value, onboarding_status), count in sorted(counts.items())
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def vacancy_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    range_start, range_end = _optional_date_range(start_date, end_date)
    query = db.query(Campus.code, VacancyRequest.role_category, VacancyRequest.status, func.count(VacancyRequest.id)).join(
        Campus, VacancyRequest.campus_id == Campus.id
    )
    if campus_id_filter is not None:
        query = query.filter(VacancyRequest.campus_id == campus_id_filter)
    if role_category is not None:
        query = query.filter(VacancyRequest.role_category == role_category)
    if range_start is not None:
        query = query.filter(VacancyRequest.created_at >= range_start)
    if range_end is not None:
        query = query.filter(VacancyRequest.created_at < range_end)
    query = query.group_by(Campus.code, VacancyRequest.role_category, VacancyRequest.status)
    rows = [
        {"campus_code": code, "role_category": rc.value, "status": s.value, "count": count}
        for code, rc, s, count in query.all()
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def time_to_hire_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    entries = _time_to_hire_days(db, campus_id_filter, role_category, start_date=start_date, end_date=end_date)

    buckets: dict[tuple[str, str], list[int]] = {}
    for entry in entries:
        key = (entry["campus_code"], entry["role_category"])
        buckets.setdefault(key, []).append(entry["days"])
    rows = [
        {"campus_code": code, "role_category": rc, "avg_days": round(sum(days) / len(days), 1), "hired_count": len(days)}
        for (code, rc), days in sorted(buckets.items())
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def sanctioned_strength_reconciliation_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    """Sanctioned Strength <-> Vacancy Request double-counting guard
    (zany-snuggling-pie.md Phase E, item 32) -- one row per (campus,
    department, designation) key where working_count + SUM(requested_count
    across in-flight VacancyRequests -- VACANCY_REQUEST_IN_FLIGHT_STATUSES,
    the same set app/services/sanctioned_strength.py's
    compute_availability_to_request and submit()'s enforcement reserve
    against) has crept past its current-effective approved_strength. This
    should normally be empty; a non-empty row here means either a
    SUPER_ADMIN used submit()'s sanction-override escape hatch, or a
    sanction revision shrank the ceiling after requests were already in
    flight.

    Only evaluates keys that currently have a SanctionedStrength row at all
    (via current_effective_rows, this module's shared resolver) -- a
    designation nobody has ever sanctioned has no ceiling to reconcile
    against, and isn't a "double-counting" case in the first place.

    Point-in-time by construction (a live snapshot of "who's over their
    sanction right now") -- unlike the other 7 REPORT_BUILDERS this one does
    not apply start_date/end_date; both params are accepted only for call-
    shape parity with `_build_report`'s uniform dispatch, same convention as
    campus_wise_hiring's never-date-filtered hired_count.
    """
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)

    current_rows = current_effective_rows(db, campus_id=campus_id_filter)
    if role_category is not None:
        current_rows = [row for row in current_rows if row.category == role_category]
    if not current_rows:
        return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": []}

    already_requested_query = db.query(
        VacancyRequest.campus_id,
        VacancyRequest.department_id,
        VacancyRequest.designation_id,
        func.coalesce(func.sum(VacancyRequest.requested_count), 0),
    ).filter(
        VacancyRequest.designation_id.isnot(None),
        VacancyRequest.status.in_(VACANCY_REQUEST_IN_FLIGHT_STATUSES),
    )
    if campus_id_filter is not None:
        already_requested_query = already_requested_query.filter(VacancyRequest.campus_id == campus_id_filter)
    already_requested_query = already_requested_query.group_by(
        VacancyRequest.campus_id, VacancyRequest.department_id, VacancyRequest.designation_id
    )
    already_requested_by_key = {
        (campus_id, department_id, designation_id): int(count)
        for campus_id, department_id, designation_id, count in already_requested_query.all()
    }

    rows: list[dict] = []
    for ss_row in current_rows:
        # Phase D (glowing-zooming-hamming.md) -- pass this row's own
        # category/location_id through so a HOUSEKEEPING key's working_count
        # reflects live HousekeepingStaff, not (always-zero) Employee rows;
        # Teaching/Non-Teaching keep counting Employee exactly as before.
        working = working_count_for(
            db,
            department_id=ss_row.department_id,
            designation_id=ss_row.designation_id,
            category=ss_row.category,
            location_id=ss_row.location_id,
        )
        already_requested = already_requested_by_key.get(
            (ss_row.campus_id, ss_row.department_id, ss_row.designation_id), 0
        )
        total_commitment = working + already_requested
        if total_commitment <= ss_row.approved_strength:
            continue
        rows.append(
            {
                "campus_code": ss_row.campus.code,
                "department_name": ss_row.department.name,
                "designation_name": ss_row.designation.name,
                "category": ss_row.category.value,
                "approved_strength": ss_row.approved_strength,
                "working_count": working,
                "already_requested": already_requested,
                "over_by": total_commitment - ss_row.approved_strength,
            }
        )
    rows.sort(key=lambda r: (r["campus_code"], r["department_name"], r["designation_name"]))
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def resignation_report(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    """Hermes reporting extension (get_resignation_report tool) -- Employee
    rows with employment_status == RESIGNED, grouped by (campus, department,
    role_category), narrowed to separation_date within [start_date,
    end_date] when given. Same call-shape parity with the other 8
    REPORT_BUILDERS entries (campus_code/role_category/start_date/end_date),
    for the same uniform-dispatch reason sanctioned_strength_reconciliation_
    report's own docstring gives for accepting-but-not-using every kwarg.

    role_category comes from the denormalized Application.role_category
    column via Employee.application_id (Employee itself has no
    role_category column) -- the same join campus_role_hiring_report above
    already uses, not a new join pattern.

    department_id is included on each row (unlike this module's other
    report rows, which only ever surface department_name) specifically so
    app/services/hermes.py's department-scope post-filtering has something
    to filter on -- resignation counts would otherwise only be
    department_name strings, which can't be matched against
    DepartmentScope.department_ids (a set of UUIDs) without an extra
    lookup. Registered in REPORT_BUILDERS below ("resignations") so
    GET/export /reports/resignations also works for free through the
    existing generic /reports/{report_type} routes -- no router change
    needed, since those routes already dispatch on this dict.
    """
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    query = (
        db.query(
            Campus.code,
            Employee.department_id,
            Department.name,
            Application.role_category,
            func.count(Employee.id),
        )
        .select_from(Employee)
        .join(Campus, Employee.campus_id == Campus.id)
        .join(Application, Employee.application_id == Application.id)
        .outerjoin(Department, Employee.department_id == Department.id)
        .filter(Employee.employment_status == EmploymentStatusEnum.RESIGNED)
    )
    if campus_id_filter is not None:
        query = query.filter(Employee.campus_id == campus_id_filter)
    if role_category is not None:
        query = query.filter(Application.role_category == role_category)
    if start_date is not None:
        query = query.filter(Employee.separation_date >= start_date)
    if end_date is not None:
        query = query.filter(Employee.separation_date <= end_date)
    query = query.group_by(Campus.code, Employee.department_id, Department.name, Application.role_category)
    rows = [
        {
            "campus_code": code,
            "department_id": department_id,
            "department_name": dept_name,
            "role_category": rc.value,
            "count": count,
        }
        for code, department_id, dept_name, rc, count in query.all()
    ]
    rows.sort(key=lambda r: (r["campus_code"], r["department_name"] or ""))
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


REPORT_BUILDERS: dict[str, Callable[..., dict]] = {
    "recruitment-funnel": recruitment_funnel_report,
    "campus-role-hiring": campus_role_hiring_report,
    "interviews": interview_report,
    "offers": offer_report,
    "joining": joining_report,
    "vacancies": vacancy_report,
    "time-to-hire": time_to_hire_report,
    "sanctioned-strength-reconciliation": sanctioned_strength_reconciliation_report,
    "resignations": resignation_report,
}


def build_ad_briefing_summary(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    kpis = get_dashboard_kpis(
        db, scope, campus_code=campus_code, role_category=None, start_date=start_date, end_date=end_date
    )
    if start_date is None and end_date is None:
        period_label = "Today"
    elif start_date == end_date:
        period_label = str(start_date)
    else:
        period_label = f"{start_date if start_date else '…'} to {end_date if end_date else '…'}"
    kpi_headline = {
        "total_applications": kpis["total_applications"],
        "open_positions": kpis["open_positions"],
        "interviews_today": kpis["interviews_today"],
        "joinings_today": kpis["joinings_today"],
        "offers_pending": kpis["offers_pending"],
        "vacancy_closure_rate_pct": kpis["vacancy_closure_rate_pct"],
    }

    open_query = (
        db.query(Campus.code, VacancyRequest.role_category, func.count(HiringSlot.id))
        .select_from(HiringSlot)
        .join(ApprovedVacancy, HiringSlot.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .join(Campus, ApprovedVacancy.campus_id == Campus.id)
        .filter(HiringSlot.status == HiringSlotStatusEnum.OPEN)
    )
    if campus_id_filter is not None:
        open_query = open_query.filter(ApprovedVacancy.campus_id == campus_id_filter)
    open_query = open_query.group_by(Campus.code, VacancyRequest.role_category)
    open_map = {(code, rc.value): count for code, rc, count in open_query.all()}

    pipeline_query = (
        db.query(Campus.code, VacancyRequest.role_category, func.count(Application.id))
        .select_from(Application)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .join(Campus, Application.campus_id == Campus.id)
        .filter(~Application.status.in_(APPLICATION_TERMINAL_STATUSES))
    )
    if campus_id_filter is not None:
        pipeline_query = pipeline_query.filter(Application.campus_id == campus_id_filter)
    pipeline_query = pipeline_query.group_by(Campus.code, VacancyRequest.role_category)
    pipeline_map = {(code, rc.value): count for code, rc, count in pipeline_query.all()}

    hiring_rows = campus_role_hiring_report(db, scope, campus_code=campus_code)["rows"]
    hired_map = {(r["campus_code"], r["role_category"]): r["hired_count"] for r in hiring_rows}

    keys = set(open_map) | set(pipeline_map) | set(hired_map)
    campus_role_breakdown = [
        {
            "campus_code": code,
            "role_category": rc,
            "open_positions": open_map.get((code, rc), 0),
            "in_pipeline": pipeline_map.get((code, rc), 0),
            "hired": hired_map.get((code, rc), 0),
        }
        for code, rc in sorted(keys)
    ]

    return {
        "scope_note": scope_note,
        "generated_at": datetime.now(timezone.utc),
        "period_label": period_label,
        "kpi_headline": kpi_headline,
        "campus_role_breakdown": campus_role_breakdown,
    }


_JOINED_OR_LATER_STATUSES = {
    ApplicationStatusEnum.JOINED,
    ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED,
    ApplicationStatusEnum.ORIENTATION_COMPLETE,
    ApplicationStatusEnum.HANDED_OVER_TO_HOD,
}
_NTS_ROLE_CATEGORIES = (StaffRoleCategoryEnum.NON_TEACHING, StaffRoleCategoryEnum.HOUSEKEEPING)


def _classify_panel_result(panel_result: str | None) -> str | None:
    """Case-insensitive, trimmed bucket match on Application.panel_result --
    see the "Weekly Recruitment Status" docstring section above for why this
    isn't a literal enum field. Anything that doesn't match one of the three
    labels (null, blank, other free text) is excluded from every bucket."""
    if panel_result is None:
        return None
    normalized = panel_result.strip().lower()
    if normalized == "selected":
        return "selected"
    if normalized in ("waiting", "waiting list"):
        return "waiting"
    if normalized == "rejected":
        return "rejected"
    return None


def build_weekly_recruitment_status(
    db: Session,
    scope: CampusScope,
    start_date: date,
    end_date: date,
    campus_code: str | None = None,
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)

    cohort_query = (
        db.query(Application, VacancyRequest.role_category, VacancyRequest.position_title, Campus.code)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .join(Campus, Application.campus_id == Campus.id)
        .filter(
            Application.interview_scheduled_date.isnot(None),
            Application.interview_scheduled_date >= start_date,
            Application.interview_scheduled_date <= end_date,
        )
    )
    if campus_id_filter is not None:
        cohort_query = cohort_query.filter(Application.campus_id == campus_id_filter)

    teaching_buckets: dict[str, dict[str, int]] = {}
    non_teaching_buckets: dict[str, dict[str, int]] = {}
    for application, role_category, position_title, campus_code_value in cohort_query.all():
        bucket = _classify_panel_result(application.panel_result)
        if bucket is None:
            continue
        if role_category == StaffRoleCategoryEnum.TEACHING:
            counts = teaching_buckets.setdefault(campus_code_value, {"selected": 0, "waiting": 0, "rejected": 0})
        elif role_category in _NTS_ROLE_CATEGORIES:
            counts = non_teaching_buckets.setdefault(position_title, {"selected": 0, "waiting": 0, "rejected": 0})
        else:
            continue
        counts[bucket] += 1

    teaching_rows = [
        {
            "group_label": label,
            "attended": counts["selected"] + counts["waiting"] + counts["rejected"],
            "selected": counts["selected"],
            "waiting": counts["waiting"],
            "rejected": counts["rejected"],
            "upcoming_join": None,
            "joined": None,
        }
        for label, counts in sorted(teaching_buckets.items())
    ]

    # Upcoming Join (NTS rows only) -- a point-in-time snapshot, not
    # restricted to the weekly interview cohort.
    excluded_statuses = _JOINED_OR_LATER_STATUSES | APPLICATION_TERMINAL_STATUSES
    upcoming_query = (
        db.query(VacancyRequest.position_title, func.count(Application.id))
        .select_from(Application)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .filter(
            VacancyRequest.role_category.in_(_NTS_ROLE_CATEGORIES),
            Application.expected_joining_date.isnot(None),
            ~Application.status.in_(excluded_statuses),
        )
    )
    if campus_id_filter is not None:
        upcoming_query = upcoming_query.filter(Application.campus_id == campus_id_filter)
    upcoming_map = dict(upcoming_query.group_by(VacancyRequest.position_title).all())

    # Joined (NTS rows, the 3 category tiles, and the top-level KPI) -- also
    # not restricted to the weekly interview cohort, since joining is a
    # separate, later pipeline stage.
    joined_query = (
        db.query(VacancyRequest.role_category, VacancyRequest.position_title, func.count(Application.id))
        .select_from(Application)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .filter(
            Application.actual_joining_date.isnot(None),
            Application.actual_joining_date >= start_date,
            Application.actual_joining_date <= end_date,
        )
    )
    if campus_id_filter is not None:
        joined_query = joined_query.filter(Application.campus_id == campus_id_filter)
    joined_query = joined_query.group_by(VacancyRequest.role_category, VacancyRequest.position_title)

    joined_by_category: dict[str, int] = {rc.value: 0 for rc in StaffRoleCategoryEnum}
    joined_by_position: dict[str, int] = {}
    for role_category, position_title, count in joined_query.all():
        joined_by_category[role_category.value] = joined_by_category.get(role_category.value, 0) + count
        if role_category in _NTS_ROLE_CATEGORIES:
            joined_by_position[position_title] = joined_by_position.get(position_title, 0) + count

    nts_labels = set(non_teaching_buckets) | set(upcoming_map) | set(joined_by_position)
    non_teaching_rows = []
    for label in sorted(nts_labels):
        counts = non_teaching_buckets.get(label, {"selected": 0, "waiting": 0, "rejected": 0})
        non_teaching_rows.append(
            {
                "group_label": label,
                "attended": counts["selected"] + counts["waiting"] + counts["rejected"],
                "selected": counts["selected"],
                "waiting": counts["waiting"],
                "rejected": counts["rejected"],
                "upcoming_join": upcoming_map.get(label, 0),
                "joined": joined_by_position.get(label, 0),
            }
        )

    total_interviewed = sum(r["attended"] for r in teaching_rows) + sum(r["attended"] for r in non_teaching_rows)
    total_selected = sum(r["selected"] for r in teaching_rows) + sum(r["selected"] for r in non_teaching_rows)
    total_waiting = sum(r["waiting"] for r in teaching_rows) + sum(r["waiting"] for r in non_teaching_rows)
    total_rejected = sum(r["rejected"] for r in teaching_rows) + sum(r["rejected"] for r in non_teaching_rows)
    total_joined = sum(joined_by_category.values())
    selection_rate_pct = round(total_selected / total_interviewed * 100) if total_interviewed > 0 else None

    return {
        "scope_note": scope_note,
        "generated_at": datetime.now(timezone.utc),
        "period_label": f"{start_date:%d-%m-%Y} to {end_date:%d-%m-%Y}",
        "start_date": start_date,
        "end_date": end_date,
        "total_interviewed": total_interviewed,
        "total_selected": total_selected,
        "total_waiting": total_waiting,
        "total_rejected": total_rejected,
        "total_joined": total_joined,
        "selection_rate_pct": selection_rate_pct,
        "joined_by_category": joined_by_category,
        "teaching_rows": teaching_rows,
        "non_teaching_rows": non_teaching_rows,
    }
