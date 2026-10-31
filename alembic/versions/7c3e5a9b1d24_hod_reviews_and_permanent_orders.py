"""hod reviews and permanent orders

Revision ID: 7c3e5a9b1d24
Revises: 6b2d4f8a0c13
Create Date: 2026-10-31

docs/specs/hod-review-and-permanent-order.md: two new tables. The review's
recommendation is a plain string with a CHECK constraint, so downgrade is a
clean drop of both tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "7c3e5a9b1d24"
down_revision: Union[str, Sequence[str], None] = "6b2d4f8a0c13"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid(name, nullable=True):
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def _timestamps():
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        "hod_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        _uuid("application_id", nullable=False),
        _uuid("campus_id", nullable=False),
        sa.Column("hod_name", sa.String(length=150), nullable=False),
        sa.Column("review_date", sa.Date(), nullable=False),
        sa.Column("recommendation", sa.String(length=30), nullable=False),
        sa.Column("new_probation_end_date", sa.Date(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("file_key", sa.String(length=255), nullable=True),
        sa.Column("file_content_type", sa.String(length=50), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        _uuid("recorded_by_id", nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "recommendation IN ('RECOMMEND_PERMANENT', 'EXTEND_PROBATION', 'NOT_RECOMMENDED')",
            name="ck_hod_reviews_recommendation",
        ),
        sa.CheckConstraint(
            "recommendation <> 'EXTEND_PROBATION' OR new_probation_end_date IS NOT NULL",
            name="ck_hod_reviews_extend_has_date",
        ),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["campus_id"], ["campuses.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["recorded_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ("application_id", "campus_id"):
        op.create_index(f"ix_hod_reviews_{col}", "hod_reviews", [col])

    op.create_table(
        "permanent_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        _uuid("application_id", nullable=False),
        _uuid("campus_id", nullable=False),
        sa.Column("registrar_ref_no", sa.String(length=100), nullable=False),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("issued_to_faculty_on", sa.Date(), nullable=False),
        sa.Column("file_key", sa.String(length=255), nullable=True),
        sa.Column("file_content_type", sa.String(length=50), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        _uuid("file_uploaded_by_id"),
        sa.Column("file_uploaded_at", sa.DateTime(timezone=True), nullable=True),
        _uuid("recorded_by_id", nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["campus_id"], ["campuses.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["file_uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recorded_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("application_id", name="uq_permanent_orders_application_id"),
    )
    op.create_index("ix_permanent_orders_campus_id", "permanent_orders", ["campus_id"])


def downgrade() -> None:
    op.drop_table("permanent_orders")
    op.drop_table("hod_reviews")
