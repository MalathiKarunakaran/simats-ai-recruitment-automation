import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import InterviewRecommendationEnum, InterviewScheduleStatusEnum, InterviewTypeEnum


class InterviewSchedule(Base):
    __tablename__ = "interview_schedules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Denormalized from application.campus_id, same rationale as elsewhere
    # in this codebase -- cheap scope filtering without a join.
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    interview_type: Mapped[InterviewTypeEnum] = mapped_column(
        Enum(InterviewTypeEnum, name="interview_type_enum"), nullable=False
    )
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    # Manually pasted by HR (e.g. a Google Meet/Zoom link they created
    # themselves) -- no calendar/video API integration in this phase.
    meeting_link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[InterviewScheduleStatusEnum] = mapped_column(
        Enum(InterviewScheduleStatusEnum, name="interview_schedule_status_enum"),
        nullable=False,
        default=InterviewScheduleStatusEnum.SCHEDULED,
        index=True,
    )
    scheduled_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped["Application"] = relationship()
    campus: Mapped["Campus"] = relationship()
    scheduled_by: Mapped["User"] = relationship(foreign_keys=[scheduled_by_id])
    panel_assignments: Mapped[list["InterviewPanelAssignment"]] = relationship(
        back_populates="interview_schedule"
    )
    feedback_entries: Mapped[list["InterviewFeedback"]] = relationship(back_populates="interview_schedule")

    @property
    def panel_member_ids(self) -> list[uuid.UUID]:
        return [assignment.panel_member_id for assignment in self.panel_assignments]

    def __repr__(self) -> str:
        return f"<InterviewSchedule {self.interview_type} @ {self.scheduled_at}>"


class InterviewPanelAssignment(Base):
    __tablename__ = "interview_panel_assignments"
    __table_args__ = (
        UniqueConstraint("interview_schedule_id", "panel_member_id", name="uq_panel_assignment_schedule_member"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    interview_schedule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interview_schedules.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    panel_member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    interview_schedule: Mapped["InterviewSchedule"] = relationship(back_populates="panel_assignments")
    panel_member: Mapped["User"] = relationship()

    def __repr__(self) -> str:
        return f"<InterviewPanelAssignment {self.interview_schedule_id}/{self.panel_member_id}>"


class InterviewFeedback(Base):
    __tablename__ = "interview_feedback"
    __table_args__ = (
        UniqueConstraint("interview_schedule_id", "panel_member_id", name="uq_feedback_schedule_member"),
        CheckConstraint("technical_score IS NULL OR technical_score BETWEEN 1 AND 10", name="technical_score_range"),
        CheckConstraint(
            "communication_score IS NULL OR communication_score BETWEEN 1 AND 10", name="communication_score_range"
        ),
        CheckConstraint("research_score IS NULL OR research_score BETWEEN 1 AND 10", name="research_score_range"),
        CheckConstraint(
            "teaching_demo_score IS NULL OR teaching_demo_score BETWEEN 1 AND 10", name="teaching_demo_score_range"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    interview_schedule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interview_schedules.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    panel_member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    technical_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    communication_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    research_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Only populated when the application's vacancy role_category == TEACHING.
    teaching_demo_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overall_recommendation: Mapped[InterviewRecommendationEnum] = mapped_column(
        Enum(InterviewRecommendationEnum, name="interview_recommendation_enum"), nullable=False
    )
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    interview_schedule: Mapped["InterviewSchedule"] = relationship(back_populates="feedback_entries")
    panel_member: Mapped["User"] = relationship()

    def __repr__(self) -> str:
        return f"<InterviewFeedback {self.interview_schedule_id}/{self.panel_member_id} ({self.overall_recommendation})>"
