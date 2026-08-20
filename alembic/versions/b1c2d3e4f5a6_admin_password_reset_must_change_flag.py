"""admin_password_reset_must_change_flag

Revision ID: b1c2d3e4f5a6
Revises: 5029a5d385c8
Create Date: 2026-08-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = '5029a5d385c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    SUPER_ADMIN-initiated password reset (app/api/v1/routers/users.py's
    POST /users/{user_id}/reset-password): adds a plain boolean flag, not a
    new enum, since this is a single independent on/off condition orthogonal
    to is_active/is_email_verified -- server_default so existing rows
    backfill to False without breaking NOT NULL, same "green-field additive
    column" shape as is_withdrawn in 8bf468df9244_phase5_candidate_withdraw.py.
    """
    op.add_column(
        'users',
        sa.Column('must_change_password', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'must_change_password')
