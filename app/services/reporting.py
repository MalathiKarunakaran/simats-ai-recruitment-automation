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


def _time_to_hire_days(
    db: Session, campus_id_filter, role_category: StaffRoleCategoryEnum | None
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

    all_campus_codes = set(hired_by_campus) | set(open_by_campus) | set(in_progress_by_campus)
    campus_wise_hiring = [
        {
            "campus_code": code,
            "hired_count": hired_by_campus.get(code, 0),
            "open_count": open_by_campus.get(code, 0),
            "in_progress_count": in_progress_by_campus.get(code, 0),
        }
        for code in sorted(all_campus_codes)
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
    vacancy_closure_rate_pct = round(closed / ever_approved * 100, 1) if ever_approved else 0.0

    return {
        "scope_note": scope_note,
        "total_applications": total_applications,
        "open_positions": open_positions,
        "interviews_today": interviews_today,
        "joinings_today": joinings_today,
        "offers_pending": offers_pending,
        "campus_wise_hiring": campus_wise_hiring,
        "average_time_to_hire_days": average_time_to_hire_days,
        "vacancy_closure_rate_pct": vacancy_closure_rate_pct,
        "source_wise_breakdown": source_wise_breakdown,
        "rejected_count": rejected_count,
        "withdrawn_count": withdrawn_count,
    }


def recruitment_funnel_report(
    db: Session, scope: CampusScope, campus_code: str | None = None, role_category: StaffRoleCategoryEnum | None = None
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    query = db.query(Campus.code, Application.status, func.count(Application.id)).join(
        Campus, Application.campus_id == Campus.id
    )
    if role_category is not None:
        query = (
            query.join(JobPosting, Application.job_posting_id == JobPosting.id)
            .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.role_category == role_category)
        )
    if campus_id_filter is not None:
        query = query.filter(Application.campus_id == campus_id_filter)
    query = query.group_by(Campus.code, Application.status)
    rows = [{"campus_code": code, "status": s.value, "count": count} for code, s, count in query.all()]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def campus_role_hiring_report(
    db: Session, scope: CampusScope, campus_code: str | None = None, role_category: StaffRoleCategoryEnum | None = None
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
    query = query.group_by(Campus.code, VacancyRequest.role_category)
    rows = [
        {"campus_code": code, "role_category": rc.value, "hired_count": count} for code, rc, count in query.all()
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def interview_report(
    db: Session, scope: CampusScope, campus_code: str | None = None, role_category: StaffRoleCategoryEnum | None = None
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    query = db.query(
        Campus.code, InterviewSchedule.status, InterviewSchedule.interview_type, func.count(InterviewSchedule.id)
    ).join(Campus, InterviewSchedule.campus_id == Campus.id)
    if role_category is not None:
        query = (
            query.join(Application, InterviewSchedule.application_id == Application.id)
            .join(JobPosting, Application.job_posting_id == JobPosting.id)
            .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.role_category == role_category)
        )
    if campus_id_filter is not None:
        query = query.filter(InterviewSchedule.campus_id == campus_id_filter)
    query = query.group_by(Campus.code, InterviewSchedule.status, InterviewSchedule.interview_type)
    rows = [
        {"campus_code": code, "status": s.value, "interview_type": it.value, "count": count}
        for code, s, it, count in query.all()
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def offer_report(
    db: Session, scope: CampusScope, campus_code: str | None = None, role_category: StaffRoleCategoryEnum | None = None
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    query = (
        db.query(Campus.code, Offer.status, func.count(Offer.id))
        .select_from(Offer)
        .join(Application, Offer.application_id == Application.id)
        .join(Campus, Application.campus_id == Campus.id)
    )
    if role_category is not None:
        query = (
            query.join(JobPosting, Application.job_posting_id == JobPosting.id)
            .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.role_category == role_category)
        )
    if campus_id_filter is not None:
        query = query.filter(Application.campus_id == campus_id_filter)
    query = query.group_by(Campus.code, Offer.status)
    rows = [{"campus_code": code, "status": s.value, "count": count} for code, s, count in query.all()]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def joining_report(
    db: Session, scope: CampusScope, campus_code: str | None = None, role_category: StaffRoleCategoryEnum | None = None
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    query = (
        db.query(Campus.code, JoiningRecord.onboarding_completed_at)
        .select_from(JoiningRecord)
        .join(Application, JoiningRecord.application_id == Application.id)
        .join(Campus, Application.campus_id == Campus.id)
    )
    if role_category is not None:
        query = (
            query.join(JobPosting, Application.job_posting_id == JobPosting.id)
            .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.role_category == role_category)
        )
    if campus_id_filter is not None:
        query = query.filter(Application.campus_id == campus_id_filter)

    counts: dict[tuple[str, str], int] = {}
    for code, completed_at in query.all():
        key = (code, "COMPLETE" if completed_at is not None else "PENDING")
        counts[key] = counts.get(key, 0) + 1
    rows = [
        {"campus_code": code, "onboarding_status": onboarding_status, "count": count}
        for (code, onboarding_status), count in sorted(counts.items())
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def vacancy_report(
    db: Session, scope: CampusScope, campus_code: str | None = None, role_category: StaffRoleCategoryEnum | None = None
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    query = db.query(Campus.code, VacancyRequest.role_category, VacancyRequest.status, func.count(VacancyRequest.id)).join(
        Campus, VacancyRequest.campus_id == Campus.id
    )
    if campus_id_filter is not None:
        query = query.filter(VacancyRequest.campus_id == campus_id_filter)
    if role_category is not None:
        query = query.filter(VacancyRequest.role_category == role_category)
    query = query.group_by(Campus.code, VacancyRequest.role_category, VacancyRequest.status)
    rows = [
        {"campus_code": code, "role_category": rc.value, "status": s.value, "count": count}
        for code, rc, s, count in query.all()
    ]
    return {"scope_note": scope_note, "generated_at": datetime.now(timezone.utc), "rows": rows}


def time_to_hire_report(
    db: Session, scope: CampusScope, campus_code: str | None = None, role_category: StaffRoleCategoryEnum | None = None
) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    entries = _time_to_hire_days(db, campus_id_filter, role_category)

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


def build_ad_briefing_summary(db: Session, scope: CampusScope, campus_code: str | None = None) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    kpis = get_dashboard_kpis(db, scope, campus_code=campus_code, role_category=None)
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
        "kpi_headline": kpi_headline,
        "campus_role_breakdown": campus_role_breakdown,
    }
