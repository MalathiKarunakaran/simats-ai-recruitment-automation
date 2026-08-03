"""add_recruitment_coordinator_role

Revision ID: 0b491ed606be
Revises: a9b8c7d6e5f4
Create Date: 2026-08-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0b491ed606be'
down_revision: Union[str, Sequence[str], None] = 'a9b8c7d6e5f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres requires ADD VALUE to run outside the block that then uses the
    # new value -- fine here since this migration only adds the label and
    # doesn't write any RECRUITMENT_COORDINATOR rows itself.
    op.execute("ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'RECRUITMENT_COORDINATOR'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres has no ALTER TYPE ... DROP VALUE -- the 'RECRUITMENT_COORDINATOR'
    # enum label intentionally stays in place on downgrade (same class of
    # limitation documented in 023e1b89bbec_phase4_application_withdrawn_status.py).
    pass
