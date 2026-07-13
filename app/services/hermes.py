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

import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import CampusScope
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
from app.services import ai_client
from app.services.scoping import resolve_campus_filter

_MAX_TOOL_CALLS = 4

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
2. Reporting, dashboards, PPT/export generation, and trend analysis \
(the Reporting Agent) are NOT available yet -- they ship in a later phase. \
If asked for these, say so plainly rather than trying to force-fit one of \
your query tools.
3. Every tool result includes a scope_note describing exactly what data \
access was applied. Never claim broader coverage in your answer than what \
scope_note states -- if it says results are limited to one campus, your \
answer must reflect that limitation.
4. Use tools only for questions about vacancies, interviews, offers, and \
application pipeline status. For anything else, answer directly or say you \
don't have the information.
5. Be concise. Answer in plain prose (a short paragraph or a compact \
list), not JSON."""


_STAGE_TO_STATUSES = {
    "AWAITING_DEAN": (VacancyRequestStatusEnum.SUBMITTED,),
    "AWAITING_HR": (VacancyRequestStatusEnum.DEAN_APPROVED,),
    "ANY_PENDING": (VacancyRequestStatusEnum.SUBMITTED, VacancyRequestStatusEnum.DEAN_APPROVED),
}


def _tool_list_pending_vacancy_approvals(db: Session, scope: CampusScope, args: dict) -> dict:
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


def _tool_list_open_vacancies(db: Session, scope: CampusScope, args: dict) -> dict:
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


def _tool_list_interviews(db: Session, scope: CampusScope, args: dict) -> dict:
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


def _tool_list_pending_offers(db: Session, scope: CampusScope, args: dict) -> dict:
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


def _tool_pipeline_status_counts(db: Session, scope: CampusScope, args: dict) -> dict:
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


TOOL_EXECUTORS = {
    "list_pending_vacancy_approvals": _tool_list_pending_vacancy_approvals,
    "list_open_vacancies": _tool_list_open_vacancies,
    "list_interviews": _tool_list_interviews,
    "list_pending_offers": _tool_list_pending_offers,
    "pipeline_status_counts": _tool_pipeline_status_counts,
}

HERMES_TOOL_DEFS = [
    {
        "name": "list_pending_vacancy_approvals",
        "description": "List vacancy requests awaiting Dean and/or HR approval, oldest first.",
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
                    "description": "Campus code to narrow to, e.g. SHOTS. Ignored for single-campus callers.",
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
]


def run_assistant_query(
    db: Session,
    *,
    scope: CampusScope,
    client,
    question: str,
    actor_role: str,
) -> tuple[str, list[str]]:
    today = datetime.now(timezone.utc).date().isoformat()
    messages: list[dict] = [
        {"role": "user", "content": f"[today: {today}, caller role: {actor_role}]\n\n{question}"}
    ]
    tools_used: list[str] = []

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
            return text_block.text, tools_used

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
                payload = executor(db, scope, block.input or {})
                tools_used.append(block.name)
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
