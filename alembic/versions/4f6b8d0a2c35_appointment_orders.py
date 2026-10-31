"""appointment orders

Revision ID: 4f6b8d0a2c35
Revises: 3e5a7c9b1d24
Create Date: 2026-10-31

docs/specs/provisional-order-and-allotment.md: one new table for the
provisional appointment orders issued in the app. Status is a plain string,
so downgrade is a clean drop.

`address` (the letter's address snapshot) was added here in place on 31-Oct,
before this revision had run anywhere but throwaway databases; the matching
`candidates.address` is its own revision, 5a1c3e7b9d42.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "4f6b8d0a2c35"
down_revision: Union[str, Sequence[str], None] = "3e5a7c9b1d24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid(name, nullable=True):
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        "appointment_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        _uuid("application_id", nullable=False),
        _uuid("campus_id", nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("order_number", sa.String(length=64), nullable=False),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        _uuid("issued_by_id", nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("candidate_name", sa.String(length=150), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("designation", sa.String(length=150), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("campus_code", sa.String(length=10), nullable=False),
        sa.Column("college_name", sa.String(length=200), nullable=False),
        sa.Column("principal_name", sa.String(length=150), nullable=False),
        sa.Column("department_name", sa.String(length=150), nullable=False),
        sa.Column("joining_date", sa.Date(), nullable=True),
        sa.Column("probation_end_date", sa.Date(), nullable=False),
        sa.Column("signed_copy_key", sa.String(length=255), nullable=True),
        sa.Column("signed_copy_content_type", sa.String(length=50), nullable=True),
        sa.Column("signed_copy_size", sa.Integer(), nullable=True),
        _uuid("signed_copy_uploaded_by_id"),
        sa.Column("signed_copy_uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["campus_id"], ["campuses.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["issued_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["signed_copy_uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_number", name="uq_appointment_orders_order_number"),
        sa.UniqueConstraint("campus_id", "sequence", name="uq_appointment_orders_campus_sequence"),
    )
    for col in ("application_id", "campus_id", "status"):
        op.create_index(f"ix_appointment_orders_{col}", "appointment_orders", [col])


def downgrade() -> None:
    op.drop_table("appointment_orders")
