import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import SanctionedStrengthChangeSourceEnum, StaffRoleCategoryEnum
from app.models.location import Location


class SanctionedStrength(Base):
    """The permanent establishment record -- "how many posts is this
    campus+department+designation allowed to have", a real ceiling editable
    only by SANCTIONED_STRENGTH_WRITE_ROLES (SUPER_ADMIN/HR_ADMIN), distinct
    from the transactional VacancyRequest workflow that consumes against it
    (see zany-snuggling-pie.md's Context section -- "two clean, distinct
    concepts").

    Effective-dated rather than mutated in place: a revision to the
    sanctioned number is a new row (same key, later effective_from) rather
    than an overwrite of the old one, so the establishment's history over
    time is preserved on the table itself (in addition to
    SanctionedStrengthHistory, which records the same fact as a diff for
    audit/undo purposes).

    "Current" row per (campus_id, department_id, designation_id) = the row
    with the latest effective_from <= today among is_active=true rows for
    that key -- every read path (register rewrite, available_to_request,
    designation breakdown, bulk upload) must resolve this the same way; see
    app/services/sanctioned_strength.py::current_effective_rows, the one
    reusable resolver for this rule.
    """

    __tablename__ = "sanctioned_strength"
    __table_args__ = (
        CheckConstraint("approved_strength >= 0", name="approved_strength_nonneg"),
        UniqueConstraint(
            "campus_id",
            "department_id",
            "designation_id",
            "effective_from",
            name="uq_sanctioned_strength_key_effective_from",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    designation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("designations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Phase C (glowing-zooming-hamming.md) -- nullable everywhere except
    # Housekeeping rows (enforced in the router, not the DB, since Teaching/
    # Non-Teaching stay fully optional). Green-field column: every
    # pre-existing row gets NULL, no backfill.
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    category: Mapped[StaffRoleCategoryEnum] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"), nullable=False
    )
    approved_strength: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    department: Mapped["Department"] = relationship()
    designation: Mapped["Designation"] = relationship()
    location: Mapped["Location"] = relationship()
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped["User"] = relationship(foreign_keys=[updated_by_id])
    history: Mapped[list["SanctionedStrengthHistory"]] = relationship(
        back_populates="sanctioned_strength", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return (
            f"<SanctionedStrength {self.department_id}/{self.designation_id}="
            f"{self.approved_strength} from {self.effective_from}>"
        )


class SanctionedStrengthHistory(Base):
    """Append-only diff trail of every approved_strength change on a
    SanctionedStrength row. Deliberately separate from the generic AuditLog
    (app/models/audit_log.py) rather than reusing its before/after JSONB
    blobs -- a typed old_value/new_value pair plus bulk_upload_log_id
    linkage is what makes "undo last upload" (Phase F) a plain UPDATE
    without re-parsing JSON."""

    __tablename__ = "sanctioned_strength_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    sanctioned_strength_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sanctioned_strength.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # NULL only for the very first history row written alongside a brand new
    # SanctionedStrength row (there is no "old" value yet).
    old_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_value: Mapped[int] = mapped_column(Integer, nullable=False)
    changed_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[SanctionedStrengthChangeSourceEnum] = mapped_column(
        Enum(SanctionedStrengthChangeSourceEnum, name="sanctioned_strength_change_source_enum"),
        nullable=False,
    )
    # Populated only for source=BULK_UPLOAD rows -- see
    # app/models/bulk_upload_log.py.
    bulk_upload_log_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bulk_upload_log.id", ondelete="SET NULL"), nullable=True, index=True
    )

    sanctioned_strength: Mapped["SanctionedStrength"] = relationship(back_populates="history")
    changed_by: Mapped["User"] = relationship(foreign_keys=[changed_by_id])
    bulk_upload_log: Mapped["BulkUploadLog"] = relationship()

    def __repr__(self) -> str:
        return f"<SanctionedStrengthHistory {self.sanctioned_strength_id} {self.old_value}->{self.new_value}>"
