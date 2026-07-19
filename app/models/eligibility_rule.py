import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import StaffRoleCategoryEnum


class EligibilityRule(Base):
    """Admin-editable rule stating which campus+staff-category (+ optional
    position_title) combinations are permitted to require a given
    qualification keyword (e.g. "PHD") for Teaching positions. The presence
    of a matching active row at a campus is what makes that campus
    "eligible" for the keyword -- see app/services/eligibility.py."""

    __tablename__ = "eligibility_rules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    staff_category: Mapped[StaffRoleCategoryEnum] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"), nullable=False
    )
    # Null means "applies to all positions in this category at this campus".
    position_title: Mapped[str | None] = mapped_column(String(150), nullable=True)
    required_qualification_keyword: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus"] = relationship()

    def __repr__(self) -> str:
        return f"<EligibilityRule {self.staff_category} @ {self.campus_id} ({self.required_qualification_keyword})>"
