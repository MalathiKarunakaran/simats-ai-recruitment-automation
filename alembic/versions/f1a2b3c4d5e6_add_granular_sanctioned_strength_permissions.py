"""add_granular_sanctioned_strength_permissions

Adds the six granular Sanctioned Strength labels to `permission_enum`:
VIEW / CREATE / EDIT / BULK_UPLOAD / VIEW_..._UPLOAD_HISTORY / DELETE.

They replace the single MANAGE_SANCTIONED_STRENGTH added earlier the same day
(`d0e1f2a3b4c5`). One all-or-nothing permission could not express "may edit an
existing row but may not create, bulk upload or delete it", which is exactly
the split a Recruitment Coordinator needs.

Postgres requires ADD VALUE to run outside the block that then USES the new
value, so the mapping/backfill is the FOLLOWING migration (`a2b3c4d5e6f7`) --
same split as c9d0e1f2a3b4 / d0e1f2a3b4c5 before it. This migration only adds
labels.

**Not cleanly reversible** -- Postgres has no ALTER TYPE ... DROP VALUE.

Revision ID: f1a2b3c4d5e6
Revises: e1a2b3c4d5e6
"""

from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "e1a2b3c4d5e6"
branch_labels = None
depends_on = None

_NEW_LABELS = (
    "VIEW_SANCTIONED_STRENGTH",
    "CREATE_SANCTIONED_STRENGTH",
    "EDIT_SANCTIONED_STRENGTH",
    "BULK_UPLOAD_SANCTIONED_STRENGTH",
    "VIEW_SANCTIONED_STRENGTH_UPLOAD_HISTORY",
    "DELETE_SANCTIONED_STRENGTH",
)


def upgrade() -> None:
    for label in _NEW_LABELS:
        op.execute(f"ALTER TYPE permission_enum ADD VALUE IF NOT EXISTS '{label}'")


def downgrade() -> None:
    # No ALTER TYPE ... DROP VALUE in Postgres. Labels intentionally stay.
    pass
