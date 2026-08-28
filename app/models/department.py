import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import StaffRoleCategoryEnum


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint("campus_id", "name", name="uq_department_campus_name"),
        # Both mirror what migration e1f2a3b4c5d6 creates. Declared here
        # too so `scripts/check_schema_drift.py` (CI's migrations job)
        # sees model and migration agree, and so the test suite's
        # `Base.metadata.create_all` schema matches production's.
        CheckConstraint(
            "array_length(supported_categories, 1) >= 1",
            name="ck_department_supported_categories_not_empty",
        ),
        Index(
            "ix_departments_supported_categories",
            "supported_categories",
            postgresql_using="gin",
        ),
    )

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
    # in.
    code: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    # A department is a PLACE that staff of one or more categories work in --
    # CSE employs Assistant Professors (TEACHING) *and* Lab Assistants
    # (NON_TEACHING) at the same time. This replaced a single NOT NULL
    # `category` column on 2026-08-28 (migration
    # `e1f2a3b4c5d6_department_supported_categories.py`), which forced that
    # false exclusivity and made every NON_TEACHING designation on a
    # TEACHING department fail bulk-upload validation.
    #
    # `Designation.category` remains single-valued and is the AUTHORITATIVE
    # category for recruitment; this column only says which categories a
    # department is *permitted* to contain. Validation is therefore a
    # membership test (`supports()` below), never an equality test -- see
    # `designations.py::_unsupported_departments`,
    # `designation_import.py::_resolve_department_codes` and
    # `sanctioned_strength.py`'s create guard.
    #
    # Stored as a Postgres array rather than a link table because the other
    # side is a fixed three-member enum, not an entity: it keeps the
    # category tab counts a single `unnest` GROUP BY instead of a join, and
    # leaves soft-delete/restore semantics untouched. Never empty -- a
    # department with no supported category could hold no staff at all; the
    # migration adds a CHECK constraint enforcing that.
    supported_categories: Mapped[list[StaffRoleCategoryEnum]] = mapped_column(
        ARRAY(Enum(StaffRoleCategoryEnum, name="staff_role_category_enum")),
        nullable=False,
        # Mirrors the old scalar column's "ambiguous -> NON_TEACHING" default
        # so any code path that builds a Department without stating
        # categories (seed.py, tracker_import.py, migration.py, test
        # fixtures) keeps working unchanged.
        default=lambda: [StaffRoleCategoryEnum.NON_TEACHING],
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

    def supports(self, category: StaffRoleCategoryEnum) -> bool:
        """Whether staff of `category` are permitted in this department.

        The single place the permission question is asked, so the three
        validation sites (designation CRUD, designation bulk upload,
        sanctioned strength) can never drift apart on it.
        """
        return category in (self.supported_categories or ())

    def __repr__(self) -> str:
        return f"<Department {self.name} @ {self.campus_id}>"
