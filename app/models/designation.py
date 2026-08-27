import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, String, Table, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum

# Pure join table (no independent identity) between Designation and
# Department -- a Designation Master entry can apply to more than one
# department (e.g. "Assistant Professor" across several teaching
# departments).
designation_departments = Table(
    "designation_departments",
    Base.metadata,
    Column(
        "designation_id",
        UUID(as_uuid=True),
        ForeignKey("designations.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "department_id",
        UUID(as_uuid=True),
        ForeignKey("departments.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Designation(Base):
    """Designation Master: the structured replacement for freehand
    VacancyRequest.position_title text, going forward. Kept purely additive
    alongside position_title -- see VacancyRequest.designation_id."""

    __tablename__ = "designations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[StaffRoleCategoryEnum] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"), nullable=False
    )
    qualification: Mapped[str] = mapped_column(Text, nullable=False)
    # Free text, matching VacancyRequest.experience_required's existing style
    # rather than a structured number.
    min_experience: Mapped[str] = mapped_column(String(100), nullable=False)
    employment_type: Mapped[EmploymentTypeEnum] = mapped_column(
        Enum(EmploymentTypeEnum, name="employment_type_enum"), nullable=False
    )
    # Free text, added for the Designation Master bulk-upload epic (backend
    # Phase 1) -- the bulk-upload template spec calls for a "Required
    # Skills" column with no prior home on this model. Optional: manual
    # create/update never required it before, and the bulk-upload import
    # treats it as optional too.
    required_skills: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    departments: Mapped[list["Department"]] = relationship(secondary=designation_departments)

    @property
    def department_ids(self) -> list[uuid.UUID]:
        return [department.id for department in self.departments]

    def __repr__(self) -> str:
        return f"<Designation {self.name} ({self.category})>"
