"""application statuses HOD_REVIEW_COMPLETE and PERMANENT_ORDER_ISSUED

Revision ID: 6b2d4f8a0c13
Revises: 5a1c3e7b9d42
Create Date: 2026-10-31

docs/specs/hod-review-and-permanent-order.md, H3: two new application
statuses after HANDED_OVER_TO_HOD. Their own revision so the labels are
committed before anything uses them. Nothing existing is rewritten:
applications already at HANDED_OVER_TO_HOD keep that status and simply have
two more steps open to them.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "6b2d4f8a0c13"
down_revision: Union[str, Sequence[str], None] = "5a1c3e7b9d42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE application_status_enum ADD VALUE IF NOT EXISTS 'HOD_REVIEW_COMPLETE' "
        "AFTER 'HANDED_OVER_TO_HOD'"
    )
    op.execute(
        "ALTER TYPE application_status_enum ADD VALUE IF NOT EXISTS 'PERMANENT_ORDER_ISSUED' "
        "AFTER 'HOD_REVIEW_COMPLETE'"
    )


def downgrade() -> None:
    # Postgres has no ALTER TYPE ... DROP VALUE: both labels stay in
    # application_status_enum after a downgrade. Any row still holding one
    # must be moved off it by hand before downgrading further.
    pass
