import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import ApplicationStatusEnum


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("candidate_id", "job_posting_id", name="uq_application_candidate_posting"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    job_posting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_postings.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Denormalized from job_posting.campus_id for cheap scope filtering,
    # same rationale as User.campus_id.
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[ApplicationStatusEnum] = mapped_column(
        Enum(ApplicationStatusEnum, name="application_status_enum"),
        nullable=False,
        default=ApplicationStatusEnum.APPLIED,
        index=True,
    )
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recorded_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Flat, spreadsheet-shaped fields for the real manual workflow -- kept
    # separate from InterviewSchedule/InterviewFeedback/Offer.salary_amount
    # on purpose (see app/services/tracker_import.py): those stay the
    # richer, structured path for anyone using the full UI; these are the
    # simple one-cell-per-field record the manual process actually keeps.
    panel_members: Mapped[str | None] = mapped_column(Text, nullable=True)
    panel_result: Mapped[str | None] = mapped_column(String(100), nullable=True)
    panel_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    salary_fixed: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    called_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    interview_scheduled_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    offer_given_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_joining_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    department_allotted_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    room_allotted: Mapped[str | None] = mapped_column(String(50), nullable=True)
    orientation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Free text, not a User FK -- RBAC today only has one CAMPUS_HOD per
    # campus, not a distinct HOD per department as the real process assumes.
    # Modeling that properly is a real RBAC expansion, out of scope here.
    hod_assigned: Mapped[str | None] = mapped_column(String(150), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    candidate: Mapped["Candidate"] = relationship()
    job_posting: Mapped["JobPosting"] = relationship()
    campus: Mapped["Campus"] = relationship()
    recorded_by: Mapped["User"] = relationship(foreign_keys=[recorded_by_id])
    department_allotted: Mapped["Department | None"] = relationship()

    def __repr__(self) -> str:
        return f"<Application {self.id} ({self.status})>"
