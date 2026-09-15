"""Add the job posting review statuses and their two permission labels.

job_posting_status_enum gains DRAFT, READY_FOR_REVIEW and APPROVED (a
posting is now created as a draft and reviewed before it goes live);
permission_enum gains APPROVE_JOB_POSTING and PUBLISH_JOB_POSTING.

Labels only. Postgres requires ADD VALUE to be committed before any
statement uses the new value, so the columns, backfill and grants live in
the FOLLOWING revision (`e8f9a0b1c2d3`) -- the same split as
f0a1b2c3d4e5 / c4d5e6f7a8b9. alembic/env.py runs each revision in its own
transaction (transaction_per_migration=True), so one `alembic upgrade head`
applies both safely.

**Not cleanly reversible** -- Postgres has no ALTER TYPE ... DROP VALUE.

Revision ID: b8c7d6e5f4a3
Revises: b2c3d4e5f6a7
Create Date: 2026-09-15
"""

from alembic import op

revision = "b8c7d6e5f4a3"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None

_POSTING_STATUSES = ("DRAFT", "READY_FOR_REVIEW", "APPROVED")
_PERMISSIONS = ("APPROVE_JOB_POSTING", "PUBLISH_JOB_POSTING")


def upgrade() -> None:
    for label in _POSTING_STATUSES:
        op.execute(f"ALTER TYPE job_posting_status_enum ADD VALUE IF NOT EXISTS '{label}'")
    for label in _PERMISSIONS:
        op.execute(f"ALTER TYPE permission_enum ADD VALUE IF NOT EXISTS '{label}'")


def downgrade() -> None:
    # No ALTER TYPE ... DROP VALUE in Postgres. Labels intentionally stay.
    pass
