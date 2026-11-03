"""talent pool source refs

Revision ID: c6e8a0b2d4f6
Revises: a3c5e7f9b1d2
Create Date: 2026-11-03

The TS tab's Reference column by person, for the panel's Source chart. A new
table only, so downgrade is a clean drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c6e8a0b2d4f6"
down_revision: Union[str, Sequence[str], None] = "a3c5e7f9b1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "talent_pool_source_refs",
        sa.Column("match_key", sa.String(length=320), nullable=False),
        sa.Column("source", sa.String(length=60), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("match_key"),
    )


def downgrade() -> None:
    op.drop_table("talent_pool_source_refs")
