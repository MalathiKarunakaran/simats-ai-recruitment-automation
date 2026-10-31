"""sheet joinees, provisional orders, sheet sync runs

Revision ID: 5a8c2e9f4b17
Revises: 3e5f7a9c1b2d
Create Date: 2026-10-30

docs/specs/joinee-order-sync.md step 2: three new tables, nothing existing
changed. States are plain strings, not Postgres enums, so downgrade is a
clean drop of the three tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "5a8c2e9f4b17"
down_revision: Union[str, Sequence[str], None] = "3e5f7a9c1b2d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id():
    return sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False)


def _stamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def _s(name, n, **kw):
    return sa.Column(name, sa.String(length=n), nullable=True, **kw)


def _d(name):
    return sa.Column(name, sa.Date(), nullable=True)


def upgrade() -> None:
    op.create_table(
        "sheet_joinees",
        _id(),
        sa.Column("row_key", sa.String(length=64), nullable=False),
        _s("content_hash", 64),
        sa.Column("sheet_row_number", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        _s("bio_id", 100), _s("new_bio_id", 100), _s("staff_id", 100), _s("app_no", 100), _s("full_name", 255),
        _s("employee_type_raw", 100), _s("category", 20), _s("college_raw", 100), _s("campus_code", 10),
        sa.Column("campus_id", postgresql.UUID(as_uuid=True), nullable=True),
        _s("status_raw", 100), _s("employment_state", 20),
        _d("joined_on"), _s("joined_on_raw", 100),
        _d("interview_on"), _s("interview_on_raw", 100),
        _d("prov_order_given_on"), _s("prov_order_given_on_raw", 100),
        _d("send_on"), _s("send_on_raw", 100),
        _d("received_on"), _s("received_on_raw", 100),
        _s("designation", 255), _s("department_raw", 255), _s("dept_new_raw", 255), _s("reporting_to", 255),
        _s("relieving_order_submitted", 255), _s("original_submitted", 255), _s("appointment_order", 255),
        sa.Column("talent_pool_entry_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        *_stamps(),
        sa.ForeignKeyConstraint(["campus_id"], ["campuses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["talent_pool_entry_id"], ["talent_pool_entries.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("row_key", name="uq_sheet_joinees_row_key"),
    )
    for col in ("is_active", "bio_id", "category", "campus_id", "employment_state", "talent_pool_entry_id"):
        op.create_index(f"ix_sheet_joinees_{col}", "sheet_joinees", [col])

    op.create_table(
        "provisional_orders",
        _id(),
        sa.Column("row_key", sa.String(length=64), nullable=False),
        _s("content_hash", 64),
        sa.Column("sheet_row_number", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        _s("bio_id", 100), _s("emp_id", 100), _s("full_name", 255),
        _d("order_on"), _s("order_on_raw", 100),
        _d("probation_end_on"), _s("probation_end_on_raw", 100),
        _s("order_status_raw", 100), _s("order_status", 20), _s("outcome_raw", 100), _s("outcome", 30),
        _s("id_card", 255), _s("food_app", 255), _s("arms", 255), _s("app_360", 255),
        _s("file_submitted_adfa", 255), _s("room_allotted", 255),
        sa.Column("sheet_joinee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        *_stamps(),
        sa.ForeignKeyConstraint(["sheet_joinee_id"], ["sheet_joinees.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("row_key", name="uq_provisional_orders_row_key"),
    )
    for col in ("is_active", "bio_id", "order_status", "outcome", "sheet_joinee_id"):
        op.create_index(f"ix_provisional_orders_{col}", "provisional_orders", [col])

    op.create_table(
        "sheet_sync_runs",
        _id(),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("dry_run", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("counts", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("flagged", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("missing_headers", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sheet_sync_runs_source", "sheet_sync_runs", ["source"])
    op.create_index("ix_sheet_sync_runs_created_at", "sheet_sync_runs", ["created_at"])


def downgrade() -> None:
    op.drop_table("sheet_sync_runs")
    op.drop_table("provisional_orders")
    op.drop_table("sheet_joinees")
