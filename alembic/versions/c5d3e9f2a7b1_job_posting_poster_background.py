"""JobPosting poster background image -- the AI picture behind the header

Revision ID: c5d3e9f2a7b1
Revises: b4c2d8e1f3a5
Create Date: 2026-09-17

Three nullable columns and one NOT NULL boolean that backfills to false, so
every existing posting keeps printing the poster it printed yesterday: no
key, no image, and the approval switch off.
"""

import sqlalchemy as sa
from alembic import op

revision = "c5d3e9f2a7b1"
down_revision = "b4c2d8e1f3a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_postings", sa.Column("poster_background_key", sa.String(length=512), nullable=True))
    op.add_column("job_postings", sa.Column("poster_background_prompt", sa.Text(), nullable=True))
    op.add_column(
        "job_postings",
        sa.Column("poster_background_generated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "job_postings",
        sa.Column(
            "poster_background_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("job_postings", "poster_background_enabled")
    op.drop_column("job_postings", "poster_background_generated_at")
    op.drop_column("job_postings", "poster_background_prompt")
    op.drop_column("job_postings", "poster_background_key")
