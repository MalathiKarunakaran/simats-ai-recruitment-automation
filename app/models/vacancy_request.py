import uuid
from datetime import date, datetime

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import (
    EmploymentTypeEnum,
    StaffRoleCategoryEnum,
    VacancyPriorityEnum,
    VacancyRequestSourceEnum,
    VacancyRequestStatusEnum,
)


class VacancyRequest(Base):
    __tablename__ = "vacancy_requests"
    __table_args__ = (CheckConstraint("requested_count > 0", name="requested_count_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False
    )
    # Nullable, purely additive Designation Master reference alongside the
    # existing free-text position_title (76 real pre-existing rows have no
    # designation_id). When set on create, the service layer auto-populates
    # position_title from Designation.name -- see vacancy_requests.py.
    designation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("designations.id", ondelete="RESTRICT"), nullable=True
    )

    role_category: Mapped[StaffRoleCategoryEnum] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"), nullable=False
    )
    position_title: Mapped[str] = mapped_column(String(150), nullable=False)
    employment_type: Mapped[EmploymentTypeEnum] = mapped_column(
        Enum(EmploymentTypeEnum, name="employment_type_enum"), nullable=False
    )
    requested_count: Mapped[int] = mapped_column(Integer, nullable=False)
    qualification: Mapped[str] = mapped_column(Text, nullable=False)
    experience_required: Mapped[str] = mapped_column(String(100), nullable=False)
    salary_band_min: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    salary_band_max: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    jd_draft: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free-text notes from whoever raised the request (e.g. "urgent
    # replacement for retiring faculty") -- deliberately separate from
    # jd_draft, which is the actual job-description text shown on the
    # detail page's "Job Description" card and overwritten by AI JD
    # generation; conflating the two would silently destroy remarks the
    # next time someone generates a JD.
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    skills: Mapped[list[str] | None] = mapped_column(ARRAY(String(100)), nullable=True)
    priority: Mapped[VacancyPriorityEnum] = mapped_column(
        Enum(VacancyPriorityEnum, name="vacancy_priority_enum"),
        nullable=False,
        default=VacancyPriorityEnum.NORMAL,
    )
    status: Mapped[VacancyRequestStatusEnum] = mapped_column(
        Enum(VacancyRequestStatusEnum, name="vacancy_request_status_enum"),
        nullable=False,
        default=VacancyRequestStatusEnum.DRAFT,
        index=True,
    )

    requested_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    dean_reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    dean_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    hr_reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    hr_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rejected_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    cancelled_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The tracker workbook's own "Request ID" (app/services/tracker_import.py)
    # -- lets a re-import upsert instead of duplicating rows. Unset for
    # everything created through the normal in-app requisition flow.
    external_ref: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)

    # --- Intake fields (2026-08-30) ---------------------------------------
    # Where this request came from. NOT NULL with a MANUAL server_default, so
    # every pre-existing row backfills as MANUAL with no data migration.
    source: Mapped[VacancyRequestSourceEnum] = mapped_column(
        Enum(VacancyRequestSourceEnum, name="vacancy_request_source_enum"),
        nullable=False,
        default=VacancyRequestSourceEnum.MANUAL,
        server_default=VacancyRequestSourceEnum.MANUAL.value,
        index=True,
    )

    # Human-facing request identifier ("VR-2026-000123") shown on the QR
    # confirmation screen and quoted by requesters chasing a request.
    #
    # Deliberately NOT `external_ref` above, which is the tracker workbook's
    # own Request ID and is what lets a re-import upsert instead of
    # duplicating. Reusing it would make a QR submission collide with a
    # tracker row, so the two identifiers stay separate.
    #
    # Nullable because every row predating this column has none, and unique
    # so a generation race surfaces as an IntegrityError rather than two
    # requests quietly sharing an id.
    request_ref: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)

    # Where the vacancy physically sits. Nullable: Teaching/Non-Teaching
    # requests have never needed one, and every existing row has none.
    # RESTRICT matches every other location_id FK in this schema -- a Location
    # referenced by a live request must not be deletable out from under it.
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    # "Required by" date from the intake forms. Nullable -- it is a request,
    # not a commitment, and pre-existing rows have none.
    required_by: Mapped[date | None] = mapped_column(Date, nullable=True)

    # The person behind a QR submission, who has no `User` row at all.
    # `requested_by_id` above stays NOT NULL and points at the account that
    # owns the intake (see app/services/vacancy_request_intake.py) -- making
    # it nullable would have rippled through five notification call sites in
    # vacancy_workflow.py that dereference `.requested_by` as the recipient.
    # These three are the authoritative "who actually asked" for a QR row and
    # are all NULL on a normal in-app request.
    requester_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    requester_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requester_mobile: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Sanctioned Strength enforcement (zany-snuggling-pie.md Phase E) --
    # set only when a SUPER_ADMIN explicitly overrides the submit()-time
    # available_to_request block; both stay false/NULL on every ordinary
    # request. Added in Phase A (data-model-only) ahead of Phase E's
    # actual enforcement logic in app/services/vacancy_workflow.py.
    is_over_sanction: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    over_sanction_justification: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus"] = relationship()
    department: Mapped["Department"] = relationship()
    designation: Mapped["Designation"] = relationship()
    requested_by: Mapped["User"] = relationship(foreign_keys=[requested_by_id])
    approved_vacancy: Mapped["ApprovedVacancy"] = relationship(back_populates="vacancy_request", uselist=False)

    @property
    def requested_by_name(self) -> str | None:
        """Who to show as having raised this, for a UI "Raised by" column.

        Prefers `requester_name` exactly as the field comments above say to:
        on a QR row `requested_by` is the intake account, not the person who
        asked. Falls back to the requesting user's name for MANUAL and
        BULK_UPLOAD rows (on a bulk row that is the uploader, which is the
        best answer available unless the file named a requester).

        Read through `VacancyRequestRead`, whose list endpoint eager-loads
        `requested_by` -- without that this is an N+1 across the page.
        """
        if self.requester_name:
            return self.requester_name
        return self.requested_by.full_name if self.requested_by else None

    def __repr__(self) -> str:
        return f"<VacancyRequest {self.position_title} ({self.status})>"
