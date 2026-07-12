"""Module 8: Interview Management Agent.

Scheduling, panel assignment, and evaluation-form submission. Meeting links
are manually pasted by HR (no calendar/video API integration in this phase).
"""

import uuid
from datetime import datetime

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.enums import (
    INTERVIEW_TYPE_TO_APPLICATION_STATUS,
    InterviewScheduleStatusEnum,
    InterviewTypeEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.interview import InterviewFeedback, InterviewPanelAssignment, InterviewSchedule
from app.models.user import User
from app.schemas.interview import InterviewFeedbackCreate
from app.services import notifications, pipeline
from app.services.audit import log_create, log_update


def schedule_interview(
    db: Session,
    *,
    application: Application,
    interview_type: InterviewTypeEnum,
    scheduled_at: datetime,
    duration_minutes: int,
    meeting_link: str | None,
    location: str | None,
    notes: str | None,
    panel_member_ids: list[uuid.UUID],
    actor: User,
    request: Request | None = None,
) -> InterviewSchedule:
    panel_members: list[User] = []
    for panel_member_id in panel_member_ids:
        member = db.get(User, panel_member_id)
        if member is None or member.role != UserRoleEnum.INTERVIEW_PANEL_MEMBER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown panel member: {panel_member_id}"
            )
        if member.campus_id != application.campus_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Panel members must belong to the application's campus",
            )
        panel_members.append(member)

    schedule = InterviewSchedule(
        application_id=application.id,
        campus_id=application.campus_id,
        interview_type=interview_type,
        scheduled_at=scheduled_at,
        duration_minutes=duration_minutes,
        meeting_link=meeting_link,
        location=location,
        notes=notes,
        scheduled_by_id=actor.id,
    )
    db.add(schedule)
    db.flush()

    for member in panel_members:
        db.add(InterviewPanelAssignment(interview_schedule_id=schedule.id, panel_member_id=member.id))

    target_status = INTERVIEW_TYPE_TO_APPLICATION_STATUS[interview_type]
    pipeline.advance_if_behind(
        db, application=application, target_status=target_status, actor=actor, request=request
    )

    log_create(
        db,
        actor=actor,
        entity_type="InterviewSchedule",
        entity=schedule,
        campus_context_id=application.campus_id,
        after_state={"interview_type": interview_type.value, "scheduled_at": scheduled_at.isoformat()},
        request=request,
    )

    candidate = application.candidate
    notifications.notify(
        db,
        recipient_email=candidate.email,
        notification_type="INTERVIEW_SCHEDULED",
        subject=f"Interview scheduled: {interview_type.value}",
        body=f"An interview has been scheduled for {scheduled_at.isoformat()}.",
        campus_context_id=application.campus_id,
        related_entity_type="InterviewSchedule",
        related_entity_id=schedule.id,
        request=request,
    )
    for member in panel_members:
        notifications.notify(
            db,
            recipient_user=member,
            notification_type="INTERVIEW_SCHEDULED",
            subject=f"You are on the panel for an interview on {scheduled_at.isoformat()}",
            body=f"Interview type: {interview_type.value}.",
            related_entity_type="InterviewSchedule",
            related_entity_id=schedule.id,
            request=request,
        )

    return schedule


def update_schedule(
    db: Session, *, schedule: InterviewSchedule, updates: dict, actor: User, request: Request | None = None
) -> InterviewSchedule:
    before = {"status": schedule.status.value, "scheduled_at": schedule.scheduled_at.isoformat()}
    for field, value in updates.items():
        if value is not None:
            setattr(schedule, field, value)

    log_update(
        db,
        actor=actor,
        entity_type="InterviewSchedule",
        entity=schedule,
        campus_context_id=schedule.campus_id,
        before_state=before,
        after_state={"status": schedule.status.value, "scheduled_at": schedule.scheduled_at.isoformat()},
        request=request,
    )
    return schedule


def mark_completed(
    db: Session, *, schedule: InterviewSchedule, actor: User, request: Request | None = None
) -> InterviewSchedule:
    if schedule.status != InterviewScheduleStatusEnum.SCHEDULED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot mark completed from status {schedule.status.value}",
        )
    before = {"status": schedule.status.value}
    schedule.status = InterviewScheduleStatusEnum.COMPLETED

    log_update(
        db,
        actor=actor,
        entity_type="InterviewSchedule",
        entity=schedule,
        campus_context_id=schedule.campus_id,
        before_state=before,
        after_state={"status": schedule.status.value},
        request=request,
    )
    return schedule


def submit_feedback(
    db: Session,
    *,
    schedule: InterviewSchedule,
    panel_member: User,
    payload: InterviewFeedbackCreate,
    actor: User,
    request: Request | None = None,
) -> InterviewFeedback:
    is_assigned = (
        db.query(InterviewPanelAssignment)
        .filter(
            InterviewPanelAssignment.interview_schedule_id == schedule.id,
            InterviewPanelAssignment.panel_member_id == panel_member.id,
        )
        .one_or_none()
    )
    if is_assigned is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not an assigned panel member for this interview"
        )

    existing = (
        db.query(InterviewFeedback)
        .filter(
            InterviewFeedback.interview_schedule_id == schedule.id,
            InterviewFeedback.panel_member_id == panel_member.id,
        )
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Feedback already submitted for this interview"
        )

    role_category = schedule.application.job_posting.approved_vacancy.vacancy_request.role_category
    teaching_demo_score = (
        payload.teaching_demo_score if role_category == StaffRoleCategoryEnum.TEACHING else None
    )

    feedback = InterviewFeedback(
        interview_schedule_id=schedule.id,
        panel_member_id=panel_member.id,
        technical_score=payload.technical_score,
        communication_score=payload.communication_score,
        research_score=payload.research_score,
        teaching_demo_score=teaching_demo_score,
        overall_recommendation=payload.overall_recommendation,
        comments=payload.comments,
    )
    db.add(feedback)
    db.flush()

    log_create(
        db,
        actor=actor,
        entity_type="InterviewFeedback",
        entity=feedback,
        campus_context_id=schedule.campus_id,
        after_state={"overall_recommendation": payload.overall_recommendation.value},
        request=request,
    )
    return feedback
