"""phase10_vacancy_request_designation_fk

Revision ID: 9ff41287af50
Revises: 56d04b40220a
Create Date: 2026-08-03 00:00:00.000002

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '9ff41287af50'
down_revision: Union[str, Sequence[str], None] = '56d04b40220a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable, purely additive -- 76 real pre-existing vacancy_requests rows
    # have no designation_id and keep working unchanged via position_title.
    op.add_column(
        'vacancy_requests', sa.Column('designation_id', postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        op.f('fk_vacancy_requests_designation_id_designations'),
        'vacancy_requests',
        'designations',
        ['designation_id'],
        ['id'],
        ondelete='RESTRICT',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f('fk_vacancy_requests_designation_id_designations'), 'vacancy_requests', type_='foreignkey'
    )
    op.drop_column('vacancy_requests', 'designation_id')
