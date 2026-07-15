import uuid

import openai
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db, require_roles
from app.models.application import Application
from app.models.enums import InterviewScheduleStatusEnum, UserRoleEnum
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

router = APIRouter(prefix="/interviews", tags=["interviews"])

_WRITE_ROLES = (UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_OFFICER, UserRoleEnum.SUPER_ADMIN)


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
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
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
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> InterviewSchedule:
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
    current_user: User = Depends(require_roles(UserRoleEnum.INTERVIEW_PANEL_MEMBER, UserRoleEnum.SUPER_ADMIN)),
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
    current_user: User = Depends(
        require_roles(*_WRITE_ROLES, UserRoleEnum.INTERVIEW_PANEL_MEMBER)
    ),
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
