import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, UniqueConstraint, func
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
    # Department Master fields. `code`/`parent_group` stay nullable -- 50+
    # pre-existing rows have none of these set and there's no backfill
    # requirement; they're populated going forward as master data is filled
    # in. `category` was nullable too until the Phase 1 staff-category
    # migrations (see alembic/versions/*_backfill_department_category.py)
    # backfilled every remaining NULL row and added a NOT NULL constraint --
    # it's now a required, first-class dimension. The Python-side default
    # mirrors that migration's own "ambiguous -> NON_TEACHING" heuristic, so
    # any code path that constructs a Department without explicitly setting
    # category (seed.py, tracker_import.py, migration.py, test fixtures)
    # keeps working unchanged.
    code: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    category: Mapped[StaffRoleCategoryEnum] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"),
        nullable=False,
        default=StaffRoleCategoryEnum.NON_TEACHING,
    )
    # Free text, deliberately not a lookup table (e.g. "Engineering", "Science",
    # "Administration", "Operations", "Academic Support").
    parent_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Department Master hardening (2026-08-25 epic): free-text notes shown on
    # the master list/detail views. Optional, no length cap beyond Text's own.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus"] = relationship(back_populates="departments")
    users: Mapped[list["User"]] = relationship(back_populates="department")

    def __repr__(self) -> str:
        return f"<Department {self.name} @ {self.campus_id}>"
