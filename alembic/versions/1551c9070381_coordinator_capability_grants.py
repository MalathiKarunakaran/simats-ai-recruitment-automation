"""coordinator_capability_grants

Revision ID: 1551c9070381
Revises: 2d140384fec4
Create Date: 2026-08-03 22:41:44.199945

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '1551c9070381'
down_revision: Union[str, Sequence[str], None] = '2d140384fec4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # coordinator_capability_enum is created fresh here (for this table's
    # only column that uses it), so -- unlike the ADD VALUE gotcha on
    # existing enums documented elsewhere in this repo -- it can be cleanly
    # dropped again in downgrade().
    op.create_table(
        'coordinator_capability_grants',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column(
            'capability',
            postgresql.ENUM(
                'VACANCY_APPROVAL',
                'CANDIDATES_APPLICATIONS',
                'INTERVIEWS',
                'JOB_DISTRIBUTION_SCREENING',
                name='coordinator_capability_enum',
            ),
            nullable=False,
        ),
        sa.Column('granted_by_id', sa.UUID(), nullable=True),
        sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'], name=op.f('fk_coordinator_capability_grants_user_id_users'), ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['granted_by_id'],
            ['users.id'],
            name=op.f('fk_coordinator_capability_grants_granted_by_id_users'),
            ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_coordinator_capability_grants')),
        sa.UniqueConstraint(
            'user_id', 'capability', name=op.f('uq_coordinator_capability_grants_user_id')
        ),
    )
    op.create_index(
        op.f('ix_coordinator_capability_grants_user_id'), 'coordinator_capability_grants', ['user_id'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_coordinator_capability_grants_user_id'), table_name='coordinator_capability_grants')
    op.drop_table('coordinator_capability_grants')
    postgresql.ENUM(name='coordinator_capability_enum').drop(op.get_bind(), checkfirst=True)
