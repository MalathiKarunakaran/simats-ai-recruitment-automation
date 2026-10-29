"""talent pool row key

Revision ID: 3e5f7a9c1b2d
Revises: 9c4d2e7f1a3b
Create Date: 2026-10-29

Sync step 2 of docs/specs/talent-pool-sheet-sync.md: the sync's own
identity for a row, unique per tab. Nullable, and existing rows keep NULL:
they were entered by hand, and the sync never touches a row without a key.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "3e5f7a9c1b2d"
down_revision: Union[str, Sequence[str], None] = "9c4d2e7f1a3b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("talent_pool_entries", sa.Column("row_key", sa.String(length=64), nullable=True))
    op.create_unique_constraint("uq_talent_pool_tab_row_key", "talent_pool_entries", ["source_tab", "row_key"])


def downgrade() -> None:
    op.drop_constraint("uq_talent_pool_tab_row_key", "talent_pool_entries", type_="unique")
    op.drop_column("talent_pool_entries", "row_key")
