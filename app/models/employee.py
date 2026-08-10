import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import EmploymentStatusEnum


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    # Scheme: {campus_code}-{4-digit sequence}, e.g. SSE-0001. Sequence is
    # per-campus, generated with a row lock for concurrency safety.
    employee_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    designation: Mapped[str] = mapped_column(String(150), nullable=False)
    # Nullable, purely additive Designation Master reference alongside the
    # existing free-text `designation` column above -- same "FK alongside
    # free-text" precedent as VacancyRequest.designation_id. Backfilled by a
    # case-insensitive exact-name match migration; left NULL where no match
    # is found (e.g. free-text designation strings that don't exist in the
    # Designation master). Needed for accurate designation-level Working
    # counts in the Sanctioned Strength breakdown (zany-snuggling-pie.md
    # Phase A/B).
    designation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("designations.id", ondelete="SET NULL"), nullable=True
    )
    date_of_joining: Mapped[date] = mapped_column(Date, nullable=False)
    # Future login-linkage hook (Module 5+) -- unused/nullable in Phase 2.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    employment_status: Mapped[EmploymentStatusEnum] = mapped_column(
        Enum(EmploymentStatusEnum, name="employment_status_enum"),
        nullable=False,
        default=EmploymentStatusEnum.ACTIVE,
    )
    separation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    separation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    separated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped["Application"] = relationship()
    campus: Mapped["Campus"] = relationship()
    department: Mapped["Department"] = relationship()
    designation_ref: Mapped["Designation"] = relationship()

    def __repr__(self) -> str:
        return f"<Employee {self.employee_code}>"
