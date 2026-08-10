"""phase5_eligibility_rule_category_fields

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-08-10 00:00:05.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Category-specific optional columns on eligibility_rules -- all nullable,
    nothing previously required changes shape. required_qualification_keyword
    stays as-is (still used by the existing TEACHING PhD-keyword check); see
    app/services/eligibility.py::check_qualification_mismatch.
    """
    op.add_column('eligibility_rules', sa.Column('net_set_required', sa.Boolean(), nullable=True))
    op.add_column('eligibility_rules', sa.Column('subject', sa.String(length=150), nullable=True))
    op.add_column('eligibility_rules', sa.Column('skills_keyword', sa.String(length=100), nullable=True))
    op.add_column('eligibility_rules', sa.Column('id_proof_required', sa.Boolean(), nullable=True))
    op.add_column('eligibility_rules', sa.Column('shift_preference', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('eligibility_rules', 'shift_preference')
    op.drop_column('eligibility_rules', 'id_proof_required')
    op.drop_column('eligibility_rules', 'skills_keyword')
    op.drop_column('eligibility_rules', 'subject')
    op.drop_column('eligibility_rules', 'net_set_required')
