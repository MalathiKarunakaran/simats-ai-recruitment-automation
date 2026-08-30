"""bulk_upload_vacancy_request_entity_type

Adds 'VACANCY_REQUEST' to the existing `bulk_upload_entity_type_enum` so
vacancy-request bulk-upload batches (app/services/vacancy_request_import.py)
can be recorded on `BulkUploadLog.entity_type` / `BulkUploadRowLog.entity_type`
alongside SANCTIONED_STRENGTH / LOCATION / HOUSEKEEPING_STAFF / DEPARTMENT /
ELIGIBILITY_RULE / DESIGNATION.

Postgres requires ADD VALUE to run outside the block that then uses the new
value -- same precedent as f7c1a2b3d4e5 and
023e1b89bbec_phase4_application_withdrawn_status.py. Fine here: this migration
only adds the label and never writes a VACANCY_REQUEST row itself.

**This is not cleanly reversible.** Postgres has no ALTER TYPE ... DROP VALUE,
so the label stays after a downgrade -- the accepted limitation documented in
CLAUDE.md for every ADD VALUE on this already-live type.

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
"""

from alembic import op

revision = "c9d0e1f2a3b4"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE bulk_upload_entity_type_enum ADD VALUE IF NOT EXISTS 'VACANCY_REQUEST'")


def downgrade() -> None:
    # No ALTER TYPE ... DROP VALUE in Postgres. The label intentionally stays,
    # same accepted limitation as f7c1a2b3d4e5's own downgrade().
    pass
