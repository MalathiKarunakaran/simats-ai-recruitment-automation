"""phase_j_bulk_upload_entity_type_and_row_log

Revision ID: 5029a5d385c8
Revises: dcb13127a281
Create Date: 2026-08-16 21:34:20.931946

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5029a5d385c8'
down_revision: Union[str, Sequence[str], None] = 'dcb13127a281'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Phase J (glowing-zooming-hamming.md) -- extends the existing bulk-upload
    machinery to Location/HousekeepingStaff imports rather than adding new
    near-duplicate log tables:

    1. `bulk_upload_log.entity_type` -- a brand-new native enum type
       (`bulk_upload_entity_type_enum`, 3 values) on a brand-new column,
       NOT NULL with `server_default='SANCTIONED_STRENGTH'` so every
       pre-Phase-J row backfills to the only entity type that existed before
       this phase, with zero manual data migration -- same "green-field
       additive column" shape as
       68191fc833d8_sanctioned_strength_location_id.py. Unlike the
       `application_status_enum`/`WITHDRAWN` precedent
       (023e1b89bbec_phase4_application_withdrawn_status.py), this enum type
       is created fresh in this same migration (not an ADD VALUE onto a
       pre-existing type), so it can be cleanly DROPped in downgrade() below
       -- no "Postgres can't drop an enum label" limitation applies here.

    2. `bulk_upload_row_log` -- a new small table recording, once per
       non-rejected row committed by a Location/HousekeepingStaff bulk
       upload, whether that row was created or updated by this batch (see
       app/models/bulk_upload_row_log.py's own docstring for why this can't
       be reconstructed after the fact the way Sanctioned Strength's own
       undo does via SanctionedStrengthHistory). Sanctioned Strength imports
       never write to this table -- it stays empty for them.

    Autogenerate also picked up unrelated pre-existing server_default/index-
    vs-unique-constraint drift on other tables (applications, candidates,
    designations, eligibility_rules, employees, housekeeping_staff,
    locations, pipeline_stage_configs, sanctioned_strength,
    vacancy_requests) that predates this change -- deliberately excluded
    from this migration, same call as every prior migration in this epic
    that hit the same pre-existing drift (see e.g.
    68191fc833d8_sanctioned_strength_location_id.py's own docstring).
    """
    op.create_table(
        'bulk_upload_row_log',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('bulk_upload_log_id', sa.UUID(), nullable=False),
        sa.Column(
            'entity_type',
            sa.Enum('SANCTIONED_STRENGTH', 'LOCATION', 'HOUSEKEEPING_STAFF', name='bulk_upload_entity_type_enum'),
            nullable=False,
        ),
        sa.Column('entity_id', sa.UUID(), nullable=False),
        sa.Column('was_created', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['bulk_upload_log_id'], ['bulk_upload_log.id'],
            name=op.f('fk_bulk_upload_row_log_bulk_upload_log_id_bulk_upload_log'), ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_bulk_upload_row_log')),
    )
    op.create_index(
        op.f('ix_bulk_upload_row_log_bulk_upload_log_id'), 'bulk_upload_row_log', ['bulk_upload_log_id'], unique=False
    )
    op.create_index(op.f('ix_bulk_upload_row_log_entity_id'), 'bulk_upload_row_log', ['entity_id'], unique=False)

    op.add_column(
        'bulk_upload_log',
        sa.Column(
            'entity_type',
            sa.Enum('SANCTIONED_STRENGTH', 'LOCATION', 'HOUSEKEEPING_STAFF', name='bulk_upload_entity_type_enum'),
            server_default='SANCTIONED_STRENGTH',
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('bulk_upload_log', 'entity_type')

    op.drop_index(op.f('ix_bulk_upload_row_log_entity_id'), table_name='bulk_upload_row_log')
    op.drop_index(op.f('ix_bulk_upload_row_log_bulk_upload_log_id'), table_name='bulk_upload_row_log')
    op.drop_table('bulk_upload_row_log')

    # bulk_upload_entity_type_enum was created fresh by this migration (only
    # ever used by the column/table just dropped), so it's safe to DROP TYPE
    # here -- unlike application_status_enum's ADD VALUE 'WITHDRAWN', this
    # isn't a label added onto a pre-existing type. Same "DROP TABLE doesn't
    # drop the enum type" gap documented in
    # 08d365f809c1_phase2_vacancy_pipeline_offers_joining.py's downgrade().
    bind = op.get_bind()
    sa.Enum(name='bulk_upload_entity_type_enum').drop(bind, checkfirst=True)
