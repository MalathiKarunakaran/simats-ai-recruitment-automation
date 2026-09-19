"""JobPosting role photo -- the picture of the work on a campaign poster

Revision ID: d7e8f9a0b1c2
Revises: c5d3e9f2a7b1
Create Date: 2026-09-18

The same four columns as the poster background one revision back, for a
different picture: the background sits behind a single posting's header, this
is the photograph of the role itself on the multi-role campaign sheet. Same
rule, same switch: nothing is printed until a person has looked at it.
"""

import sqlalchemy as sa
from alembic import op

revision = "d7e8f9a0b1c2"
down_revision = "c5d3e9f2a7b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_postings", sa.Column("role_photo_key", sa.String(length=512), nullable=True))
    op.add_column("job_postings", sa.Column("role_photo_prompt", sa.Text(), nullable=True))
    op.add_column("job_postings", sa.Column("role_photo_generated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "job_postings",
        sa.Column("role_photo_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("job_postings", "role_photo_enabled")
    op.drop_column("job_postings", "role_photo_generated_at")
    op.drop_column("job_postings", "role_photo_prompt")
    op.drop_column("job_postings", "role_photo_key")
