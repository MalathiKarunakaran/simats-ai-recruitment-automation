"""add_login_otps

Revision ID: 9e4d7b1a5c2f
Revises: 3c8f6a2e9d1b
Create Date: 2026-08-06 00:00:02.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9e4d7b1a5c2f'
down_revision: Union[str, Sequence[str], None] = '3c8f6a2e9d1b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'login_otps',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        # Not unique, unlike refresh_tokens.token_hash / password_reset_tokens.token_hash --
        # a 6-digit code has far less entropy than an opaque token, so a hash
        # collision across two different users' codes is expected, not a bug.
        # See app/models/auth_token.py::LoginOtp's docstring.
        sa.Column('code_hash', sa.String(length=128), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_login_otps_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_login_otps')),
    )
    op.create_index(op.f('ix_login_otps_user_id'), 'login_otps', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_login_otps_user_id'), table_name='login_otps')
    op.drop_table('login_otps')
