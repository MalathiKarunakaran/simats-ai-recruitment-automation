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

from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.deps import CampusScope
from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.campus import Campus
from app.models.candidate import Candidate
from app.models.employee import Employee
from app.models.enums import (
    APPLICATION_TERMINAL_STATUSES,
    CAMPUS_CODES,
    ApplicationStatusEnum,
    HiringSlotStatusEnum,
    InterviewScheduleStatusEnum,
    OfferStatusEnum,
    StaffRoleCategoryEnum,
    VacancyRequestStatusEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.interview import InterviewSchedule
from app.models.job_posting import JobPosting
from app.models.joining import JoiningRecord
from app.models.offer import Offer
from app.models.vacancy_request import VacancyRequest
from app.services.scoping import resolve_campus_filter

_NON_TERMINAL_OFFER_STATUSES = (OfferStatusEnum.DRAFT, OfferStatusEnum.SENT)
_APPROVED_OR_BEYOND_STATUSES = (
    VacancyRequestStatusEnum.APPROVED,
    VacancyRequestStatusEnum.PUBLISHED,
    VacancyRequestStatusEnum.CLOSED,
)


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


def get_dashboard_kpis(
    db: Session,
    scope: CampusScope,
    campus_code: str | None = None,
    role_category: StaffRoleCategoryEnum | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
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


REPORT_BUILDERS: dict[str, Callable[..., dict]] = {
    "recruitment-funnel": recruitment_funnel_report,
    "campus-role-hiring": campus_role_hiring_report,
    "interviews": interview_report,
    "offers": offer_report,
    "joining": joining_report,
    "vacancies": vacancy_report,
    "time-to-hire": time_to_hire_report,
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
