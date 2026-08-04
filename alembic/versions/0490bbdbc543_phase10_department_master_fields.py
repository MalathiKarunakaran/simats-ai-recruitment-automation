"""phase10_department_master_fields

Revision ID: 0490bbdbc543
Revises: 0b491ed606be
Create Date: 2026-08-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0490bbdbc543'
down_revision: Union[str, Sequence[str], None] = '0b491ed606be'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # All three columns are nullable additive columns -- 50+ pre-existing
    # Department rows have none of these set and there's no backfill
    # requirement. `category` reuses the existing staff_role_category_enum
    # type (create_type=False; it already exists from Phase 2/8), so no
    # ALTER TYPE ADD VALUE gotcha applies here.
    op.add_column('departments', sa.Column('code', sa.String(length=20), nullable=True))
    op.add_column(
        'departments',
        sa.Column(
            'category',
            postgresql.ENUM(
                'TEACHING', 'NON_TEACHING', 'HOUSEKEEPING', name='staff_role_category_enum', create_type=False
            ),
            nullable=True,
        ),
    )
    op.add_column('departments', sa.Column('parent_group', sa.String(length=100), nullable=True))
    op.create_index(op.f('ix_departments_code'), 'departments', ['code'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_departments_code'), table_name='departments')
    op.drop_column('departments', 'parent_group')
    op.drop_column('departments', 'category')
    op.drop_column('departments', 'code')
