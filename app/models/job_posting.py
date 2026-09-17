import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import (
    EmploymentTypeEnum,
    HiringSlotStatusEnum,
    JOB_POSTING_LIVE_STATUSES,
    JobPostingStatusEnum,
    StaffRoleCategoryEnum,
)


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
    # NULL until the posting first goes live (2026-09-15): a posting now
    # starts as a DRAFT, and a date it was never published on would be false.
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # --- Content and lifecycle (2026-09-06) --------------------------------
    # Until now a posting had no text of its own (the ad was rebuilt from the
    # request on every read) and no state beyond is_active. The ad is now
    # snapshotted at publish and editable; `status` is the lifecycle and
    # `is_active` stays derived from it so every existing reader keeps
    # working: PUBLISHED/PAUSED -> True, everything else -> False.
    posting_number: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True, index=True)
    status: Mapped[JobPostingStatusEnum] = mapped_column(
        Enum(JobPostingStatusEnum, name="job_posting_status_enum"),
        nullable=False,
        default=JobPostingStatusEnum.PUBLISHED,
        server_default=JobPostingStatusEnum.PUBLISHED.value,
        index=True,
    )
    # Job title and job description.
    ad_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ad_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    apply_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # --- Structured job content (2026-09-15) --------------------------------
    # Copied from the vacancy request when the posting is created
    # (job_postings.snapshot_content), then the posting's own. The request
    # stays authoritative for approval and sanctioned strength; these are what
    # the advertisement says.
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsibilities: Mapped[str | None] = mapped_column(Text, nullable=True)
    required_qualification: Mapped[str | None] = mapped_column(Text, nullable=True)
    required_experience: Mapped[str | None] = mapped_column(String(100), nullable=True)
    required_skills: Mapped[list[str] | None] = mapped_column(ARRAY(String(100)), nullable=True)
    preferred_skills: Mapped[list[str] | None] = mapped_column(ARRAY(String(100)), nullable=True)
    employment_type: Mapped[EmploymentTypeEnum | None] = mapped_column(
        Enum(EmploymentTypeEnum, name="employment_type_enum", create_type=False), nullable=True
    )
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True
    )
    salary_min: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    salary_max: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    # When "Generate with AI" last wrote the draft. The text is a draft for a
    # person to edit; this only lets the screen say so.
    ai_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # --- Poster copy (2026-09-16) -------------------------------------------
    # The A4 poster's own marketing wording, written by the AI from the job
    # description and then edited by a person. Stored rather than generated at
    # download time so two prints of the same poster cannot differ, and so the
    # text can be reviewed before it reaches a notice board. All nullable: a
    # poster with none of it renders exactly as it did before these existed.
    poster_headline: Mapped[str | None] = mapped_column(String(60), nullable=True)
    poster_pitch: Mapped[str | None] = mapped_column(String(240), nullable=True)
    poster_bullets: Mapped[list[str] | None] = mapped_column(ARRAY(String(160)), nullable=True)
    poster_copy_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # --- Poster background image (2026-09-17) -------------------------------
    # An AI-generated image sitting behind the poster's navy header band. The
    # PNG itself lives in MinIO (one object per posting, overwritten on a
    # regenerate); only its key is here. `poster_background_enabled` is the
    # human approval and starts false on every generation -- AI art under the
    # SIMATS seal on a public notice board is printed only once somebody has
    # looked at it.
    poster_background_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    poster_background_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    poster_background_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    poster_background_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)

    @property
    def has_poster_background(self) -> bool:
        """Whether an image exists at all, which is a different question from
        whether it may be printed (`poster_background_enabled`). The storage
        key itself is plumbing and stays off the API."""
        return bool(self.poster_background_key)
    # --- Review trail (2026-09-15) ------------------------------------------
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_for_review_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_for_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    approved_vacancy: Mapped["ApprovedVacancy"] = relationship(back_populates="job_posting")
    campus: Mapped["Campus"] = relationship()
    location: Mapped["Location | None"] = relationship()  # noqa: F821
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_id])  # noqa: F821
    last_edited_by: Mapped["User | None"] = relationship(foreign_keys=[last_edited_by_id])  # noqa: F821
    submitted_for_review_by: Mapped["User | None"] = relationship(  # noqa: F821
        foreign_keys=[submitted_for_review_by_id]
    )
    approved_by: Mapped["User | None"] = relationship(foreign_keys=[approved_by_id])  # noqa: F821
    published_by: Mapped["User | None"] = relationship(foreign_keys=[published_by_id])  # noqa: F821
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

    # The three counts the posting screens show (2026-09-15). Requested is the
    # approved total, not a slot count: close() deletes OPEN slots, and a
    # closed vacancy of 12 with 3 hired still asked for 12. Filled is the same
    # FILLED count as available_count above, under an honest name.
    @property
    def positions_requested(self) -> int:
        return self.approved_vacancy.total_positions

    @property
    def positions_filled(self) -> int:
        return self.available_count

    @property
    def positions_remaining(self) -> int:
        return max(self.positions_requested - self.positions_filled, 0)

    @property
    def vacancy_request_id(self) -> uuid.UUID:
        return self.approved_vacancy.vacancy_request_id

    @property
    def vacancy_request_ref(self) -> str | None:
        return self.approved_vacancy.vacancy_request.request_ref

    @property
    def requisition_number(self) -> str | None:
        return self.approved_vacancy.requisition_number

    # Detail-view facts, read from the authoritative master data through the
    # vacancy request rather than copied onto the posting.
    @property
    def campus_code(self) -> str:
        return self.campus.code

    @property
    def campus_name(self) -> str:
        return self.campus.name

    @property
    def department_name(self) -> str:
        return self.approved_vacancy.vacancy_request.department.name

    @property
    def designation_id(self) -> uuid.UUID | None:
        return self.approved_vacancy.vacancy_request.designation_id

    @property
    def designation_name(self) -> str | None:
        designation = self.approved_vacancy.vacancy_request.designation
        return designation.name if designation else None

    @property
    def location_label(self) -> str | None:
        if self.location is None:
            return None
        parts = (self.location.name, self.location.block_building, self.location.floor_venue)
        return ", ".join(part for part in parts if part)

    @property
    def priority(self):
        return self.approved_vacancy.vacancy_request.priority

    @property
    def required_by(self) -> date | None:
        return self.approved_vacancy.vacancy_request.required_by

    @property
    def created_by_name(self) -> str | None:
        return self.created_by.full_name if self.created_by else None

    @property
    def last_edited_by_name(self) -> str | None:
        return self.last_edited_by.full_name if self.last_edited_by else None

    @property
    def submitted_for_review_by_name(self) -> str | None:
        return self.submitted_for_review_by.full_name if self.submitted_for_review_by else None

    @property
    def approved_by_name(self) -> str | None:
        return self.approved_by.full_name if self.approved_by else None

    @property
    def published_by_name(self) -> str | None:
        return self.published_by.full_name if self.published_by else None

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

    def reopen(self, now: datetime) -> None:
        """The mirror of close(), and the one way a posting leaves CLOSED.
        Added 2026-09-08: closing a vacancy used to be one-way, so a
        mis-click (AC Helper, closed five seconds after publishing) stranded
        the requisition with no way back. Only `vacancy_workflow.reopen` and
        `vacancy_workflow.publish` (re-publishing after an unpublish) call
        this.

        It goes back to where it was before the close (2026-09-15): a
        posting that had been live is PUBLISHED again, with `published_at`
        refreshed (the audit log holds the original date); one closed while
        still being drafted returns to DRAFT, since nobody ever approved it."""
        self.closed_at = None
        if self.published_at is None:
            self.status = JobPostingStatusEnum.DRAFT
            self.is_active = False
            return
        self.status = JobPostingStatusEnum.PUBLISHED
        self.is_active = True
        self.published_at = now

    def set_status(self, status: JobPostingStatusEnum) -> None:
        """Every non-close transition goes through here so `is_active` stays
        derived from `status`."""
        self.status = status
        self.is_active = status in JOB_POSTING_LIVE_STATUSES

    def __repr__(self) -> str:
        return f"<JobPosting {self.posting_number or self.public_apply_slug}>"
