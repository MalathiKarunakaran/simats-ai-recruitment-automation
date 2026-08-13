import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enums import StaffRoleCategoryEnum


class Location(Base):
    """Location Master (glowing-zooming-hamming.md Phase B) -- a physical
    place (block/building + floor/venue) within a campus that other master
    data (Sanctioned Strength's Housekeeping rows in Phase C, the
    Housekeeping staff roster in Phase D) will reference. Green-field: no
    other table references `location_id` yet, so this module is purely
    additive until Phase C.

    Unlike `Department.category` (NOT NULL -- every department has exactly
    one staff category), `category` here is nullable: a single building/
    location can plausibly serve Teaching, Non-Teaching, and Housekeeping
    staff at once, so it is *not* forced into a single category. See the
    plan's "Lower-stakes design defaults" section.
    """

    __tablename__ = "locations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    block_building: Mapped[str | None] = mapped_column(String(150), nullable=True)
    floor_venue: Mapped[str | None] = mapped_column(String(150), nullable=True)
    category: Mapped[StaffRoleCategoryEnum | None] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<Location {self.name} @ {self.campus_id}>"
