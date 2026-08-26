"""bulk_upload_department_entity_type

Revision ID: f7c1a2b3d4e5
Revises: ebafe3ba100c
Create Date: 2026-08-25 23:05:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f7c1a2b3d4e5'
down_revision: Union[str, Sequence[str], None] = 'ebafe3ba100c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Adds 'DEPARTMENT' to the existing `bulk_upload_entity_type_enum` type
    (created by 5029a5d385c8_phase_j_bulk_upload_entity_type_and_row_.py) so
    Department bulk-upload batches (app/services/department_import.py) can
    be recorded on `BulkUploadLog.entity_type` and `BulkUploadRowLog.
    entity_type` alongside SANCTIONED_STRENGTH/LOCATION/HOUSEKEEPING_STAFF.

    Postgres requires ADD VALUE to run outside the block that then uses the
    new value -- same precedent as
    023e1b89bbec_phase4_application_withdrawn_status.py. Fine here since
    this migration only adds the label and never writes a DEPARTMENT row
    itself.
    """
    op.execute("ALTER TYPE bulk_upload_entity_type_enum ADD VALUE IF NOT EXISTS 'DEPARTMENT'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres has no ALTER TYPE ... DROP VALUE -- the 'DEPARTMENT' enum
    # label intentionally stays in place on downgrade, same accepted
    # limitation as 023e1b89bbec_phase4_application_withdrawn_status.py's
    # own downgrade() (this migration only ever grows a pre-existing native
    # type, so there is no clean reverse operation).
    pass
