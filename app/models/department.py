import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import StaffRoleCategoryEnum


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("campus_id", "name", name="uq_department_campus_name"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    # Department Master fields (nullable -- 50+ pre-existing rows have none of
    # these set and there's no backfill requirement; they're populated going
    # forward as master data is filled in).
    code: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    category: Mapped[StaffRoleCategoryEnum | None] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"), nullable=True
    )
    # Free text, deliberately not a lookup table (e.g. "Engineering", "Science",
    # "Administration", "Operations", "Academic Support").
    parent_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus"] = relationship(back_populates="departments")
    users: Mapped[list["User"]] = relationship(back_populates="department")

    def __repr__(self) -> str:
        return f"<Department {self.name} @ {self.campus_id}>"
