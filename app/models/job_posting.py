import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import HiringSlotStatusEnum, JobPostingStatusEnum, StaffRoleCategoryEnum


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
    # --- Content and lifecycle (2026-09-06) --------------------------------
    # Until now a posting had no text of its own (the ad was rebuilt from the
    # request on every read) and no state beyond is_active. The ad is now
    # snapshotted at publish and editable; `status` is the lifecycle and
    # `is_active` stays derived from it so every existing reader keeps
    # working: PUBLISHED/PAUSED -> True, CLOSED -> False.
    posting_number: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True, index=True)
    status: Mapped[JobPostingStatusEnum] = mapped_column(
        Enum(JobPostingStatusEnum, name="job_posting_status_enum"),
        nullable=False,
        default=JobPostingStatusEnum.PUBLISHED,
        server_default=JobPostingStatusEnum.PUBLISHED.value,
        index=True,
    )
    ad_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ad_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    apply_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    approved_vacancy: Mapped["ApprovedVacancy"] = relationship(back_populates="job_posting")
    campus: Mapped["Campus"] = relationship()
    # Where this posting is, per channel (2026-09-06). The posting itself
    # stays 1:1 with its approved vacancy; multiplicity lives here.
    channels: Mapped[list["JobPostingChannel"]] = relationship(back_populates="job_posting")

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

    @property
    def vacancy_request_id(self) -> uuid.UUID:
        return self.approved_vacancy.vacancy_request_id

    @property
    def requisition_number(self) -> str | None:
        return self.approved_vacancy.requisition_number

    @property
    def is_accepting_applications(self) -> bool:
        """Open to the public: live, not paused, and not past its deadline.
        Derived on read so expiry needs no scheduler."""
        if self.status != JobPostingStatusEnum.PUBLISHED:
            return False
        return self.apply_deadline is None or self.apply_deadline >= date.today()

    def close(self, now: datetime) -> None:
        """The one way a posting becomes CLOSED. Called by every code path
        that retires a vacancy (vacancy_workflow.close/cancel/
        adjust_slot_count, pipeline auto-close, tracker import) so `status`,
        `closed_at` and the derived `is_active` never disagree."""
        self.status = JobPostingStatusEnum.CLOSED
        self.closed_at = now
        self.is_active = False

    def __repr__(self) -> str:
        return f"<JobPosting {self.posting_number or self.public_apply_slug}>"
