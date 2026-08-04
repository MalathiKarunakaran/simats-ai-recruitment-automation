"""phase10_designation_master

Revision ID: 56d04b40220a
Revises: 0490bbdbc543
Create Date: 2026-08-03 00:00:00.000001

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '56d04b40220a'
down_revision: Union[str, Sequence[str], None] = '0490bbdbc543'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres requires ADD VALUE to run outside the block that then uses the
    # new value -- fine in a single migration here since nothing below writes
    # any ADJUNCT rows (unlike the f32d13801269/ba2e30350b8a split, which had
    # to be two migrations because the second one UPDATEd rows to the new
    # label in the same `alembic upgrade head` transaction).
    op.execute("ALTER TYPE employment_type_enum ADD VALUE IF NOT EXISTS 'ADJUNCT'")

    op.create_table(
        'designations',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column(
            'category',
            postgresql.ENUM(
                'TEACHING', 'NON_TEACHING', 'HOUSEKEEPING', name='staff_role_category_enum', create_type=False
            ),
            nullable=False,
        ),
        sa.Column('qualification', sa.Text(), nullable=False),
        sa.Column('min_experience', sa.String(length=100), nullable=False),
        sa.Column(
            'employment_type',
            postgresql.ENUM(
                'FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'ADJUNCT',
                name='employment_type_enum', create_type=False,
            ),
            nullable=False,
        ),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_designations')),
    )

    op.create_table(
        'designation_departments',
        sa.Column('designation_id', sa.UUID(), nullable=False),
        sa.Column('department_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(
            ['designation_id'],
            ['designations.id'],
            name=op.f('fk_designation_departments_designation_id_designations'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['department_id'],
            ['departments.id'],
            name=op.f('fk_designation_departments_department_id_departments'),
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('designation_id', 'department_id', name=op.f('pk_designation_departments')),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('designation_departments')
    op.drop_table('designations')
    # Postgres has no ALTER TYPE ... DROP VALUE -- the 'ADJUNCT' enum label
    # intentionally stays in place on downgrade (same class of limitation
    # documented in 023e1b89bbec_phase4_application_withdrawn_status.py).
