"""phase11_retag_housekeeping_designations

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f7
Create Date: 2026-08-10 00:00:02.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Name-match based (not conditioned on which of these currently exist) so
# this stays forward-compatible: only "Security Guard" exists in the live
# dev DB today, the other four don't yet, but a future Designation Master
# row with one of these exact names and category NON_TEACHING should be
# retagged the same way without a further migration.
_HOUSEKEEPING_NAMES = ("Security Guard", "Housekeeping Staff", "Gardener", "Driver", "Watchman")


def upgrade() -> None:
    """Upgrade schema."""
    names = ", ".join(f"'{name}'" for name in _HOUSEKEEPING_NAMES)
    op.execute(
        f"""
        UPDATE designations
        SET category = 'HOUSEKEEPING'
        WHERE name IN ({names})
          AND category = 'NON_TEACHING'
        """
    )


def downgrade() -> None:
    """Downgrade schema.

    Losslessly reversible -- every row this migration touches was
    NON_TEACHING before it ran (the WHERE clause above only ever matches
    NON_TEACHING rows), so reverting HOUSEKEEPING rows with these exact
    names back to NON_TEACHING is a true round-trip, unlike the other
    Phase 1 migrations in this batch.
    """
    names = ", ".join(f"'{name}'" for name in _HOUSEKEEPING_NAMES)
    op.execute(
        f"""
        UPDATE designations
        SET category = 'NON_TEACHING'
        WHERE name IN ({names})
          AND category = 'HOUSEKEEPING'
        """
    )
