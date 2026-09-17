"""JobPosting poster copy -- the printed poster's own wording

Revision ID: b4c2d8e1f3a5
Revises: a3f1c7d9e2b4
Create Date: 2026-09-16

Four nullable columns, no enum and no backfill: a posting with none of them
renders the same poster it rendered before they existed.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b4c2d8e1f3a5"
down_revision = "a3f1c7d9e2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_postings", sa.Column("poster_headline", sa.String(length=60), nullable=True))
    op.add_column("job_postings", sa.Column("poster_pitch", sa.String(length=240), nullable=True))
    op.add_column(
        "job_postings",
        sa.Column("poster_bullets", postgresql.ARRAY(sa.String(length=160)), nullable=True),
    )
    op.add_column(
        "job_postings",
        sa.Column("poster_copy_generated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("job_postings", "poster_copy_generated_at")
    op.drop_column("job_postings", "poster_bullets")
    op.drop_column("job_postings", "poster_pitch")
    op.drop_column("job_postings", "poster_headline")
