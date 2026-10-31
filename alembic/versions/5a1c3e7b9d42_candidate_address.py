"""candidate address

Revision ID: 5a1c3e7b9d42
Revises: d17a984d75a8
Create Date: 2026-10-31

docs/specs/provisional-order-and-allotment.md: a nullable postal address on
the candidate, entered by staff (not the public apply form) and printed on
the provisional appointment order under the name. Nullable, no backfill, so
downgrade is a clean drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "5a1c3e7b9d42"
down_revision: Union[str, Sequence[str], None] = "d17a984d75a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("candidates", sa.Column("address", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("candidates", "address")
