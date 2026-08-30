"""Add sanctioned_strength.working_override

Manually-entered headcount that overrides the live Employee/HousekeepingStaff
count. This deployment runs standalone with no HR feed -- production holds
zero employee rows -- so the derived `working` was 0 on every row, which made
Vacancy equal Approved everywhere and Filled % always 0.

Nullable with no server default and no backfill on purpose: NULL means "no
override, use the live count", so every pre-existing row keeps exactly the
behaviour it had before this migration. Down-revision drops the column, which
loses any manually-entered figures -- they exist nowhere else.

Revision ID: a1b2c3d4e5f6
Revises: e1f2a3b4c5d6
"""

import sqlalchemy as sa
from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sanctioned_strength", sa.Column("working_override", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("sanctioned_strength", "working_override")
