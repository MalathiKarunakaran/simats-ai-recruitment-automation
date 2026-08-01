import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import HiringSlotStatusEnum


class JobPosting(Base):
    __tablename__ = "job_postings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    approved_vacancy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("approved_vacancies.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Placeholder for a future public apply page (Module 5) -- no external
    # portal distribution logic here, that's Module 4 / Phase 6.
    public_apply_slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False, index=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    approved_vacancy: Mapped["ApprovedVacancy"] = relationship(back_populates="job_posting")
    campus: Mapped["Campus"] = relationship()

    # Denormalized read-only conveniences for the position-tracking view
    # (Job Postings list: Job Position / Department / Available / Required).
    # Same pattern as InterviewSchedule.panel_member_ids -- a plain @property
    # backed by an already-loaded relationship, which Pydantic's
    # from_attributes=True picks up automatically with no router changes.
    @property
    def position_title(self) -> str:
        return self.approved_vacancy.vacancy_request.position_title

    @property
    def department_id(self) -> uuid.UUID:
        return self.approved_vacancy.vacancy_request.department_id

    @property
    def required_count(self) -> int:
        return self.approved_vacancy.total_positions

    @property
    def available_count(self) -> int:
        # A slot only stops counting as available once someone has actually
        # joined (FILLED) -- a RESERVED slot (candidate selected, still mid
        # offer/joining) hasn't locked the seat yet, since offers can be
        # declined or a selected candidate can withdraw before joining.
        return sum(
            1
            for slot in self.approved_vacancy.hiring_slots
            if slot.status in (HiringSlotStatusEnum.OPEN, HiringSlotStatusEnum.RESERVED)
        )

    def __repr__(self) -> str:
        return f"<JobPosting {self.public_apply_slug}>"
