"""phase5_tracker_import_fields

Revision ID: 7160cc764eaa
Revises: ba2e30350b8a
Create Date: 2026-07-17 20:22:56.614789

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7160cc764eaa'
down_revision: Union[str, Sequence[str], None] = 'ba2e30350b8a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # external_ref lets the tracker-workbook importer (app/services/tracker_import.py)
    # re-run/upsert against the sheet's own Request ID / Candidate ID rather
    # than duplicating rows on every re-import. Candidate itself doesn't need
    # one -- it's already deduplicated by its unique email column.
    op.add_column("vacancy_requests", sa.Column("external_ref", sa.String(length=100), nullable=True))
    op.create_index("ix_vacancy_requests_external_ref", "vacancy_requests", ["external_ref"], unique=True)

    op.add_column("applications", sa.Column("external_ref", sa.String(length=100), nullable=True))
    op.create_index("ix_applications_external_ref", "applications", ["external_ref"], unique=True)

    # Genuinely missing from Stage A -- the spec's Candidate Pipeline sheet
    # has both Expected and Actual Joining Date; JoiningRecord.actual_joining_date
    # only exists once a real joining checklist has been initialized, which
    # the importer deliberately does not fabricate for historical rows.
    op.add_column("applications", sa.Column("actual_joining_date", sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("applications", "actual_joining_date")
    op.drop_index("ix_applications_external_ref", table_name="applications")
    op.drop_column("applications", "external_ref")
    op.drop_index("ix_vacancy_requests_external_ref", table_name="vacancy_requests")
    op.drop_column("vacancy_requests", "external_ref")
