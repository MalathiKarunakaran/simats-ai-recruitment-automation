"""talent pool resume fields

Revision ID: a3c5e7f9b1d2
Revises: 9e1a3c5b7d46
Create Date: 2026-11-02

Gender and home state/country read from Selected candidates' resumes, for the
Selected breakdown. A new table only, so downgrade is a clean drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a3c5e7f9b1d2"
down_revision: Union[str, Sequence[str], None] = "9e1a3c5b7d46"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "talent_pool_resume_fields",
        sa.Column("talent_pool_entry_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("gender", sa.String(length=20), nullable=True),
        sa.Column("state", sa.String(length=100), nullable=True),
        sa.Column("country", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["talent_pool_entry_id"], ["talent_pool_entries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("talent_pool_entry_id"),
    )


def downgrade() -> None:
    op.drop_table("talent_pool_resume_fields")
