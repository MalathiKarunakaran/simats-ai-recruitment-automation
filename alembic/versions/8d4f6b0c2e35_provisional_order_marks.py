"""provisional order marks

Revision ID: 8d4f6b0c2e35
Revises: 7c3e5a9b1d24
Create Date: 2026-10-31

docs/specs/joining-screens.md, Step A2: one app-owned table of checklist
marks per provisional order. NULL in a value column = use the sheet's
value. Plain strings with CHECK constraints, no enums, so downgrade is a
clean drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "8d4f6b0c2e35"
down_revision: Union[str, Sequence[str], None] = "7c3e5a9b1d24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OUTCOMES = (
    "PERMANENT_ORDER_RECEIVED", "PROBATION_EXTENDED", "NOT_RECOMMENDED", "LEFT", "REJOIN", "TRA",
    "FAMILY_WAY", "NO_SUBMIT_PG", "LONG_LEAVE",
)  # fmt: skip


def _in(column, values):
    return f"{column} IS NULL OR {column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "provisional_order_marks",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("provisional_order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id_card_done", sa.Boolean(), nullable=True),
        sa.Column("food_app_done", sa.Boolean(), nullable=True),
        sa.Column("arms_done", sa.Boolean(), nullable=True),
        sa.Column("app_360_done", sa.Boolean(), nullable=True),
        sa.Column("adfa_file_done", sa.Boolean(), nullable=True),
        sa.Column("room_allotted", sa.String(length=255), nullable=True),
        sa.Column("order_status", sa.String(length=20), nullable=True),
        sa.Column("outcome", sa.String(length=30), nullable=True),
        sa.Column("registrar_order_issued", sa.Boolean(), nullable=True),
        sa.Column("registrar_order_date", sa.Date(), nullable=True),
        sa.Column("orientation_conducted", sa.Boolean(), nullable=True),
        sa.Column("orientation_date", sa.Date(), nullable=True),
        sa.Column("marked", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(_in("order_status", ("ISSUED", "PENDING")), name="ck_provisional_order_marks_order_status"),
        sa.CheckConstraint(_in("outcome", _OUTCOMES), name="ck_provisional_order_marks_outcome"),
        sa.ForeignKeyConstraint(["provisional_order_id"], ["provisional_orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provisional_order_id", name="uq_provisional_order_marks_provisional_order_id"),
    )


def downgrade() -> None:
    op.drop_table("provisional_order_marks")
