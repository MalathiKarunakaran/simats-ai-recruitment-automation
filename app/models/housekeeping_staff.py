import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import HousekeepingShiftEnum


class HousekeepingStaff(Base):
    """Housekeeping staff roster (glowing-zooming-hamming.md Phase D) -- a
    separate, standalone table from `Employee`, not a filtered view of it.

    Plan decision 3 (see the plan's Context section): `Employee.application_id`
    is a required, unique FK to a real recruitment-pipeline `Application`, and
    legacy/already-on-roster Housekeeping staff have no such trail -- so
    Housekeeping staff live here instead, on their own roster keyed by
    `bio_id` (the physical Bio-metric attendance ID SIMATS already uses for
    this staff category), not `employee_code`.

    `designation_id` must resolve to a Designation whose category is
    HOUSEKEEPING -- enforced in the router (app/api/v1/routers/
    housekeeping_staff.py), same "validate at the API layer, not a DB CHECK"
    choice `sanctioned_strength.py`'s own designation/department category
    match already makes (a DB-level CHECK spanning two tables isn't
    expressible without a trigger, which this codebase doesn't use anywhere).

    `location_id` is required (NOT NULL), unlike `SanctionedStrength.location_id`
    (nullable, only required-for-HOUSEKEEPING at the router level) -- every
    row in *this* table is Housekeeping staff by construction, so there is no
    Teaching/Non-Teaching case where it should ever be optional here.

    `bio_id` is unique per campus (`UniqueConstraint(campus_id, bio_id)`), not
    globally unique -- matching this codebase's default scoping convention
    for staff identifiers (`Employee.employee_code` is the one global
    exception, not the rule; see the plan's "Lower-stakes design defaults").
    """

    __tablename__ = "housekeeping_staff"
    __table_args__ = (
        UniqueConstraint("campus_id", "bio_id", name="uq_housekeeping_staff_campus_bio_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    bio_id: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    designation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("designations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    block: Mapped[str | None] = mapped_column(String(150), nullable=True)
    floor_venue: Mapped[str | None] = mapped_column(String(150), nullable=True)
    shift: Mapped[HousekeepingShiftEnum] = mapped_column(
        Enum(HousekeepingShiftEnum, name="housekeeping_shift_enum"), nullable=False
    )
    # Free text -- no self-referential-FK precedent anywhere in this codebase
    # (see the plan's "Lower-stakes design defaults" section).
    supervisor: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # Set when the roster row was created by the recruitment pipeline at
    # hand-over to HOD (app/services/joining.py) rather than entered by hand:
    # links the row to the Employee record so offboarding that employee
    # deactivates the roster row too, and the Housekeeping working count
    # (sanctioned_strength.working_count_for) moves in both directions.
    # NULL for legacy / hand-entered staff, who have no pipeline trail.
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus"] = relationship()
    designation: Mapped["Designation"] = relationship()
    location: Mapped["Location"] = relationship()
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped["User"] = relationship(foreign_keys=[updated_by_id])

    def __repr__(self) -> str:
        return f"<HousekeepingStaff {self.bio_id} {self.name} @ {self.campus_id}>"
