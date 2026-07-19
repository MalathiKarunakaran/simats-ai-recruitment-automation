"""phase9_vacancy_cancel_and_slot_adjust

Revision ID: a9b8c7d6e5f4
Revises: c1a2b3d4e5f6
Create Date: 2026-07-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9b8c7d6e5f4'
down_revision: Union[str, Sequence[str], None] = 'c1a2b3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres requires ADD VALUE to run outside the block that then uses the
    # new value -- fine here since this migration only adds the label and
    # doesn't write any CANCELLED rows itself.
    op.execute("ALTER TYPE vacancy_request_status_enum ADD VALUE IF NOT EXISTS 'CANCELLED'")

    op.add_column('vacancy_requests', sa.Column('cancelled_by_id', sa.UUID(), nullable=True))
    op.add_column('vacancy_requests', sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('vacancy_requests', sa.Column('cancellation_reason', sa.Text(), nullable=True))
    op.create_foreign_key(
        op.f('fk_vacancy_requests_cancelled_by_id_users'),
        'vacancy_requests',
        'users',
        ['cancelled_by_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f('fk_vacancy_requests_cancelled_by_id_users'), 'vacancy_requests', type_='foreignkey'
    )
    op.drop_column('vacancy_requests', 'cancellation_reason')
    op.drop_column('vacancy_requests', 'cancelled_at')
    op.drop_column('vacancy_requests', 'cancelled_by_id')
    # Postgres has no ALTER TYPE ... DROP VALUE -- the 'CANCELLED' enum label
    # intentionally stays in place on downgrade (same class of limitation
    # documented in 023e1b89bbec_phase4_application_withdrawn_status.py).
