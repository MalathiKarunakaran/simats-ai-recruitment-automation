"""phase12_vacancy_request_over_sanction_fields

Revision ID: c7d9e1f3a5b7
Revises: f4b8c9d1e2a3
Create Date: 2026-08-10 19:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d9e1f3a5b7'
down_revision: Union[str, Sequence[str], None] = 'f4b8c9d1e2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Additive/nullable-safe -- `is_over_sanction` defaults to false so every
    existing row is satisfied without a backfill; `over_sanction_justification`
    is nullable. Both are write-once by Phase E's submit()-time SUPER_ADMIN
    override (app/services/vacancy_workflow.py); unused/always-false by
    every ordinary request until then.
    """
    op.add_column(
        'vacancy_requests', sa.Column('is_over_sanction', sa.Boolean(), nullable=False, server_default='false')
    )
    op.add_column('vacancy_requests', sa.Column('over_sanction_justification', sa.Text(), nullable=True))
    # Drop the server_default now that every existing row is backfilled by it
    # -- the model itself only sets a Python-side default=False for new rows,
    # not a DB server_default, matching this repo's usual Boolean-column style.
    op.alter_column('vacancy_requests', 'is_over_sanction', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('vacancy_requests', 'over_sanction_justification')
    op.drop_column('vacancy_requests', 'is_over_sanction')
