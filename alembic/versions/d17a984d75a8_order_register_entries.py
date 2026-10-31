"""order register entries

Revision ID: d17a984d75a8
Revises: 4f6b8d0a2c35
Create Date: 2026-10-31

Read-only mirror of the paper register of provisional appointment orders
(Google Sheet "Provisional Appointment Order", tab Sheet1), allowlisted
columns only. One new table; downgrade is a clean drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d17a984d75a8"
down_revision: Union[str, Sequence[str], None] = "4f6b8d0a2c35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "order_register_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("row_key", sa.String(length=64), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("sheet_row_number", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("order_date", sa.Date(), nullable=True),
        sa.Column("order_date_raw", sa.String(length=100), nullable=True),
        sa.Column("order_no_raw", sa.String(length=100), nullable=True),
        sa.Column("order_seq", sa.Integer(), nullable=True),
        sa.Column("college_raw", sa.String(length=100), nullable=True),
        sa.Column("campus_code", sa.String(length=10), nullable=True),
        sa.Column("bio_id", sa.String(length=100), nullable=True),
        sa.Column("emp_id", sa.String(length=100), nullable=True),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("dept_raw", sa.String(length=255), nullable=True),
        sa.Column("grade_raw", sa.String(length=255), nullable=True),
        sa.Column("sheet_joinee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["sheet_joinee_id"], ["sheet_joinees.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("row_key", name="uq_order_register_entries_row_key"),
    )
    for col in ("is_active", "campus_code", "bio_id", "sheet_joinee_id"):
        op.create_index(f"ix_order_register_entries_{col}", "order_register_entries", [col])


def downgrade() -> None:
    op.drop_table("order_register_entries")
