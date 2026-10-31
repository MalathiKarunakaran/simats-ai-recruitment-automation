"""New Joinees + Pro App Order sync tables (docs/specs/joinee-order-sync.md).

Read-only mirrors of two Google Sheet tabs, written only by
`services/sheet_sync.py`. Normalised states are plain strings with the
constants below, deliberately NOT Postgres enums: the migration stays fully
reversible and an unexpected value cannot reject a row.

`raw` holds only allowlisted sheet columns, and for joiners never the
mobile number. A joiner's mobile is used in memory to find a talent pool
entry and then discarded, so there is no column for it anywhere.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base

# Sources, as stored in sheet_sync_runs.source and used in the URL.
SOURCE_NEW_JOINEES = "NEW_JOINEES"
SOURCE_PRO_APP_ORDER = "PRO_APP_ORDER"
SOURCE_NEW_DEPARTMENTS = "NEW_DEPARTMENTS"
SOURCE_DEPARTMENT_FACULTY = "DEPARTMENT_FACULTY"
SOURCE_ORDER_REGISTER = "ORDER_REGISTER"

# SheetJoinee.category
CATEGORY_TEACHING = "TEACHING"
CATEGORY_NON_TEACHING = "NON_TEACHING"
CATEGORY_HOUSEKEEPING = "HOUSEKEEPING"

# SheetJoinee.employment_state
STATE_ACTIVE = "ACTIVE"
STATE_LEFT = "LEFT"
STATE_REJOINED = "REJOINED"

# ProvisionalOrder.order_status
ORDER_ISSUED = "ISSUED"
ORDER_PENDING = "PENDING"

# ProvisionalOrder.outcome
OUTCOME_PERMANENT_ORDER_RECEIVED = "PERMANENT_ORDER_RECEIVED"
OUTCOME_PROBATION_EXTENDED = "PROBATION_EXTENDED"
OUTCOME_NOT_RECOMMENDED = "NOT_RECOMMENDED"


class SheetJoinee(Base):
    __tablename__ = "sheet_joinees"
    __table_args__ = (UniqueConstraint("row_key", name="uq_sheet_joinees_row_key"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    row_key: Mapped[str] = mapped_column(String(64), nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sheet_row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)

    bio_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    new_bio_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    staff_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    app_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    employee_type_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    college_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    campus_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    campus_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    employment_state: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)

    joined_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    joined_on_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    interview_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    interview_on_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prov_order_given_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    prov_order_given_on_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    send_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    send_on_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    received_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_on_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)

    designation: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dept_new_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reporting_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    relieving_order_submitted: Mapped[str | None] = mapped_column(String(255), nullable=True)
    original_submitted: Mapped[str | None] = mapped_column(String(255), nullable=True)
    appointment_order: Mapped[str | None] = mapped_column(String(255), nullable=True)

    talent_pool_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("talent_pool_entries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProvisionalOrder(Base):
    __tablename__ = "provisional_orders"
    __table_args__ = (UniqueConstraint("row_key", name="uq_provisional_orders_row_key"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    row_key: Mapped[str] = mapped_column(String(64), nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sheet_row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)

    bio_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    emp_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    order_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    order_on_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    probation_end_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    probation_end_on_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    order_status_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    order_status: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    outcome_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)

    id_card: Mapped[str | None] = mapped_column(String(255), nullable=True)
    food_app: Mapped[str | None] = mapped_column(String(255), nullable=True)
    arms: Mapped[str | None] = mapped_column(String(255), nullable=True)
    app_360: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_submitted_adfa: Mapped[str | None] = mapped_column(String(255), nullable=True)
    room_allotted: Mapped[str | None] = mapped_column(String(255), nullable=True)

    sheet_joinee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sheet_joinees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

# DepartmentFaculty.role
ROLE_HOD = "HOD"
ROLE_MEMBER = "MEMBER"

# DepartmentFaculty.employment_state (set only from the "Top 25" column)
FACULTY_STATE_LEFT = "LEFT"
FACULTY_STATE_ON_LEAVE = "ON_LEAVE"


class NewDepartment(Base):
    """One row of the New Departments sheet's `Approved_Depts` tab (S5)."""

    __tablename__ = "new_departments"
    __table_args__ = (UniqueConstraint("row_key", name="uq_new_departments_row_key"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    row_key: Mapped[str] = mapped_column(String(64), nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sheet_row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)

    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    additional_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    additional_count_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DepartmentFaculty(Base):
    """One row of the New Departments sheet's `Faculty ` tab (S5), key Bio ID."""

    __tablename__ = "department_faculty"
    __table_args__ = (UniqueConstraint("row_key", name="uq_department_faculty_row_key"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    row_key: Mapped[str] = mapped_column(String(64), nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sheet_row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)

    bio_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dept_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remark_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    status_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_additional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    top25_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    top_dept: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    employment_state: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    parent_dept_note: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vacancy_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)

    new_department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("new_departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sheet_joinee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sheet_joinees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OrderRegisterEntry(Base):
    """One row of the paper register of provisional appointment orders, kept in
    the Google Sheet "Provisional Appointment Order" (tab Sheet1). Read-only
    mirror; its only consumer is `reference_numbers.register_floor`, which
    continues the register's numbering per campus. Only the eight allowlisted
    columns are stored (never Address or Quali). Row key =
    campus + order number + BioID (else name) + occurrence, because the row
    position is not stable and the register reuses numbers."""

    __tablename__ = "order_register_entries"
    __table_args__ = (UniqueConstraint("row_key", name="uq_order_register_entries_row_key"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    row_key: Mapped[str] = mapped_column(String(64), nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sheet_row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)

    order_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    order_date_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    order_no_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    order_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    college_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    campus_code: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    bio_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    emp_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dept_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    grade_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)

    sheet_joinee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sheet_joinees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SheetSyncRun(Base):
    """One row per sync call, dry runs included (docs/specs/joinee-order-sync.md).
    `flagged` is a list of {row_number, key, reason}; never a cell value from
    a column outside the allowlist."""

    __tablename__ = "sheet_sync_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    counts: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    flagged: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    missing_headers: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
