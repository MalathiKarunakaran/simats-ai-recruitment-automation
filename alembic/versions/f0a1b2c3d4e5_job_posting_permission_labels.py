"""Add the three job-posting permission labels to permission_enum.

EDIT_JOB_POSTING (ad content, pause, resume), REVIEW_POSTING_CHANNELS
(select or remove a recommended channel, record a manual posting
reference) and MANAGE_RECRUITMENT_CHANNELS (channel and rule admin).

Labels only. Postgres requires ADD VALUE to be committed before any
statement uses the new value, so the columns and the grant backfill live in
the FOLLOWING revision (`c4d5e6f7a8b9`) -- the same split as
f1a2b3c4d5e6 / a2b3c4d5e6f7 before it. alembic/env.py runs each revision in
its own transaction (transaction_per_migration=True), so one
`alembic upgrade head` applies both safely.

**Not cleanly reversible** -- Postgres has no ALTER TYPE ... DROP VALUE.

Revision ID: f0a1b2c3d4e5
Revises: e7f8a9b0c1d2
Create Date: 2026-09-06
"""

from alembic import op

revision = "f0a1b2c3d4e5"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None

_NEW_LABELS = ("EDIT_JOB_POSTING", "REVIEW_POSTING_CHANNELS", "MANAGE_RECRUITMENT_CHANNELS")


def upgrade() -> None:
    for label in _NEW_LABELS:
        op.execute(f"ALTER TYPE permission_enum ADD VALUE IF NOT EXISTS '{label}'")


def downgrade() -> None:
    # No ALTER TYPE ... DROP VALUE in Postgres. Labels intentionally stay.
    pass
