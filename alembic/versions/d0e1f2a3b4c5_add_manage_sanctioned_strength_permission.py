"""add_manage_sanctioned_strength_permission

Adds 'MANAGE_SANCTIONED_STRENGTH' to the existing `permission_enum`.

Sanctioned Strength was the last master-data module still gated by a bare
role tuple (SANCTIONED_STRENGTH_WRITE_ROLES = SUPER_ADMIN + HR_ADMIN) instead
of the permission matrix every other module moved to, so an individual user
could not be granted it at all -- a RECRUITMENT_COORDINATOR could not be given
the screen no matter what was ticked on the user's permission matrix.

Postgres requires ADD VALUE to run outside the block that then uses the new
value, so the grant backfill lives in the FOLLOWING migration
(`e1a2b3c4d5e6`) rather than here -- same split as f7c1a2b3d4e5,
023e1b89bbec and c9d0e1f2a3b4. This migration only adds the label.

**Not cleanly reversible.** Postgres has no ALTER TYPE ... DROP VALUE, so the
label stays after a downgrade -- the accepted limitation documented in
CLAUDE.md for every ADD VALUE on an already-live type.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
"""

from alembic import op

revision = "d0e1f2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE permission_enum ADD VALUE IF NOT EXISTS 'MANAGE_SANCTIONED_STRENGTH'")


def downgrade() -> None:
    # No ALTER TYPE ... DROP VALUE in Postgres. The label intentionally stays,
    # same accepted limitation as c9d0e1f2a3b4's own downgrade().
    pass
