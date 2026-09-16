"""Designation.job_description -- the reusable JD per job position

Revision ID: a3f1c7d9e2b4
Revises: e8f9a0b1c2d3
Create Date: 2026-09-16

Plain nullable Text, no enum and no backfill: every existing designation
starts with no JD and behaves exactly as before (vacancy_requests.py only
pre-fills `jd_draft` when this column has something in it).
"""

import sqlalchemy as sa
from alembic import op

revision = "a3f1c7d9e2b4"
down_revision = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("designations", sa.Column("job_description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("designations", "job_description")
