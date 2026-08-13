"""location_master

Revision ID: 7396fbb43068
Revises: c7d9e1f3a5b7
Create Date: 2026-08-13 22:12:28.841184

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '7396fbb43068'
down_revision: Union[str, Sequence[str], None] = 'c7d9e1f3a5b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _staff_role_category_enum() -> postgresql.ENUM:
    # staff_role_category_enum already exists (08d365f809c1_phase2_...) --
    # create_type=False so this migration doesn't try (and fail) to CREATE
    # TYPE a second time. Same reuse pattern as
    # aa05adcc1a38_phase12_sanctioned_strength_bulk_upload_tables.py.
    return postgresql.ENUM(
        'TEACHING', 'NON_TEACHING', 'HOUSEKEEPING', name='staff_role_category_enum', create_type=False
    )


def upgrade() -> None:
    """Upgrade schema.

    Green-field Location Master (glowing-zooming-hamming.md Phase B) --
    purely additive, no backfill needed. `category` is nullable (unlike
    Department's own NOT NULL category) -- a Location/building can serve
    multiple staff categories.

    Autogenerate also picked up several unrelated server_default/index-vs-
    unique-constraint drift on pre-existing tables (applications, candidates,
    designations, eligibility_rules, employees, pipeline_stage_configs,
    sanctioned_strength, vacancy_requests) that predates this change --
    deliberately excluded from this migration, which stays scoped to the
    new `locations` table only.
    """
    op.create_table(
        'locations',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('campus_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('block_building', sa.String(length=150), nullable=True),
        sa.Column('floor_venue', sa.String(length=150), nullable=True),
        sa.Column('category', _staff_role_category_enum(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['campus_id'], ['campuses.id'], name=op.f('fk_locations_campus_id_campuses'), ondelete='RESTRICT'
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_locations')),
    )
    op.create_index(op.f('ix_locations_campus_id'), 'locations', ['campus_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_locations_campus_id'), table_name='locations')
    op.drop_table('locations')

    # staff_role_category_enum is NOT dropped -- shared with other tables
    # (departments, designations, sanctioned_strength) that still exist
    # after this downgrade.
