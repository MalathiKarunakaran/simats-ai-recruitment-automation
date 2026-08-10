import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import HiringSlotStatusEnum, StaffRoleCategoryEnum


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
    # Denormalized from approved_vacancy.vacancy_request.role_category, same
    # rationale as campus_id above -- cheap category filtering without a
    # 2-hop join. Set once at publish() time (app/services/vacancy_workflow.py)
    # and never changes afterwards.
    role_category: Mapped[StaffRoleCategoryEnum] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"), nullable=False, index=True
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
    def requested_count(self) -> int:
        # Still needed -- a slot only stops counting here once someone has
        # actually joined (FILLED). A RESERVED slot (candidate selected,
        # still mid offer/joining) still counts as requested/needed, since
        # offers can be declined or a selected candidate can withdraw before
        # joining -- the seat isn't locked in until FILLED.
        return sum(
            1
            for slot in self.approved_vacancy.hiring_slots
            if slot.status in (HiringSlotStatusEnum.OPEN, HiringSlotStatusEnum.RESERVED)
        )

    @property
    def available_count(self) -> int:
        # Already filled/staffed -- counts up from 0 as candidates actually
        # join (HiringSlot reaches FILLED via pipeline.py's
        # _fill_slot_and_maybe_autoclose). requested_count + available_count
        # always sums to approved_vacancy.total_positions, the originally
        # sanctioned target.
        return sum(
            1 for slot in self.approved_vacancy.hiring_slots if slot.status == HiringSlotStatusEnum.FILLED
        )

    def __repr__(self) -> str:
        return f"<JobPosting {self.public_apply_slug}>"
