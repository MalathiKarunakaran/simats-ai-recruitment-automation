import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enums import ApplicationStatusEnum, InterviewTypeEnum, StaffRoleCategoryEnum


class PipelineStageConfig(Base):
    """Display-config-only mapping of a category-specific pipeline "stage"
    label (e.g. Teaching's "Demo class", Housekeeping's "Walk-in") to a
    sequence position and the real underlying Application.status (and,
    optionally, InterviewSchedule.interview_type) it corresponds to.

    This is purely a rendering aid for the frontend to relabel stage/progress
    indicators per an application's own role_category -- it is never read by
    app/services/pipeline.py and is not a second state machine. Every
    Application, regardless of role_category, still moves through the full,
    real ApplicationStatusEnum sequence (including the post-joining
    onboarding steps) exactly as pipeline.py enforces today; this table only
    controls how that progress is *labeled* in the UI.
    """

    __tablename__ = "pipeline_stage_configs"
    __table_args__ = (
        UniqueConstraint(
            "role_category", "sequence_position", name="uq_pipeline_stage_config_category_position"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    role_category: Mapped[StaffRoleCategoryEnum] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"), nullable=False, index=True
    )
    sequence_position: Mapped[int] = mapped_column(Integer, nullable=False)
    display_label: Mapped[str] = mapped_column(String(100), nullable=False)
    maps_to_status: Mapped[ApplicationStatusEnum] = mapped_column(
        Enum(ApplicationStatusEnum, name="application_status_enum"), nullable=False
    )
    # Null for stages that don't narrow to a specific interview type (e.g.
    # Housekeeping's "Verification" or Teaching's "Interview" stage) --
    # populated only where a stage maps to a distinct InterviewSchedule.interview_type
    # (e.g. Teaching's "Demo class" -> TEACHING_DEMO).
    maps_to_interview_type: Mapped[InterviewTypeEnum | None] = mapped_column(
        Enum(InterviewTypeEnum, name="interview_type_enum"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<PipelineStageConfig {self.role_category} #{self.sequence_position} {self.display_label!r}>"
