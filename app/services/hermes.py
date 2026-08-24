"""Module 14: Hermes, a read-only natural-language assistant.

Hermes never mutates data. Every tool executor below performs the same kind
of query an existing router would, filtered by the caller's CampusScope
exactly like every router in app/api/v1/routers already does. A
single-campus caller's `campus_code` tool argument is always ignored --
resolve_campus_filter substitutes scope.campus_id regardless of what Claude
passed. This is the single safety-critical function in this file.

Uses a manual Claude tool-use loop (not the SDK's beta Tool Runner -- see
app/services/ai_client.py's module docstring for why) capped at
_MAX_TOOL_CALLS API calls per query.
"""

import calendar
import json
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, DepartmentScope
from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.campus import Campus
from app.models.candidate import Candidate
from app.models.department import Department
from app.models.enums import (
    ApplicationStatusEnum,
    HiringSlotStatusEnum,
    InterviewScheduleStatusEnum,
    OfferStatusEnum,
    StaffRoleCategoryEnum,
    VacancyRequestStatusEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.interview import InterviewPanelAssignment, InterviewSchedule
from app.models.job_posting import JobPosting
from app.models.offer import Offer
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services import ai_client, reporting, vacancy_register
from app.services.scoping import resolve_campus_filter

# Reporting-question tools (get_vacancy_summary, get_recruitment_pipeline,
# ...) were added alongside the original 5 read-only lookup tools, roughly
# tripling the tool surface. A compound question ("compare Teaching,
# Non-Teaching and Housekeeping hiring") can legitimately need several
# sequential tool calls before Claude has enough to answer (parallel
# tool_use blocks in one turn don't each cost a call here -- only the
# round-trip does), so the old cap of 4 was raised to 6: enough for e.g.
# 5 sequential single-tool round trips plus the final text-answering turn,
# while still bounding worst-case latency/cost per query. See
# tests/test_assistant.py::test_iteration_cap_raises_502_after_six_calls for
# the cap-reaching regression test (updated from four->six calls here).
_MAX_TOOL_CALLS = 6

# History cap for the additive `conversation_history` request field (see
# AssistantQueryRequest) -- the last 10 prior turns (roughly 5 user/assistant
# exchanges) are prepended verbatim ahead of the new question, bounding
# per-query token usage/cost regardless of how long a frontend chat session
# has run. An arbitrary but conservative choice; not tied to any Anthropic
# API limit.
_MAX_CONVERSATION_HISTORY_TURNS = 10

_NON_TERMINAL_OFFER_STATUSES = (OfferStatusEnum.DRAFT, OfferStatusEnum.SENT)

HERMES_SYSTEM_PROMPT = """\
# Role
You are Hermes, a read-only AI assistant for staff of SIMATS (Saveetha \
Institute of Medical and Technical Sciences) using its recruitment \
automation system.

# Critical rules
1. You are STRICTLY READ-ONLY. You have no tools that create, update, or \
delete any data, and you must never claim to have performed an action \
(e.g. "I've approved it", "I've scheduled the interview"). If the user \
asks you to *do* something, tell them you cannot act on their behalf and \
name the correct existing REST endpoint they should use instead (e.g. \
"use POST /vacancy-requests/{id}/dean-approve").
2. Reporting IS available: use the reporting tools (get_vacancy_summary, \
get_department_vacancies, get_campus_vacancy_report, \
get_category_vacancy_report, get_sanctioned_vs_working, \
get_vacancy_approval_status, get_recruitment_pipeline, get_interview_status, \
get_offer_status, get_joining_report, get_resignation_report, \
get_open_vacancy_aging, get_monthly_recruitment_report, and the original \
list_pending_vacancy_approvals/list_open_vacancies/list_interviews/\
list_pending_offers/pipeline_status_counts) for any question about \
vacancies, staffing/sanctioned strength, interviews, offers, joining, \
resignations, or recruitment-pipeline status -- including "which \
departments have the highest vacancies" (get_department_vacancies, sorted \
descending), "vacancies open for more than N days" (get_open_vacancy_aging \
with min_days_open), and "compare Teaching, Non-Teaching and Housekeeping" \
(call the relevant tool once per role_category, or omit role_category where \
a tool already returns an all-3-categories breakdown). PPT/export file \
generation itself is not something you can produce directly -- point the \
user at the matching REST export endpoint instead (see rule 1's pattern) \
when they ask for a downloadable file.
3. Every tool result includes a scope_note describing exactly what data \
access was applied. Never claim broader coverage in your answer than what \
scope_note states -- if it says results are limited to one campus (or a \
restricted set of departments), your answer must reflect that limitation.
4. Use tools only for questions about vacancies, staffing, interviews, \
offers, joining, resignations, and application pipeline status. For \
anything else, answer directly or say you don't have the information.
5. Be concise. Answer in plain prose (a short paragraph or a compact \
list), not JSON. When tabular data is the clearest way to present a result \
(e.g. a per-campus or per-department breakdown), format it as a markdown \
table in your final answer -- the frontend renders markdown.
6. Never invent a number that isn't present in a tool result. If a tool \
call legitimately returns zero rows, say exactly "No matching recruitment \
data was found." rather than guessing or padding the answer.
7. If asked what *caused* a vacancy to open -- in particular, whether it \
was opened because of a specific employee's resignation -- answer with \
exactly "That information is not currently available in the recruitment \
database." No VacancyRequest record links to the resignation/Employee \
record that may have prompted it, and you have no tool that could answer \
this; do not guess or infer a link from timing alone.
8. If a question is genuinely ambiguous (e.g. it's unclear which campus, \
category, or time period is meant, and the caller's own scope doesn't \
already resolve it), ask a short clarifying question rather than guessing \
which tool/arguments to use."""


_STAGE_TO_STATUSES = {
    "AWAITING_DEAN": (VacancyRequestStatusEnum.SUBMITTED,),
    "AWAITING_HR": (VacancyRequestStatusEnum.DEAN_APPROVED,),
    "ANY_PENDING": (VacancyRequestStatusEnum.SUBMITTED, VacancyRequestStatusEnum.DEAN_APPROVED),
}


# --- Shared arg-parsing helpers for the reporting tools below -------------
# Mirror app/services/reporting.py's validate_campus_code/validate_role_category
# in spirit, but raise plain ValueError (not HTTPException) -- like every
# other tool executor in this file, a bad argument from Claude should
# degrade to an is_error tool_result the model can react to, not blow up the
# whole request the way a raw HTTPException from inside the tool-call loop
# would.


def _parse_role_category(value: str | None) -> StaffRoleCategoryEnum | None:
    if value is None:
        return None
    if value not in StaffRoleCategoryEnum.__members__:
        raise ValueError(
            f"Unknown role_category '{value}'. Valid values: {', '.join(StaffRoleCategoryEnum.__members__)}."
        )
    return StaffRoleCategoryEnum[value]


def _parse_date_arg(value, field_name: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise ValueError(f"Invalid {field_name} '{value}': must be an ISO date (YYYY-MM-DD).") from exc


def _parse_uuid_arg(value, field_name: str) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise ValueError(f"Invalid {field_name} '{value}': must be a UUID.") from exc


def _apply_department_scope(rows: list[dict], dept_scope: DepartmentScope, key: str = "department_id") -> list[dict]:
    """Post-filters an already-fetched list of row dicts (each carrying a
    `key` field holding a uuid.UUID or None) down to `dept_scope`'s allowed
    department set -- used by every new reporting tool below whose wrapped
    function has a real department dimension. Deliberately done here, not by
    threading a department_ids param into vacancy_register.py/reporting.py's
    shared functions -- those are also called by REST endpoints
    (GET /departments/vacancy-register, GET /reports/...) that have never
    taken a department-scope param and must keep behaving identically. A
    no-op when `dept_scope.is_restricted` is False (the common case)."""
    if not dept_scope.is_restricted:
        return rows
    allowed = dept_scope.department_ids
    return [r for r in rows if r.get(key) in allowed]


# Bare fields every get_department_vacancies/get_vacancy_approval_status/
# get_sanctioned_vs_working row needs -- kept as one shared shaping function
# so the three tools stay visually consistent with each other.
def _serialize_vacancy_register_row(row: dict) -> dict:
    return {
        "department_id": str(row["department_id"]),
        "department_name": row["department_name"],
        "campus_code": row["campus_code"],
        "category": row["category"].value if row["category"] is not None else None,
        "working_count": row["working_count"],
        "approved_count": row["approved_count"],
        "vacancy_count": row["vacancy_count"],
        "filled_pct": row["filled_pct"],
        "recruitment_status": row["recruitment_status"],
        "approval_status": row["approval_status"],
        "approval_status_request_count": row["approval_status_request_count"],
    }


def _tool_list_pending_vacancy_approvals(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, args.get("campus_code"))
    stage = args.get("stage") or "ANY_PENDING"
    if stage not in _STAGE_TO_STATUSES:
        raise ValueError(f"Unknown stage '{stage}'. Valid values: {', '.join(_STAGE_TO_STATUSES)}.")
    limit = min(int(args.get("limit") or 20), 50)

    query = (
        db.query(VacancyRequest, Department, User, Campus)
        .join(Department, VacancyRequest.department_id == Department.id)
        .join(User, VacancyRequest.requested_by_id == User.id)
        .join(Campus, VacancyRequest.campus_id == Campus.id)
        .filter(VacancyRequest.status.in_(_STAGE_TO_STATUSES[stage]))
    )
    if campus_id_filter is not None:
        query = query.filter(VacancyRequest.campus_id == campus_id_filter)
    rows = query.order_by(VacancyRequest.submitted_at.asc()).limit(limit).all()

    results = [
        {
            "id": str(vr.id),
            "position_title": vr.position_title,
            "campus_code": campus.code,
            "department_name": dept.name,
            "status": vr.status.value,
            "requested_count": vr.requested_count,
            "priority": vr.priority.value,
            "submitted_at": vr.submitted_at.isoformat() if vr.submitted_at else None,
            "requested_by_name": requester.full_name,
        }
        for vr, dept, requester, campus in rows
    ]
    return {"scope_note": scope_note, "count": len(results), "results": results}


def _tool_list_open_vacancies(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, args.get("campus_code"))
    role_category = args.get("role_category")
    if role_category is not None and role_category not in StaffRoleCategoryEnum.__members__:
        raise ValueError(
            f"Unknown role_category '{role_category}'. Valid values: {', '.join(StaffRoleCategoryEnum.__members__)}."
        )
    limit = min(int(args.get("limit") or 20), 50)

    query = (
        db.query(JobPosting, VacancyRequest, ApprovedVacancy, Department, Campus)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .join(Department, VacancyRequest.department_id == Department.id)
        .join(Campus, JobPosting.campus_id == Campus.id)
        .filter(JobPosting.is_active.is_(True))
    )
    if campus_id_filter is not None:
        query = query.filter(JobPosting.campus_id == campus_id_filter)
    if role_category is not None:
        query = query.filter(VacancyRequest.role_category == StaffRoleCategoryEnum[role_category])
    rows = query.order_by(JobPosting.published_at.desc()).limit(limit).all()

    results = []
    for posting, vr, approved, dept, campus in rows:
        open_slot_count = (
            db.query(func.count(HiringSlot.id))
            .filter(HiringSlot.approved_vacancy_id == approved.id, HiringSlot.status == HiringSlotStatusEnum.OPEN)
            .scalar()
        )
        results.append(
            {
                "job_posting_id": str(posting.id),
                "position_title": vr.position_title,
                "campus_code": campus.code,
                "role_category": vr.role_category.value,
                "department_name": dept.name,
                "published_at": posting.published_at.isoformat(),
                "open_slot_count": open_slot_count,
                "total_positions": approved.total_positions,
            }
        )
    return {"scope_note": scope_note, "count": len(results), "results": results}


def _tool_list_interviews(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, args.get("campus_code"))
    status_arg = args.get("status") or "SCHEDULED"
    if status_arg not in InterviewScheduleStatusEnum.__members__:
        raise ValueError(
            f"Unknown status '{status_arg}'. Valid values: {', '.join(InterviewScheduleStatusEnum.__members__)}."
        )
    upcoming_only = args.get("upcoming_only")
    upcoming_only = True if upcoming_only is None else bool(upcoming_only)
    limit = min(int(args.get("limit") or 20), 50)

    query = (
        db.query(InterviewSchedule, Candidate, VacancyRequest, Campus)
        .join(Application, InterviewSchedule.application_id == Application.id)
        .join(Candidate, Application.candidate_id == Candidate.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .join(Campus, InterviewSchedule.campus_id == Campus.id)
        .filter(InterviewSchedule.status == InterviewScheduleStatusEnum[status_arg])
    )
    if campus_id_filter is not None:
        query = query.filter(InterviewSchedule.campus_id == campus_id_filter)
    if upcoming_only:
        query = query.filter(InterviewSchedule.scheduled_at >= datetime.now(timezone.utc))
    rows = query.order_by(InterviewSchedule.scheduled_at.asc()).limit(limit).all()

    results = []
    for schedule, candidate, vr, campus in rows:
        panel_names = [
            name
            for (name,) in db.query(User.full_name)
            .join(InterviewPanelAssignment, InterviewPanelAssignment.panel_member_id == User.id)
            .filter(InterviewPanelAssignment.interview_schedule_id == schedule.id)
            .all()
        ]
        results.append(
            {
                "interview_id": str(schedule.id),
                "candidate_name": candidate.full_name,
                "position_title": vr.position_title,
                "campus_code": campus.code,
                "interview_type": schedule.interview_type.value,
                "scheduled_at": schedule.scheduled_at.isoformat(),
                "status": schedule.status.value,
                "panel_member_names": panel_names,
            }
        )
    return {"scope_note": scope_note, "count": len(results), "results": results}


def _tool_list_pending_offers(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, args.get("campus_code"))
    status_arg = args.get("status")
    if status_arg is not None and status_arg not in OfferStatusEnum.__members__:
        raise ValueError(f"Unknown status '{status_arg}'. Valid values: {', '.join(OfferStatusEnum.__members__)}.")
    limit = min(int(args.get("limit") or 20), 50)

    query = (
        db.query(Offer, Candidate, VacancyRequest, Campus)
        .join(Application, Offer.application_id == Application.id)
        .join(Candidate, Application.candidate_id == Candidate.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .join(Campus, Application.campus_id == Campus.id)
    )
    if status_arg is not None:
        query = query.filter(Offer.status == OfferStatusEnum[status_arg])
    else:
        query = query.filter(Offer.status.in_(_NON_TERMINAL_OFFER_STATUSES))
    if campus_id_filter is not None:
        query = query.filter(Application.campus_id == campus_id_filter)
    rows = query.order_by(Offer.created_at.desc()).limit(limit).all()

    results = [
        {
            "offer_id": str(offer.id),
            "candidate_name": candidate.full_name,
            "position_title": vr.position_title,
            "campus_code": campus.code,
            "status": offer.status.value,
            "salary_amount": float(offer.salary_amount),
            "salary_currency": offer.salary_currency,
            "sent_at": offer.sent_at.isoformat() if offer.sent_at else None,
            "expires_at": offer.expires_at.isoformat() if offer.expires_at else None,
        }
        for offer, candidate, vr, campus in rows
    ]
    return {"scope_note": scope_note, "count": len(results), "results": results}


def _tool_pipeline_status_counts(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, args.get("campus_code"))
    job_posting_id_arg = args.get("job_posting_id")
    job_posting_id = None
    if job_posting_id_arg:
        try:
            job_posting_id = uuid.UUID(str(job_posting_id_arg))
        except ValueError as exc:
            raise ValueError(f"Invalid job_posting_id '{job_posting_id_arg}': must be a UUID.") from exc

    query = db.query(Application.status, func.count(Application.id)).group_by(Application.status)
    if campus_id_filter is not None:
        query = query.filter(Application.campus_id == campus_id_filter)
    if job_posting_id is not None:
        query = query.filter(Application.job_posting_id == job_posting_id)
    rows = query.all()

    counts = {s.value: c for s, c in rows}
    return {"scope_note": scope_note, "counts": counts, "total": sum(counts.values())}


# --- Reporting tools (new) -------------------------------------------------
# Every function below wraps app/services/reporting.py or
# app/services/vacancy_register.py rather than reimplementing their query
# logic (per the task brief), adapting the call site (extra dept_scope
# post-filtering, JSON-safe row shaping, tool-specific arg names) instead of
# changing either shared module's own public signature -- both are still
# called unmodified by their existing REST routers
# (app/api/v1/routers/reports.py, app/api/v1/routers/vacancy_register.py).


def _tool_get_vacancy_summary(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    # No department dimension in get_dashboard_kpis's open_positions/
    # urgent_vacancy_count/category_wise_breakdown fields -- dept_scope
    # restriction doesn't apply here (see module note above _apply_department_scope).
    role_category = _parse_role_category(args.get("role_category"))
    kpis = reporting.get_dashboard_kpis(db, scope, campus_code=args.get("campus_code"), role_category=role_category)
    return {
        "scope_note": kpis["scope_note"],
        "total_open_positions": kpis["open_positions"],
        "urgent_vacancy_count": kpis["urgent_vacancy_count"],
        "by_category": kpis["category_wise_breakdown"],
    }


def _tool_get_department_vacancies(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    category = _parse_role_category(args.get("category") or args.get("role_category"))
    department_id = _parse_uuid_arg(args.get("department_id"), "department_id")
    min_vacancy_count = args.get("min_vacancy_count")
    limit = min(int(args.get("limit") or 20), 50)
    campus_code = args.get("campus_code")

    _campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    # list_vacancy_register_rows already supports sort_by="vacancy_count" --
    # reused directly for "highest vacancies" questions rather than sorting
    # again here. A large limit/offset=0 fetches every matching department
    # (there are only ~500 at this org's scale, per that module's own
    # docstring) so min_vacancy_count -- which that function has no kwarg
    # for -- can be applied as a plain Python filter afterwards, per the
    # task brief's guidance to filter in the tool executor rather than
    # extend the shared function's signature.
    rows, _total, _category_counts = vacancy_register.list_vacancy_register_rows(
        db,
        scope,
        limit=2000,
        offset=0,
        sort_by="vacancy_count",
        sort_dir="desc",
        campus_code=campus_code,
        category=category,
        department_id=department_id,
    )
    rows = _apply_department_scope(rows, dept_scope)
    if min_vacancy_count is not None:
        rows = [r for r in rows if r["vacancy_count"] >= int(min_vacancy_count)]
    rows = rows[:limit]
    results = [_serialize_vacancy_register_row(r) for r in rows]
    return {"scope_note": scope_note, "count": len(results), "results": results}


def _tool_get_campus_vacancy_report(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    # vacancy_report's rows are (campus, role_category, status) -- no
    # department dimension at all, so dept_scope restriction doesn't apply
    # here (per the task brief: "department-scope restriction doesn't apply
    # to it" when a wrapped report has no department dimension).
    role_category = _parse_role_category(args.get("role_category"))
    start_date = _parse_date_arg(args.get("start_date"), "start_date")
    end_date = _parse_date_arg(args.get("end_date"), "end_date")
    report = reporting.vacancy_report(
        db, scope, campus_code=None, role_category=role_category, start_date=start_date, end_date=end_date
    )
    by_campus: dict[str, dict] = {}
    for row in report["rows"]:
        bucket = by_campus.setdefault(
            row["campus_code"], {"campus_code": row["campus_code"], "total": 0, "by_status": {}}
        )
        bucket["total"] += row["count"]
        bucket["by_status"][row["status"]] = bucket["by_status"].get(row["status"], 0) + row["count"]
    results = [by_campus[code] for code in sorted(by_campus)]
    return {"scope_note": report["scope_note"], "count": len(results), "results": results}


def _tool_get_category_vacancy_report(
    db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict
) -> dict:
    campus_code = args.get("campus_code")
    _campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    rows, _total, _category_counts = vacancy_register.list_vacancy_register_rows(
        db, scope, limit=2000, offset=0, sort_by="department_name", sort_dir="asc", campus_code=campus_code
    )
    rows = _apply_department_scope(rows, dept_scope)

    totals = {
        category.value: {
            "role_category": category.value,
            "department_count": 0,
            "working_count": 0,
            "approved_count": 0,
            "vacancy_count": 0,
        }
        for category in StaffRoleCategoryEnum
    }
    for row in rows:
        if row["category"] is None:
            continue
        bucket = totals[row["category"].value]
        bucket["department_count"] += 1
        bucket["working_count"] += row["working_count"]
        bucket["approved_count"] += row["approved_count"]
        bucket["vacancy_count"] += row["vacancy_count"]
    results = [totals[category.value] for category in StaffRoleCategoryEnum]
    return {"scope_note": scope_note, "results": results}


def _tool_get_sanctioned_vs_working(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    campus_code = args.get("campus_code")
    role_category = _parse_role_category(args.get("role_category"))
    department_id = _parse_uuid_arg(args.get("department_id"), "department_id")

    if department_id is None:
        # No department_id given -- the org/campus-wide sanctioned-strength
        # totals from get_dashboard_kpis, which have no department dimension
        # (dept_scope restriction doesn't apply to this branch).
        kpis = reporting.get_dashboard_kpis(db, scope, campus_code=campus_code, role_category=role_category)
        return {
            "scope_note": kpis["scope_note"],
            "sanctioned_approved_total": kpis["sanctioned_approved_total"],
            "sanctioned_working_total": kpis["sanctioned_working_total"],
            "sanctioned_vacancy_total": kpis["sanctioned_vacancy_total"],
        }

    _campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    rows, _total, _category_counts = vacancy_register.list_vacancy_register_rows(
        db,
        scope,
        limit=2000,
        offset=0,
        sort_by="department_name",
        sort_dir="asc",
        campus_code=campus_code,
        category=role_category,
        department_id=department_id,
    )
    rows = _apply_department_scope(rows, dept_scope)
    results = [_serialize_vacancy_register_row(r) for r in rows]
    return {"scope_note": scope_note, "count": len(results), "results": results}


def _tool_get_vacancy_approval_status(
    db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict
) -> dict:
    campus_code = args.get("campus_code")
    department_id = _parse_uuid_arg(args.get("department_id"), "department_id")
    limit = min(int(args.get("limit") or 20), 50)

    _campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    rows, _total, _category_counts = vacancy_register.list_vacancy_register_rows(
        db,
        scope,
        limit=2000,
        offset=0,
        sort_by="department_name",
        sort_dir="asc",
        campus_code=campus_code,
        department_id=department_id,
    )
    rows = _apply_department_scope(rows, dept_scope)
    rows = rows[:limit]
    results = [
        {
            "department_id": str(r["department_id"]),
            "department_name": r["department_name"],
            "campus_code": r["campus_code"],
            "approval_status": r["approval_status"],
            "approval_status_request_count": r["approval_status_request_count"],
        }
        for r in rows
    ]
    return {"scope_note": scope_note, "count": len(results), "results": results}


def _tool_get_recruitment_pipeline(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    # Neither get_dashboard_kpis.application_pipeline_funnel nor
    # recruitment_funnel_report's rows carry a department dimension --
    # dept_scope restriction doesn't apply here.
    campus_code = args.get("campus_code")
    role_category = _parse_role_category(args.get("role_category"))
    start_date = _parse_date_arg(args.get("start_date"), "start_date")
    end_date = _parse_date_arg(args.get("end_date"), "end_date")

    kpis = reporting.get_dashboard_kpis(
        db, scope, campus_code=campus_code, role_category=role_category, start_date=start_date, end_date=end_date
    )
    funnel_report = reporting.recruitment_funnel_report(
        db, scope, campus_code=campus_code, role_category=role_category, start_date=start_date, end_date=end_date
    )
    return {
        "scope_note": kpis["scope_note"],
        "pipeline_funnel": kpis["application_pipeline_funnel"],
        "by_campus_role_status": funnel_report["rows"],
    }


def _tool_get_interview_status(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    # interview_report's rows have no department dimension -- dept_scope
    # restriction doesn't apply here.
    campus_code = args.get("campus_code")
    role_category = _parse_role_category(args.get("role_category"))
    status_arg = args.get("status")
    if status_arg is not None and status_arg not in InterviewScheduleStatusEnum.__members__:
        raise ValueError(
            f"Unknown status '{status_arg}'. Valid values: {', '.join(InterviewScheduleStatusEnum.__members__)}."
        )
    start_date = _parse_date_arg(args.get("start_date"), "start_date")
    end_date = _parse_date_arg(args.get("end_date"), "end_date")

    report = reporting.interview_report(
        db, scope, campus_code=campus_code, role_category=role_category, start_date=start_date, end_date=end_date
    )
    rows = report["rows"]
    if status_arg is not None:
        rows = [r for r in rows if r["status"] == status_arg]
    return {"scope_note": report["scope_note"], "count": len(rows), "results": rows}


def _tool_get_offer_status(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    # offer_report's rows have no department dimension -- dept_scope
    # restriction doesn't apply here.
    campus_code = args.get("campus_code")
    role_category = _parse_role_category(args.get("role_category"))
    status_arg = args.get("status")
    if status_arg is not None and status_arg not in OfferStatusEnum.__members__:
        raise ValueError(f"Unknown status '{status_arg}'. Valid values: {', '.join(OfferStatusEnum.__members__)}.")
    start_date = _parse_date_arg(args.get("start_date"), "start_date")
    end_date = _parse_date_arg(args.get("end_date"), "end_date")

    report = reporting.offer_report(
        db, scope, campus_code=campus_code, role_category=role_category, start_date=start_date, end_date=end_date
    )
    rows = report["rows"]
    if status_arg is not None:
        rows = [r for r in rows if r["status"] == status_arg]
    return {"scope_note": report["scope_note"], "count": len(rows), "results": rows}


def _tool_get_joining_report(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    # joining_report's rows have no department dimension -- dept_scope
    # restriction doesn't apply here.
    campus_code = args.get("campus_code")
    role_category = _parse_role_category(args.get("role_category"))
    start_date = _parse_date_arg(args.get("start_date"), "start_date")
    end_date = _parse_date_arg(args.get("end_date"), "end_date")
    report = reporting.joining_report(
        db, scope, campus_code=campus_code, role_category=role_category, start_date=start_date, end_date=end_date
    )
    return {"scope_note": report["scope_note"], "count": len(report["rows"]), "results": report["rows"]}


def _tool_get_resignation_report(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    campus_code = args.get("campus_code")
    start_date = _parse_date_arg(args.get("start_date"), "start_date")
    end_date = _parse_date_arg(args.get("end_date"), "end_date")
    report = reporting.resignation_report(db, scope, campus_code=campus_code, start_date=start_date, end_date=end_date)
    rows = _apply_department_scope(report["rows"], dept_scope)
    # department_id was only needed for the dept_scope filter above --
    # reporting.resignation_report's own row shape carries it as a raw
    # uuid.UUID (not JSON-serializable), unlike every other field on that
    # row, so it's stringified here rather than leaking a non-JSON type into
    # this tool's json.dumps'd result.
    results = [{**r, "department_id": str(r["department_id"]) if r["department_id"] else None} for r in rows]
    return {"scope_note": report["scope_note"], "count": len(results), "results": results}


def _tool_get_open_vacancy_aging(db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict) -> dict:
    """"Open" here means the same thing list_open_vacancies already uses:
    an active (is_active=True) JobPosting with at least one still-OPEN
    HiringSlot underneath it. days_open is measured from
    JobPosting.published_at (not VacancyRequest.submitted_at) -- published_at
    is the moment the position actually became publicly seekable by
    candidates; submitted_at only marks the start of the internal Dean/HR
    approval workflow (already covered by list_pending_vacancy_approvals'
    own oldest-first ordering) and a request can sit in DRAFT/SUBMITTED for
    reasons unrelated to how long an actual public vacancy has gone
    unfilled. A HiringSlot approved but not yet published (no JobPosting
    row yet) has no meaningful "open" aging under this definition and is
    excluded, consistent with list_open_vacancies' own is_active filter.
    """
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, args.get("campus_code"))
    role_category = _parse_role_category(args.get("role_category"))
    min_days_open = args.get("min_days_open")
    limit = min(int(args.get("limit") or 20), 50)

    query = (
        db.query(JobPosting, VacancyRequest, ApprovedVacancy, Department, Campus)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .join(Department, VacancyRequest.department_id == Department.id)
        .join(Campus, JobPosting.campus_id == Campus.id)
        .filter(JobPosting.is_active.is_(True))
    )
    if campus_id_filter is not None:
        query = query.filter(JobPosting.campus_id == campus_id_filter)
    if role_category is not None:
        query = query.filter(VacancyRequest.role_category == role_category)
    if dept_scope.is_restricted:
        query = query.filter(VacancyRequest.department_id.in_(dept_scope.department_ids))
    rows = query.order_by(JobPosting.published_at.asc()).all()

    now = datetime.now(timezone.utc)
    results = []
    for posting, vr, approved, dept, campus in rows:
        open_slot_count = (
            db.query(func.count(HiringSlot.id))
            .filter(HiringSlot.approved_vacancy_id == approved.id, HiringSlot.status == HiringSlotStatusEnum.OPEN)
            .scalar()
        )
        if not open_slot_count:
            continue
        days_open = (now - posting.published_at).days
        if min_days_open is not None and days_open < int(min_days_open):
            continue
        results.append(
            {
                "job_posting_id": str(posting.id),
                "position_title": vr.position_title,
                "campus_code": campus.code,
                "role_category": vr.role_category.value,
                "department_name": dept.name,
                "published_at": posting.published_at.isoformat(),
                "days_open": days_open,
                "open_slot_count": open_slot_count,
            }
        )
    results.sort(key=lambda r: r["days_open"], reverse=True)
    results = results[:limit]
    return {"scope_note": scope_note, "count": len(results), "results": results}


def _tool_get_monthly_recruitment_report(
    db: Session, scope: CampusScope, dept_scope: DepartmentScope, args: dict
) -> dict:
    """Thin combined snapshot -- not a new deep report, just vacancy/
    interview/offer/joining totals for one calendar month, each reusing an
    existing REPORT_BUILDERS function's own start_date/end_date filtering.
    No department dimension on any of the four underlying reports --
    dept_scope restriction doesn't apply here."""
    now = datetime.now(timezone.utc)
    try:
        year = int(args.get("year") or now.year)
        month = int(args.get("month") or now.month)
    except (TypeError, ValueError) as exc:
        raise ValueError("month/year must be integers.") from exc
    if not 1 <= month <= 12:
        raise ValueError("month must be between 1 and 12.")
    campus_code = args.get("campus_code")

    period_start = date(year, month, 1)
    period_end = date(year, month, calendar.monthrange(year, month)[1])

    vacancy = reporting.vacancy_report(db, scope, campus_code=campus_code, start_date=period_start, end_date=period_end)
    interviews = reporting.interview_report(
        db, scope, campus_code=campus_code, start_date=period_start, end_date=period_end
    )
    offers = reporting.offer_report(db, scope, campus_code=campus_code, start_date=period_start, end_date=period_end)
    joining = reporting.joining_report(db, scope, campus_code=campus_code, start_date=period_start, end_date=period_end)

    def _total(report: dict) -> int:
        return sum(row["count"] for row in report["rows"])

    return {
        "scope_note": vacancy["scope_note"],
        "period": f"{year:04d}-{month:02d}",
        "vacancy_requests_count": _total(vacancy),
        "interviews_count": _total(interviews),
        "offers_count": _total(offers),
        "joinings_count": _total(joining),
    }


TOOL_EXECUTORS = {
    "list_pending_vacancy_approvals": _tool_list_pending_vacancy_approvals,
    "list_open_vacancies": _tool_list_open_vacancies,
    "list_interviews": _tool_list_interviews,
    "list_pending_offers": _tool_list_pending_offers,
    "pipeline_status_counts": _tool_pipeline_status_counts,
    "get_vacancy_summary": _tool_get_vacancy_summary,
    "get_department_vacancies": _tool_get_department_vacancies,
    "get_campus_vacancy_report": _tool_get_campus_vacancy_report,
    "get_category_vacancy_report": _tool_get_category_vacancy_report,
    "get_sanctioned_vs_working": _tool_get_sanctioned_vs_working,
    "get_vacancy_approval_status": _tool_get_vacancy_approval_status,
    "get_recruitment_pipeline": _tool_get_recruitment_pipeline,
    "get_interview_status": _tool_get_interview_status,
    "get_offer_status": _tool_get_offer_status,
    "get_joining_report": _tool_get_joining_report,
    "get_resignation_report": _tool_get_resignation_report,
    "get_open_vacancy_aging": _tool_get_open_vacancy_aging,
    "get_monthly_recruitment_report": _tool_get_monthly_recruitment_report,
}

HERMES_TOOL_DEFS = [
    {
        "name": "list_pending_vacancy_approvals",
        "description": (
            "List vacancy requests awaiting Dean and/or HR approval, oldest first. Use this for any "
            "question about which vacancy requests are pending/awaiting approval right now -- e.g. "
            "'which vacancies are pending approval', 'what's stuck with the Dean/HR'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to, e.g. SSE. Ignored for single-campus callers.",
                },
                "stage": {
                    "type": "string",
                    "enum": ["AWAITING_DEAN", "AWAITING_HR", "ANY_PENDING"],
                    "description": "Which approval stage to filter to. Defaults to ANY_PENDING.",
                },
                "limit": {"type": "integer", "description": "Max rows to return, default 20, max 50."},
            },
        },
    },
    {
        "name": "list_open_vacancies",
        "description": "List currently published, active job postings with their open hiring slots.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to, e.g. SSE. Ignored for single-campus callers.",
                },
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "limit": {"type": "integer", "description": "Max rows to return, default 20, max 50."},
            },
        },
    },
    {
        "name": "list_interviews",
        "description": "List interview schedules.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "status": {
                    "type": "string",
                    "enum": ["SCHEDULED", "COMPLETED", "CANCELLED", "RESCHEDULED"],
                    "description": "Defaults to SCHEDULED.",
                },
                "upcoming_only": {
                    "type": "boolean",
                    "description": "If true (default), only interviews scheduled at or after now.",
                },
                "limit": {"type": "integer", "description": "Max rows to return, default 20, max 50."},
            },
        },
    },
    {
        "name": "list_pending_offers",
        "description": "List job offers, defaulting to draft/sent (not yet accepted/declined/expired/withdrawn).",
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "status": {
                    "type": "string",
                    "enum": ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"],
                    "description": "Single status override. Defaults to DRAFT+SENT.",
                },
                "limit": {"type": "integer", "description": "Max rows to return, default 20, max 50."},
            },
        },
    },
    {
        "name": "pipeline_status_counts",
        "description": "Aggregate counts of applications by pipeline status, optionally for one job posting.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "job_posting_id": {
                    "type": "string",
                    "description": "UUID of a specific job posting to restrict counts to.",
                },
            },
        },
    },
    {
        "name": "get_vacancy_summary",
        "description": (
            "High-level vacancy summary: total open positions, urgent vacancy count, and an always-all-3 "
            "Teaching/Non-Teaching/Housekeeping breakdown. Good first tool for a broad 'how are we doing on "
            "vacancies' question."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter the top-line totals to.",
                },
            },
        },
    },
    {
        "name": "get_department_vacancies",
        "description": (
            "Department-level vacancy register rows (working/approved/vacancy counts, filled %, statuses). "
            "Sorted by vacancy_count descending by default -- use this for 'which departments have the "
            "highest vacancies' and, with min_vacancy_count, 'departments with more than N vacancies'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "department_id": {"type": "string", "description": "UUID of a specific department."},
                "min_vacancy_count": {
                    "type": "integer",
                    "description": "Only include departments with at least this many vacancies.",
                },
                "limit": {"type": "integer", "description": "Max rows to return, default 20, max 50."},
            },
        },
    },
    {
        "name": "get_campus_vacancy_report",
        "description": "Vacancy request counts grouped by campus (with a status breakdown per campus).",
        "input_schema": {
            "type": "object",
            "properties": {
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "start_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive lower bound."},
                "end_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive upper bound."},
            },
        },
    },
    {
        "name": "get_category_vacancy_report",
        "description": (
            "Working/approved/vacancy totals grouped by staff role category (always Teaching, Non-Teaching, "
            "and Housekeeping) -- use this to compare the three categories."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
            },
        },
    },
    {
        "name": "get_sanctioned_vs_working",
        "description": (
            "Sanctioned (approved) strength vs. actual working headcount vs. vacancy. Without department_id, "
            "returns campus/org-wide totals; with department_id, returns that department's own row."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "department_id": {"type": "string", "description": "UUID of a specific department."},
            },
        },
    },
    {
        "name": "get_vacancy_approval_status",
        "description": "Per-department vacancy-request approval status (APPROVAL_PENDING/REJECTED/APPROVED/NO_REQUESTS).",
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "department_id": {"type": "string", "description": "UUID of a specific department."},
                "limit": {"type": "integer", "description": "Max rows to return, default 20, max 50."},
            },
        },
    },
    {
        "name": "get_recruitment_pipeline",
        "description": (
            "Application pipeline funnel (Applied -> Screening -> Interview -> Selected -> Offer -> Joined -> "
            "Rejected) plus a per-campus/role-category/status breakdown."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "start_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive lower bound."},
                "end_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive upper bound."},
            },
        },
    },
    {
        "name": "get_interview_status",
        "description": (
            "Interview counts aggregated by campus/role-category/status/type -- for questions like 'how many "
            "interviews are completed/scheduled/cancelled'. For a literal upcoming-interview list, use "
            "list_interviews instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "status": {
                    "type": "string",
                    "enum": ["SCHEDULED", "COMPLETED", "CANCELLED", "RESCHEDULED"],
                    "description": "Filter to a single status.",
                },
                "start_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive lower bound."},
                "end_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive upper bound."},
            },
        },
    },
    {
        "name": "get_offer_status",
        "description": (
            "Offer counts aggregated by campus/role-category/status -- for questions like 'how many offers "
            "were accepted/declined this month'. For a literal pending-offers list, use list_pending_offers "
            "instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "status": {
                    "type": "string",
                    "enum": ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"],
                    "description": "Filter to a single status.",
                },
                "start_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive lower bound."},
                "end_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive upper bound."},
            },
        },
    },
    {
        "name": "get_joining_report",
        "description": "Joining/onboarding counts aggregated by campus/role-category/onboarding-completion status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "start_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive lower bound."},
                "end_date": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive upper bound."},
            },
        },
    },
    {
        "name": "get_resignation_report",
        "description": "Resigned-employee counts grouped by campus, department, and role category.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "start_date": {
                    "type": "string",
                    "description": "ISO date (YYYY-MM-DD), inclusive lower bound on separation_date.",
                },
                "end_date": {
                    "type": "string",
                    "description": "ISO date (YYYY-MM-DD), inclusive upper bound on separation_date.",
                },
            },
        },
    },
    {
        "name": "get_open_vacancy_aging",
        "description": (
            "How long currently-open published vacancies have been open (days since the job posting was "
            "published), sorted longest-open first -- use for 'vacancies open for more than N days' with "
            "min_days_open."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
                "role_category": {
                    "type": "string",
                    "enum": ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"],
                    "description": "Staff role category to filter to.",
                },
                "min_days_open": {
                    "type": "integer",
                    "description": "Only include postings open at least this many days.",
                },
                "limit": {"type": "integer", "description": "Max rows to return, default 20, max 50."},
            },
        },
    },
    {
        "name": "get_monthly_recruitment_report",
        "description": (
            "Combined one-month snapshot (vacancy request / interview / offer / joining counts) for a "
            "given month and year -- defaults to the current month if omitted."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {"type": "integer", "description": "1-12. Defaults to the current month."},
                "year": {"type": "integer", "description": "e.g. 2026. Defaults to the current year."},
                "campus_code": {
                    "type": "string",
                    "description": "Campus code to narrow to. Ignored for single-campus callers.",
                },
            },
        },
    },
]


# --- Deterministic "actions" metadata --------------------------------------
# Built entirely from *which tools were actually called and with what
# arguments* -- never from parsing the LLM's own answer text. See
# AssistantAction (app/schemas/assistant.py) for the response shape.
#
# open_page query params: only `category` and `department` are ever set,
# because a grep across frontend/src/pages confirms those are the only two
# URL-persisted list-page filters that exist today (`category` via
# frontend/src/hooks/useCategoryTabState.ts, on the Sanctioned Strength /
# Dashboard / Job Postings / etc. pages; `department` as a literal
# department_id deep-link, currently only read by SanctionedStrengthPage).
# `campus_code` is deliberately never added to an open_page query -- no page
# reads a campus_code URL param yet, and attaching an inert one would look
# like a working deep link that silently does nothing. `category`'s value is
# translated to that hook's lowercase-hyphenated URL vocabulary (e.g.
# NON_TEACHING -> "non-teaching"), not left as the raw enum name.
_CATEGORY_URL_PARAM: dict[str, str] = {
    "TEACHING": "teaching",
    "NON_TEACHING": "non-teaching",
    "HOUSEKEEPING": "housekeeping",
}

# tool_name -> (path, label) for a deep link into the frontend page that
# shows this tool's underlying data (see frontend/src/App.tsx for the route
# table this was read from).
_OPEN_PAGE_TOOLS: dict[str, tuple[str, str]] = {
    "list_pending_vacancy_approvals": ("/vacancy-approvals", "Open Vacancy Approvals"),
    "list_open_vacancies": ("/job-postings", "Open Job Postings"),
    "list_interviews": ("/interviews", "Open Interviews"),
    "list_pending_offers": ("/offers", "Open Offers"),
    "pipeline_status_counts": ("/dashboard", "Open Dashboard"),
    "get_vacancy_summary": ("/dashboard", "Open Dashboard"),
    "get_department_vacancies": ("/sanctioned-strength", "Open Vacancy Register"),
    "get_vacancy_approval_status": ("/sanctioned-strength", "Open Vacancy Register"),
    "get_sanctioned_vs_working": ("/sanctioned-strength", "Open Vacancy Register"),
    "get_category_vacancy_report": ("/sanctioned-strength", "Open Vacancy Register"),
    "get_open_vacancy_aging": ("/job-postings", "Open Job Postings"),
    "get_interview_status": ("/interviews", "Open Interviews"),
    "get_offer_status": ("/offers", "Open Offers"),
    "get_joining_report": ("/onboarding", "Open Onboarding"),
    "get_resignation_report": ("/employees", "Open Employees"),
    "get_monthly_recruitment_report": ("/dashboard", "Open Dashboard"),
}

# tool_name -> REPORT_BUILDERS key, for tools that wrap one of the 9 (8
# original + "resignations") report types 1:1. `params` mirror
# GET /reports/{report_type}/export's actual query param names
# (campus_code, role_category, start_date, end_date) --
# app/api/v1/routers/reports.py's export_report/_build_report.
_EXPORT_TOOLS: dict[str, str] = {
    "get_campus_vacancy_report": "vacancies",
    "get_recruitment_pipeline": "recruitment-funnel",
    "get_interview_status": "interviews",
    "get_offer_status": "offers",
    "get_joining_report": "joining",
    "get_resignation_report": "resignations",
}

_MAX_ACTIONS = 4


def _build_actions(tool_calls: list[tuple[str, dict]]) -> list[dict]:
    actions: list[dict] = []
    seen: set[tuple] = set()

    for tool_name, args in tool_calls:
        if tool_name in _OPEN_PAGE_TOOLS:
            path, label = _OPEN_PAGE_TOOLS[tool_name]
            query: dict[str, str] = {}
            category_arg = args.get("category") or args.get("role_category")
            if category_arg in _CATEGORY_URL_PARAM:
                query["category"] = _CATEGORY_URL_PARAM[category_arg]
            department_id_arg = args.get("department_id")
            if department_id_arg:
                query["department"] = str(department_id_arg)
            dedupe_key = ("open_page", path, tuple(sorted(query.items())))
            if dedupe_key not in seen:
                seen.add(dedupe_key)
                actions.append({"type": "open_page", "label": label, "path": path, "query": query or None})

        if tool_name in _EXPORT_TOOLS:
            report_type = _EXPORT_TOOLS[tool_name]
            params: dict[str, str] = {}
            for arg_key in ("campus_code", "role_category", "start_date", "end_date"):
                value = args.get(arg_key)
                if value:
                    params[arg_key] = str(value)
            dedupe_key = ("export_excel", report_type, tuple(sorted(params.items())))
            if dedupe_key not in seen:
                seen.add(dedupe_key)
                actions.append(
                    {
                        "type": "export_excel",
                        "label": f"Export {report_type.replace('-', ' ').title()} (Excel)",
                        "report_type": report_type,
                        "params": params or None,
                    }
                )

    return actions[:_MAX_ACTIONS]


def run_assistant_query(
    db: Session,
    *,
    scope: CampusScope,
    client,
    question: str,
    actor_role: str,
    dept_scope: DepartmentScope | None = None,
    conversation_history: list[dict] | None = None,
) -> tuple[str, list[str], list[dict]]:
    # dept_scope defaults to fully-unrestricted rather than being a required
    # kwarg -- app/api/v1/routers/assistant.py always passes a real one, but
    # existing direct-call test sites (tests/test_assistant.py) construct
    # this function's args without it, and must keep working unchanged.
    dept_scope = dept_scope or DepartmentScope(is_restricted=False, department_ids=None)

    today = datetime.now(timezone.utc).date().isoformat()
    messages: list[dict] = []
    if conversation_history:
        # Additive (AssistantQueryRequest.conversation_history) -- capped to
        # the last _MAX_CONVERSATION_HISTORY_TURNS entries so a long-running
        # frontend chat session can't grow this call's token usage without
        # bound. Prior turns are prepended verbatim ahead of the new
        # question; the frontend owns persisting/sending them, there is no
        # server-side session storage.
        for turn in conversation_history[-_MAX_CONVERSATION_HISTORY_TURNS:]:
            messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": f"[today: {today}, caller role: {actor_role}]\n\n{question}"})

    tools_used: list[str] = []
    tool_calls: list[tuple[str, dict]] = []

    for call_number in range(1, _MAX_TOOL_CALLS + 1):
        response = ai_client.call_with_tools(
            client, system=HERMES_SYSTEM_PROMPT, tools=HERMES_TOOL_DEFS, messages=messages
        )

        if response.stop_reason != "tool_use":
            text_block = next((block for block in response.content if block.type == "text"), None)
            if text_block is None:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY, detail="AI service returned an unexpected response"
                )
            return text_block.text, tools_used, _build_actions(tool_calls)

        if call_number == _MAX_TOOL_CALLS:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not reach a final answer within the allotted steps",
            )

        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            executor = TOOL_EXECUTORS.get(block.name)
            try:
                if executor is None:
                    raise ValueError(f"Unknown tool '{block.name}'")
                payload = executor(db, scope, dept_scope, block.input or {})
                tools_used.append(block.name)
                tool_calls.append((block.name, block.input or {}))
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(payload)})
            except Exception as exc:
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps({"error": str(exc)}),
                        "is_error": True,
                    }
                )
        messages.append({"role": "user", "content": tool_results})

    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Assistant query failed")


def build_daily_briefing_stats(db: Session, scope: CampusScope) -> dict:
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, None)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    week_end = now + timedelta(days=7)

    def _apply_campus(query, column):
        if campus_id_filter is not None:
            return query.filter(column == campus_id_filter)
        return query

    pending_vacancy_approvals = _apply_campus(
        db.query(VacancyRequest).filter(
            VacancyRequest.status.in_((VacancyRequestStatusEnum.SUBMITTED, VacancyRequestStatusEnum.DEAN_APPROVED))
        ),
        VacancyRequest.campus_id,
    ).count()

    open_vacancies = _apply_campus(
        db.query(JobPosting).filter(JobPosting.is_active.is_(True)), JobPosting.campus_id
    ).count()

    interviews_today = _apply_campus(
        db.query(InterviewSchedule).filter(
            InterviewSchedule.status == InterviewScheduleStatusEnum.SCHEDULED,
            InterviewSchedule.scheduled_at >= today_start,
            InterviewSchedule.scheduled_at < today_end,
        ),
        InterviewSchedule.campus_id,
    ).count()

    interviews_this_week = _apply_campus(
        db.query(InterviewSchedule).filter(
            InterviewSchedule.status == InterviewScheduleStatusEnum.SCHEDULED,
            InterviewSchedule.scheduled_at >= now,
            InterviewSchedule.scheduled_at <= week_end,
        ),
        InterviewSchedule.campus_id,
    ).count()

    pending_offers_query = db.query(Offer).join(Application, Offer.application_id == Application.id).filter(
        Offer.status.in_(_NON_TERMINAL_OFFER_STATUSES)
    )
    pending_offers = _apply_campus(pending_offers_query, Application.campus_id).count()

    pipeline_query = db.query(Application.status, func.count(Application.id)).group_by(Application.status)
    pipeline_query = _apply_campus(pipeline_query, Application.campus_id)
    pipeline_status_counts = {s.value: c for s, c in pipeline_query.all()}

    return {
        "scope_note": scope_note,
        "pending_vacancy_approvals": pending_vacancy_approvals,
        "open_vacancies": open_vacancies,
        "interviews_today": interviews_today,
        "interviews_this_week": interviews_this_week,
        "pending_offers": pending_offers,
        "pipeline_status_counts": pipeline_status_counts,
    }


_DAILY_BRIEFING_SYSTEM_PROMPT = """\
You write a short, warm, one-paragraph daily HR briefing for SIMATS \
recruitment staff from structured stats. Mention the most actionable \
numbers (pending approvals, interviews today) first. Do not invent any \
number not present in the stats. Plain prose, no headings, no bullet \
points."""


def narrate_daily_briefing(client, stats: dict) -> str:
    return ai_client.generate_narrative(
        client, system=_DAILY_BRIEFING_SYSTEM_PROMPT, user_content=json.dumps(stats), max_tokens=400
    )
