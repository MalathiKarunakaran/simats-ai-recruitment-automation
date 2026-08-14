"""sanctioned_strength_location_id

Revision ID: 68191fc833d8
Revises: 7396fbb43068
Create Date: 2026-08-13 23:19:24.685076

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '68191fc833d8'
down_revision: Union[str, Sequence[str], None] = '7396fbb43068'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Phase C (glowing-zooming-hamming.md) -- wire `location_id` into
    Sanctioned Strength. Nullable, green-field: every pre-existing row gets
    NULL, no backfill needed. Indexed + FK-constrained the same shape as the
    table's other 3 FKs (campus_id/department_id/designation_id).

    Autogenerate also picked up several unrelated server_default/index-vs-
    unique-constraint drift on pre-existing tables (applications, candidates,
    designations, eligibility_rules, employees, locations,
    pipeline_stage_configs, vacancy_requests) that predates this change --
    deliberately excluded from this migration, same call as
    7396fbb43068_location_master.py, which stays scoped to the new
    `sanctioned_strength.location_id` column only.
    """
    op.add_column('sanctioned_strength', sa.Column('location_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_sanctioned_strength_location_id'), 'sanctioned_strength', ['location_id'], unique=False)
    op.create_foreign_key(
        op.f('fk_sanctioned_strength_location_id_locations'),
        'sanctioned_strength',
        'locations',
        ['location_id'],
        ['id'],
        ondelete='RESTRICT',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f('fk_sanctioned_strength_location_id_locations'), 'sanctioned_strength', type_='foreignkey')
    op.drop_index(op.f('ix_sanctioned_strength_location_id'), table_name='sanctioned_strength')
    op.drop_column('sanctioned_strength', 'location_id')
