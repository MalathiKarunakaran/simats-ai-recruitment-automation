import uuid
from datetime import datetime

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
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
from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, VacancyPriorityEnum, VacancyRequestStatusEnum


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

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus"] = relationship()
    department: Mapped["Department"] = relationship()
    designation: Mapped["Designation"] = relationship()
    requested_by: Mapped["User"] = relationship(foreign_keys=[requested_by_id])
    approved_vacancy: Mapped["ApprovedVacancy"] = relationship(back_populates="vacancy_request", uselist=False)

    def __repr__(self) -> str:
        return f"<VacancyRequest {self.position_title} ({self.status})>"
