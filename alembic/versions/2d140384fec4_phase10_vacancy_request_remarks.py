"""phase10_vacancy_request_remarks

Revision ID: 2d140384fec4
Revises: 9ff41287af50
Create Date: 2026-08-03 21:29:58.881682

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2d140384fec4'
down_revision: Union[str, Sequence[str], None] = '9ff41287af50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("vacancy_requests", sa.Column("remarks", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("vacancy_requests", "remarks")
