"""phase4_application_withdrawn_status

Revision ID: 023e1b89bbec
Revises: 7a4915280966
Create Date: 2026-07-16 22:22:46.263852

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '023e1b89bbec'
down_revision: Union[str, Sequence[str], None] = '7a4915280966'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres requires ADD VALUE to run outside the block that then uses the
    # new value -- fine here since this migration only adds the label and
    # doesn't write any WITHDRAWN rows itself.
    op.execute("ALTER TYPE application_status_enum ADD VALUE IF NOT EXISTS 'WITHDRAWN'")
    op.add_column('applications', sa.Column('withdrawn_reason', sa.Text(), nullable=True))
    op.add_column('applications', sa.Column('withdrawn_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('applications', 'withdrawn_at')
    op.drop_column('applications', 'withdrawn_reason')
    # Postgres has no ALTER TYPE ... DROP VALUE -- the 'WITHDRAWN' enum label
    # intentionally stays in place on downgrade (same class of limitation
    # documented for the other enum-drop calls in earlier migrations, but
    # those apply to enums created fresh on a column; this one only ever
    # grows an existing native type, so there's no clean reverse operation).
