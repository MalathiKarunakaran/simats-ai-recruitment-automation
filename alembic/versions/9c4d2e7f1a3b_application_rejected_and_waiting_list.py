"""application rejected and waiting list

Revision ID: 9c4d2e7f1a3b
Revises: cfbfb6dc616c
Create Date: 2026-10-29

Phase 1 of the pipeline-completion brief: a WAITLISTED status, a structured
rejection category, the stage a rejection happened at, and a waiting-list
rank. All three columns are nullable and nothing existing is rewritten.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "9c4d2e7f1a3b"
down_revision: Union[str, Sequence[str], None] = "cfbfb6dc616c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_REJECTION_CATEGORIES = (
    "NOT_ELIGIBLE",
    "FAILED_SCREENING",
    "DID_NOT_ATTEND_INTERVIEW",
    "PANEL_NOT_RECOMMENDED",
    "SALARY_MISMATCH",
    "OTHER",
)


def upgrade() -> None:
    # Only adds the label; no row in this migration uses it, so it is safe
    # inside the same transaction (see 023e1b89bbec for the same pattern).
    op.execute("ALTER TYPE application_status_enum ADD VALUE IF NOT EXISTS 'WAITLISTED'")

    rejection_category = postgresql.ENUM(*_REJECTION_CATEGORIES, name="rejection_category_enum")
    rejection_category.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "applications",
        sa.Column(
            "rejection_category",
            postgresql.ENUM(*_REJECTION_CATEGORIES, name="rejection_category_enum", create_type=False),
            nullable=True,
        ),
    )
    op.create_index(op.f("ix_applications_rejection_category"), "applications", ["rejection_category"])
    op.add_column(
        "applications",
        sa.Column(
            "rejected_at_stage",
            postgresql.ENUM(name="application_status_enum", create_type=False),
            nullable=True,
        ),
    )
    op.add_column("applications", sa.Column("waitlist_rank", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("applications", "waitlist_rank")
    op.drop_column("applications", "rejected_at_stage")
    op.drop_index(op.f("ix_applications_rejection_category"), table_name="applications")
    op.drop_column("applications", "rejection_category")
    postgresql.ENUM(name="rejection_category_enum").drop(op.get_bind(), checkfirst=True)
    # Postgres has no ALTER TYPE ... DROP VALUE: the 'WAITLISTED' label stays
    # in application_status_enum after a downgrade. Any row still holding it
    # must be moved off it by hand before downgrading further.
