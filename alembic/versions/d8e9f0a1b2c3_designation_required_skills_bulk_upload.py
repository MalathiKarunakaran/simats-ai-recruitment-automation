"""designation_required_skills_bulk_upload

Revision ID: d8e9f0a1b2c3
Revises: a3c8f1e9d2b4
Create Date: 2026-08-26 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'a3c8f1e9d2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Designation Master bulk-upload epic (backend Phase 1):

    1. Adds `designations.required_skills` (nullable Text) -- a genuinely
       missing field the bulk-upload template spec calls for ("Required
       Skills" column) that has no existing home on `Designation` today.
       Plain `ADD COLUMN`, no enum involved, no special gotcha.
    2. Adds 'DESIGNATION' to the already-live `bulk_upload_entity_type_enum`
       type (created by 5029a5d385c8_phase_j_bulk_upload_entity_type_and_row_.py,
       already extended with DEPARTMENT/ELIGIBILITY_RULE by
       f7c1a2b3d4e5_.../a3c8f1e9d2b4_...) so Designation bulk-upload batches
       (app/services/designation_import.py) can be recorded on
       `BulkUploadLog.entity_type`/`BulkUploadRowLog.entity_type` alongside
       the existing entity types.

    Combining an `ADD VALUE` with a plain `ADD COLUMN` in one migration is
    safe here -- same precedent as a3c8f1e9d2b4_starter_regulatory_eligibility_rules.py
    (which combined its own `ADD VALUE 'ELIGIBILITY_RULE'` with 19 new
    `eligibility_rules` columns) -- because nothing in this same migration
    writes a row using the new 'DESIGNATION' label.
    """
    op.execute("ALTER TYPE bulk_upload_entity_type_enum ADD VALUE IF NOT EXISTS 'DESIGNATION'")

    op.add_column('designations', sa.Column('required_skills', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('designations', 'required_skills')

    # Postgres has no ALTER TYPE ... DROP VALUE -- the 'DESIGNATION' enum
    # label intentionally stays in place on downgrade, same accepted
    # limitation as f7c1a2b3d4e5_bulk_upload_department_entity_type.py's own
    # downgrade().
