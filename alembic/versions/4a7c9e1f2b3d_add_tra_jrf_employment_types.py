"""add_tra_jrf_employment_types

Revision ID: 4a7c9e1f2b3d
Revises: 1551c9070381
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4a7c9e1f2b3d'
down_revision: Union[str, Sequence[str], None] = '1551c9070381'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # TRA (Teaching Research Assistant) and JRF (Junior Research Fellow) --
    # user-requested additions to the Employment Type vocabulary. Postgres
    # requires ADD VALUE to run outside the block that then uses the new
    # value -- fine here since this migration only adds the labels and
    # doesn't write any TRA/JRF rows itself.
    op.execute("ALTER TYPE employment_type_enum ADD VALUE IF NOT EXISTS 'TRA'")
    op.execute("ALTER TYPE employment_type_enum ADD VALUE IF NOT EXISTS 'JRF'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres has no ALTER TYPE ... DROP VALUE -- the 'TRA'/'JRF' enum
    # labels intentionally stay in place on downgrade (same class of
    # limitation documented in 0b491ed606be_add_recruitment_coordinator_role.py).
    pass
