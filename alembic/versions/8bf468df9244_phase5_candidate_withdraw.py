"""phase5_candidate_withdraw

Revision ID: 8bf468df9244
Revises: 68a1e765ff50
Create Date: 2026-07-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8bf468df9244'
down_revision: Union[str, Sequence[str], None] = '68a1e765ff50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default so existing rows get False without breaking NOT NULL;
    # same pattern as employment_status in 68a1e765ff50.
    op.add_column(
        "candidates",
        sa.Column("is_withdrawn", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("candidates", sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("candidates", sa.Column("withdrawn_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("candidates", "withdrawn_reason")
    op.drop_column("candidates", "withdrawn_at")
    op.drop_column("candidates", "is_withdrawn")
