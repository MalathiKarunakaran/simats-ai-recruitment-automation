"""phase5_pipeline_stage_configs

Revision ID: d1e2f3a4b5c6
Revises: c5d6e7f8a9b0
Create Date: 2026-08-10 00:00:04.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _role_category_enum() -> postgresql.ENUM:
    # staff_role_category_enum already exists (08d365f809c1_phase2_...) and
    # already has all three values needed here -- create_type=False so this
    # migration doesn't try (and fail) to CREATE TYPE a second time.
    return postgresql.ENUM(
        'TEACHING', 'NON_TEACHING', 'HOUSEKEEPING', name='staff_role_category_enum', create_type=False
    )


def _application_status_enum() -> postgresql.ENUM:
    # application_status_enum already exists (08d365f809c1_phase2_...,
    # extended with WITHDRAWN in 023e1b89bbec_phase4_...) -- reused here
    # create_type=False, no new labels needed for this migration.
    return postgresql.ENUM(
        'APPLIED', 'SCREENING', 'CALLED_FOR_INTERVIEW', 'INTERVIEWED', 'SELECTED', 'OFFER_SENT',
        'OFFER_ACCEPTED', 'JOINING_CONFIRMED', 'JOINED', 'DEPARTMENT_ROOM_ALLOTTED', 'ORIENTATION_COMPLETE',
        'HANDED_OVER_TO_HOD', 'REJECTED', 'WITHDRAWN',
        # Old pre-rename labels physically still on the Postgres type (see
        # app/models/enums.py::ApplicationStatusEnum docstring) -- included
        # here only so this ENUM() definition matches the real type; never
        # written by this migration.
        'ELIGIBLE', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'TECHNICAL_INTERVIEW', 'HR_INTERVIEW',
        'JOINING_PENDING', 'ONBOARDING_COMPLETE', 'EMPLOYEE_CREATED',
        name='application_status_enum', create_type=False,
    )


def _interview_type_enum() -> postgresql.ENUM:
    # interview_type_enum already exists (7a4915280966_phase3_...) --
    # create_type=False, no new labels needed.
    return postgresql.ENUM('TECHNICAL', 'HR', 'TEACHING_DEMO', 'GENERAL', name='interview_type_enum', create_type=False)


def _pipeline_stage_configs_table() -> sa.Table:
    # Built with the real enum types (not sa.String()) so op.bulk_insert
    # sends properly-typed values -- Postgres does not implicitly cast
    # varchar to a native enum type for INSERT ... VALUES.
    return sa.table(
        "pipeline_stage_configs",
        sa.column("id", sa.UUID()),
        sa.column("role_category", _role_category_enum()),
        sa.column("sequence_position", sa.Integer()),
        sa.column("display_label", sa.String()),
        sa.column("maps_to_status", _application_status_enum()),
        sa.column("maps_to_interview_type", _interview_type_enum()),
        sa.column("is_active", sa.Boolean()),
    )

# The three seeded sequences from the original request. Display-config only
# -- see app/models/pipeline_stage_config.py docstring; none of this changes
# app/services/pipeline.py or the real ApplicationStatusEnum state machine.
SEED_ROWS = [
    # Teaching
    {"role_category": "TEACHING", "sequence_position": 1, "display_label": "Applied",
     "maps_to_status": "APPLIED", "maps_to_interview_type": None},
    {"role_category": "TEACHING", "sequence_position": 2, "display_label": "Screening",
     "maps_to_status": "SCREENING", "maps_to_interview_type": None},
    {"role_category": "TEACHING", "sequence_position": 3, "display_label": "Demo class",
     "maps_to_status": "INTERVIEWED", "maps_to_interview_type": "TEACHING_DEMO"},
    {"role_category": "TEACHING", "sequence_position": 4, "display_label": "Interview",
     "maps_to_status": "CALLED_FOR_INTERVIEW", "maps_to_interview_type": None},
    {"role_category": "TEACHING", "sequence_position": 5, "display_label": "Offer",
     "maps_to_status": "OFFER_SENT", "maps_to_interview_type": None},
    {"role_category": "TEACHING", "sequence_position": 6, "display_label": "Joined",
     "maps_to_status": "JOINED", "maps_to_interview_type": None},
    # Non-Teaching
    {"role_category": "NON_TEACHING", "sequence_position": 1, "display_label": "Applied",
     "maps_to_status": "APPLIED", "maps_to_interview_type": None},
    {"role_category": "NON_TEACHING", "sequence_position": 2, "display_label": "Screening",
     "maps_to_status": "SCREENING", "maps_to_interview_type": None},
    {"role_category": "NON_TEACHING", "sequence_position": 3, "display_label": "Written test",
     "maps_to_status": "CALLED_FOR_INTERVIEW", "maps_to_interview_type": "TECHNICAL"},
    {"role_category": "NON_TEACHING", "sequence_position": 4, "display_label": "Interview",
     "maps_to_status": "INTERVIEWED", "maps_to_interview_type": None},
    {"role_category": "NON_TEACHING", "sequence_position": 5, "display_label": "Offer",
     "maps_to_status": "OFFER_SENT", "maps_to_interview_type": None},
    {"role_category": "NON_TEACHING", "sequence_position": 6, "display_label": "Joined",
     "maps_to_status": "JOINED", "maps_to_interview_type": None},
    # Housekeeping
    {"role_category": "HOUSEKEEPING", "sequence_position": 1, "display_label": "Walk-in",
     "maps_to_status": "APPLIED", "maps_to_interview_type": None},
    {"role_category": "HOUSEKEEPING", "sequence_position": 2, "display_label": "Verification",
     "maps_to_status": "SCREENING", "maps_to_interview_type": None},
    {"role_category": "HOUSEKEEPING", "sequence_position": 3, "display_label": "Offer",
     "maps_to_status": "OFFER_SENT", "maps_to_interview_type": None},
    {"role_category": "HOUSEKEEPING", "sequence_position": 4, "display_label": "Joined",
     "maps_to_status": "JOINED", "maps_to_interview_type": None},
]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'pipeline_stage_configs',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('role_category', _role_category_enum(), nullable=False),
        sa.Column('sequence_position', sa.Integer(), nullable=False),
        sa.Column('display_label', sa.String(length=100), nullable=False),
        sa.Column('maps_to_status', _application_status_enum(), nullable=False),
        sa.Column('maps_to_interview_type', _interview_type_enum(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_pipeline_stage_configs')),
        sa.UniqueConstraint(
            'role_category', 'sequence_position', name='uq_pipeline_stage_config_category_position'
        ),
    )
    op.create_index(
        op.f('ix_pipeline_stage_configs_role_category'), 'pipeline_stage_configs', ['role_category'], unique=False
    )

    op.bulk_insert(_pipeline_stage_configs_table(), SEED_ROWS)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_pipeline_stage_configs_role_category'), table_name='pipeline_stage_configs')
    op.drop_table('pipeline_stage_configs')

    # staff_role_category_enum / application_status_enum / interview_type_enum
    # are NOT dropped here -- all three are shared with other tables that
    # still exist after this downgrade.
