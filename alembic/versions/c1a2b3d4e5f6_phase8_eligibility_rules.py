"""phase8_eligibility_rules

Revision ID: c1a2b3d4e5f6
Revises: 8bf468df9244
Create Date: 2026-07-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '8bf468df9244'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # staff_role_category_enum already exists (created in
    # 08d365f809c1_phase2_vacancy_pipeline_offers_joining.py for
    # vacancy_requests.role_category) -- reusing it here with
    # create_type=False so this migration doesn't try (and fail) to
    # CREATE TYPE a second time.
    op.create_table(
        'eligibility_rules',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('campus_id', sa.UUID(), nullable=False),
        sa.Column(
            'staff_category',
            postgresql.ENUM(
                'TEACHING', 'NON_TEACHING', 'HOUSEKEEPING', name='staff_role_category_enum', create_type=False
            ),
            nullable=False,
        ),
        sa.Column('position_title', sa.String(length=150), nullable=True),
        sa.Column('required_qualification_keyword', sa.String(length=100), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['campus_id'], ['campuses.id'], name=op.f('fk_eligibility_rules_campus_id_campuses'), ondelete='RESTRICT'
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_eligibility_rules')),
    )
    op.create_index(op.f('ix_eligibility_rules_campus_id'), 'eligibility_rules', ['campus_id'], unique=False)

    op.add_column(
        'applications',
        sa.Column('qualification_mismatch', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.add_column('applications', sa.Column('qualification_mismatch_reason', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('applications', 'qualification_mismatch_reason')
    op.drop_column('applications', 'qualification_mismatch')

    op.drop_index(op.f('ix_eligibility_rules_campus_id'), table_name='eligibility_rules')
    op.drop_table('eligibility_rules')

    # staff_role_category_enum is NOT dropped here -- it's shared with
    # vacancy_requests.role_category (created in
    # 08d365f809c1_phase2_vacancy_pipeline_offers_joining.py) and dropping it
    # would break that table, which still exists after this downgrade.
