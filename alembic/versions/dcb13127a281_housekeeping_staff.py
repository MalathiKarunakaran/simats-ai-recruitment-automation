"""housekeeping_staff

Revision ID: dcb13127a281
Revises: 68191fc833d8
Create Date: 2026-08-14 11:11:06.344499

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'dcb13127a281'
down_revision: Union[str, Sequence[str], None] = '68191fc833d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Green-field Housekeeping staff roster (glowing-zooming-hamming.md Phase
    D) -- a standalone table, not derived from/joined onto `employees` (Phase
    D's decision 3: Housekeeping staff have no `Application` trail to hang an
    `Employee` row off of). Purely additive, no backfill needed.
    `housekeeping_shift_enum` is a brand new native Postgres ENUM type
    created fresh in this same migration (unlike the `ADD VALUE` gotcha
    documented for *existing* enum types -- see
    023e1b89bbec_phase4_application_withdrawn_status.py -- a freshly-created
    type can still be cleanly dropped in `downgrade()` below).

    Autogenerate also picked up the same unrelated server_default/index-vs-
    unique-constraint drift on pre-existing tables (applications, candidates,
    designations, eligibility_rules, employees, locations,
    pipeline_stage_configs, sanctioned_strength, vacancy_requests) documented
    in 7396fbb43068_location_master.py / 68191fc833d8_sanctioned_strength_location_id.py
    -- deliberately excluded from this migration too, which stays scoped to
    the new `housekeeping_staff` table only.
    """
    op.create_table(
        'housekeeping_staff',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('campus_id', sa.UUID(), nullable=False),
        sa.Column('bio_id', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('designation_id', sa.UUID(), nullable=False),
        sa.Column('location_id', sa.UUID(), nullable=False),
        sa.Column('block', sa.String(length=150), nullable=True),
        sa.Column('floor_venue', sa.String(length=150), nullable=True),
        sa.Column(
            'shift',
            sa.Enum('MORNING', 'AFTERNOON', 'EVENING', 'NIGHT', name='housekeeping_shift_enum'),
            nullable=False,
        ),
        sa.Column('supervisor', sa.String(length=150), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by_id', sa.UUID(), nullable=False),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['campus_id'], ['campuses.id'], name=op.f('fk_housekeeping_staff_campus_id_campuses'), ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(
            ['created_by_id'], ['users.id'], name=op.f('fk_housekeeping_staff_created_by_id_users'), ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(
            ['designation_id'],
            ['designations.id'],
            name=op.f('fk_housekeeping_staff_designation_id_designations'),
            ondelete='RESTRICT',
        ),
        sa.ForeignKeyConstraint(
            ['location_id'], ['locations.id'], name=op.f('fk_housekeeping_staff_location_id_locations'), ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(
            ['updated_by_id'], ['users.id'], name=op.f('fk_housekeeping_staff_updated_by_id_users'), ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_housekeeping_staff')),
        sa.UniqueConstraint('campus_id', 'bio_id', name='uq_housekeeping_staff_campus_bio_id'),
    )
    op.create_index(op.f('ix_housekeeping_staff_campus_id'), 'housekeeping_staff', ['campus_id'], unique=False)
    op.create_index(op.f('ix_housekeeping_staff_designation_id'), 'housekeeping_staff', ['designation_id'], unique=False)
    op.create_index(op.f('ix_housekeeping_staff_location_id'), 'housekeeping_staff', ['location_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_housekeeping_staff_location_id'), table_name='housekeeping_staff')
    op.drop_index(op.f('ix_housekeeping_staff_designation_id'), table_name='housekeeping_staff')
    op.drop_index(op.f('ix_housekeeping_staff_campus_id'), table_name='housekeeping_staff')
    op.drop_table('housekeeping_staff')

    # housekeeping_shift_enum was created fresh in this same migration (not
    # shared with any other table) -- unlike staff_role_category_enum's
    # downgrade() in the sibling Location/Sanctioned-Strength migrations,
    # it's safe to drop here.
    op.execute('DROP TYPE housekeeping_shift_enum')
