import uuid

import openai
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import (
    CampusScope,
    enforce_campus_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    require_permission,
    require_roles_or_coordinator_capability,
)
from app.models.application import Application
from app.models.enums import CoordinatorCapabilityEnum, InterviewScheduleStatusEnum, PermissionEnum, UserRoleEnum
from app.models.interview import InterviewFeedback, InterviewSchedule
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.interview import (
    InterviewFeedbackCreate,
    InterviewFeedbackRead,
    InterviewQuestionsResponse,
    InterviewScheduleCreate,
    InterviewScheduleRead,
    InterviewScheduleUpdate,
)
from app.services import ai_client, interviews
from app.services.ai_client import get_openai_client
from app.services.permissions import has_permission

router = APIRouter(prefix="/interviews", tags=["interviews"])

# RECRUITMENT_COORDINATOR's membership is additionally conditional on an
# INTERVIEWS capability grant -- see require_roles_or_coordinator_capability.
# Still used by generate_interview_questions below (_questions_gate) --
# no single PermissionEnum cleanly covers that endpoint's actual current
# access (INTERVIEW_PANEL_MEMBER doesn't have SCHEDULE_INTERVIEW or any other
# interview-write permission by Phase 1 default, so cutting it over would
# regress panel members' access), so it's deliberately left on the old gate.
_WRITE_ROLES = (UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_OFFICER, UserRoleEnum.SUPER_ADMIN)


def _questions_gate(
    current_user: User = Depends(
        require_roles_or_coordinator_capability(
            CoordinatorCapabilityEnum.INTERVIEWS, *_WRITE_ROLES, UserRoleEnum.INTERVIEW_PANEL_MEMBER
        )
    ),
) -> User:
    return current_user


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _get_schedule_or_404_scoped(db: Session, schedule_id: uuid.UUID, scope: CampusScope) -> InterviewSchedule:
    schedule = db.get(InterviewSchedule, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, schedule.campus_id)
    return schedule


@router.post("", response_model=InterviewScheduleRead, status_code=status.HTTP_201_CREATED)
def create_interview(
    payload: InterviewScheduleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.SCHEDULE_INTERVIEW)),
    scope: CampusScope = Depends(get_campus_scope),
) -> InterviewSchedule:
    application = db.get(Application, payload.application_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown application_id")
    enforce_campus_match(scope, application.campus_id)

    schedule = interviews.schedule_interview(
        db,
        application=application,
        interview_type=payload.interview_type,
        scheduled_at=payload.scheduled_at,
        duration_minutes=payload.duration_minutes,
        meeting_link=payload.meeting_link,
        location=payload.location,
        notes=payload.notes,
        panel_member_ids=payload.panel_member_ids,
        actor=current_user,
        request=request,
    )
    db.commit()
    db.refresh(schedule)
    return schedule


@router.get("", response_model=PaginatedResponse[InterviewScheduleRead])
def list_interviews(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    application_id: uuid.UUID | None = Query(None),
    status_filter: InterviewScheduleStatusEnum | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[InterviewScheduleRead]:
    query = db.query(InterviewSchedule)
    if not scope.is_global:
        query = query.filter(InterviewSchedule.campus_id == scope.campus_id)
    if application_id is not None:
        query = query.filter(InterviewSchedule.application_id == application_id)
    if status_filter is not None:
        query = query.filter(InterviewSchedule.status == status_filter)
    total = query.count()
    rows = query.order_by(InterviewSchedule.scheduled_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{interview_id}", response_model=InterviewScheduleRead)
def get_interview(
    interview_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> InterviewSchedule:
    return _get_schedule_or_404_scoped(db, interview_id, scope)


@router.patch("/{interview_id}", response_model=InterviewScheduleRead)
def update_interview(
    interview_id: uuid.UUID,
    payload: InterviewScheduleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    scope: CampusScope = Depends(get_campus_scope),
) -> InterviewSchedule:
    # This one PATCH endpoint covers 3 distinct actions via payload.status --
    # cancel gets its own permission; everything else (plain field edits,
    # implicit reschedule, and marking COMPLETED through this generic
    # endpoint rather than the panel-member feedback flow) falls under
    # RESCHEDULE_INTERVIEW, which every role that can reach this endpoint
    # today (HR_ADMIN, RECRUITMENT_OFFICER, and a RECRUITMENT_COORDINATOR
    # with the old INTERVIEWS capability, via Phase 1's backfill) already
    # has by default -- zero regression.
    required_permission = (
        PermissionEnum.CANCEL_INTERVIEW
        if payload.status == InterviewScheduleStatusEnum.CANCELLED
        else PermissionEnum.RESCHEDULE_INTERVIEW
    )
    if not has_permission(db, current_user, required_permission):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action",
        )

    schedule = _get_schedule_or_404_scoped(db, interview_id, scope)

    if payload.status == InterviewScheduleStatusEnum.COMPLETED:
        interviews.mark_completed(db, schedule=schedule, actor=current_user, request=request)
    else:
        updates = payload.model_dump(exclude={"status"}, exclude_unset=False)
        if payload.status is not None:
            updates["status"] = payload.status
        interviews.update_schedule(db, schedule=schedule, updates=updates, actor=current_user, request=request)

    db.commit()
    db.refresh(schedule)
    return schedule


@router.post("/{interview_id}/feedback", response_model=InterviewFeedbackRead, status_code=status.HTTP_201_CREATED)
def submit_interview_feedback(
    interview_id: uuid.UUID,
    payload: InterviewFeedbackCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MARK_INTERVIEW_COMPLETED)),
    scope: CampusScope = Depends(get_campus_scope),
) -> InterviewFeedback:
    schedule = _get_schedule_or_404_scoped(db, interview_id, scope)
    feedback = interviews.submit_feedback(
        db, schedule=schedule, panel_member=current_user, payload=payload, actor=current_user, request=request
    )
    db.commit()
    db.refresh(feedback)
    return feedback


@router.get("/{interview_id}/feedback", response_model=PaginatedResponse[InterviewFeedbackRead])
def list_interview_feedback(
    interview_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[InterviewFeedbackRead]:
    schedule = _get_schedule_or_404_scoped(db, interview_id, scope)
    query = db.query(InterviewFeedback).filter(InterviewFeedback.interview_schedule_id == schedule.id)
    total = query.count()
    rows = query.order_by(InterviewFeedback.submitted_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("/{interview_id}/generate-questions", response_model=InterviewQuestionsResponse)
def generate_interview_questions(
    interview_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_questions_gate),
    scope: CampusScope = Depends(get_campus_scope),
    ai: openai.OpenAI = Depends(get_openai_client),
) -> InterviewQuestionsResponse:
    schedule = _get_schedule_or_404_scoped(db, interview_id, scope)
    vacancy_request = schedule.application.job_posting.approved_vacancy.vacancy_request
    jd_text = vacancy_request.jd_draft or (
        f"{vacancy_request.position_title}\nQualification: {vacancy_request.qualification}\n"
        f"Experience: {vacancy_request.experience_required}"
    )
    result = ai_client.generate_interview_questions(
        ai, jd_text=jd_text, interview_type=schedule.interview_type.value, resume_text=None
    )
    return InterviewQuestionsResponse(**result)
