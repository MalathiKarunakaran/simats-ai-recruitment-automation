"""selection batches, selection batch members

Revision ID: 8c4e2a6b0d31
Revises: 7b3d1f5a9c20
Create Date: 2026-10-31

docs/specs/selection-batches.md: two new tables, nothing existing changed.
Status is a plain string, so downgrade is a clean drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "8c4e2a6b0d31"
down_revision: Union[str, Sequence[str], None] = "7b3d1f5a9c20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id():
    return sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False)


def _uuid(name, nullable=True):
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        "selection_batches",
        _id(),
        sa.Column("batch_no", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        _uuid("campus_id"),
        sa.Column("note", sa.Text(), nullable=True),
        _uuid("created_by_id", nullable=False),
        sa.Column("sent_on", sa.Date(), nullable=False),
        sa.Column("university_ref_no", sa.String(length=100), nullable=True),
        sa.Column("university_approved_on", sa.Date(), nullable=True),
        _uuid("approval_recorded_by_id"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["campus_id"], ["campuses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["approval_recorded_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_no", name="uq_selection_batches_batch_no"),
    )
    for col in ("status", "campus_id", "created_at"):
        op.create_index(f"ix_selection_batches_{col}", "selection_batches", [col])

    op.create_table(
        "selection_batch_members",
        _id(),
        _uuid("batch_id", nullable=False),
        _uuid("talent_pool_entry_id", nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("designation", sa.String(length=255), nullable=True),
        sa.Column("department", sa.String(length=255), nullable=True),
        sa.Column("category", sa.String(length=20), nullable=True),
        sa.Column("qualification", sa.String(length=255), nullable=True),
        sa.Column("experience", sa.String(length=100), nullable=True),
        sa.Column("panel_remarks", sa.Text(), nullable=True),
        sa.Column("proposed_salary", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["selection_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["talent_pool_entry_id"], ["talent_pool_entries.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "talent_pool_entry_id", name="uq_selection_batch_member"),
    )
    op.create_index("ix_selection_batch_members_batch_id", "selection_batch_members", ["batch_id"])
    op.create_index("ix_selection_batch_members_talent_pool_entry_id", "selection_batch_members", ["talent_pool_entry_id"])


def downgrade() -> None:
    op.drop_table("selection_batch_members")
    op.drop_table("selection_batches")
