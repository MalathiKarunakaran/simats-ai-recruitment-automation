"""user_deactivation_protected_flag

Revision ID: e5f6a7b8c9d0
Revises: b1c2d3e4f5a6
Create Date: 2026-08-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Adds a data-driven "protected from deactivation" flag to users -- a
    plain boolean, not a new enum, same "single independent on/off
    condition" shape as must_change_password in
    b1c2d3e4f5a6_admin_password_reset_must_change_flag.py. Enforcement of
    the flag (blocking PATCH /users/{user_id} from setting is_active=False
    on a protected account) lives in app/api/v1/routers/users.py, not here --
    this migration only adds the column and defaults every existing row
    (including the two real accounts this was built for) to False so it
    backfills without breaking NOT NULL; the two accounts get flipped to
    True by a one-off data script, not by this migration.
    """
    op.add_column(
        'users',
        sa.Column('deactivation_protected', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'deactivation_protected')
