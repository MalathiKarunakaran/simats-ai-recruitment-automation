"""phase5_pipeline_rename_add_values

Revision ID: f32d13801269
Revises: 023e1b89bbec
Create Date: 2026-07-17 19:56:18.755550

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f32d13801269'
down_revision: Union[str, Sequence[str], None] = '023e1b89bbec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The real, currently-manual SIMATS hiring pipeline (see app/models/enums.py)
# replaces the old generic-ATS pipeline. Postgres has no ALTER TYPE ... DROP
# VALUE, so the old labels stay in the type forever; this migration only
# adds the new ones. The next migration (ba2e30350b8a) moves existing rows
# off the old labels -- it must run separately since a value ADD VALUE
# introduces can't be used in the same transaction that added it.
#
# IMPORTANT: this repo's alembic/env.py wraps a whole `alembic upgrade`
# invocation in one transaction/connection (context.begin_transaction()
# around context.run_migrations(), not per-revision), so running
# `alembic upgrade head` in one command from an earlier revision applies
# both this migration AND ba2e30350b8a in the same transaction -- which
# fails with "unsafe use of new value" because the ADD VALUE above never
# actually committed before ba2e30350b8a's UPDATE tried to use it. Apply
# these as two separate CLI invocations: `alembic upgrade f32d13801269`
# then `alembic upgrade head`.
_NEW_STATUS_VALUES = (
    "CALLED_FOR_INTERVIEW",
    "INTERVIEWED",
    "JOINING_CONFIRMED",
    "DEPARTMENT_ROOM_ALLOTTED",
    "ORIENTATION_COMPLETE",
    "HANDED_OVER_TO_HOD",
)


def upgrade() -> None:
    """Upgrade schema."""
    for value in _NEW_STATUS_VALUES:
        op.execute(f"ALTER TYPE application_status_enum ADD VALUE IF NOT EXISTS '{value}'")

    op.add_column("applications", sa.Column("panel_members", sa.Text(), nullable=True))
    op.add_column("applications", sa.Column("panel_result", sa.String(length=100), nullable=True))
    op.add_column("applications", sa.Column("panel_remarks", sa.Text(), nullable=True))
    op.add_column("applications", sa.Column("salary_fixed", sa.Numeric(12, 2), nullable=True))
    op.add_column("applications", sa.Column("called_date", sa.Date(), nullable=True))
    op.add_column("applications", sa.Column("interview_scheduled_date", sa.Date(), nullable=True))
    op.add_column("applications", sa.Column("offer_given_date", sa.Date(), nullable=True))
    op.add_column("applications", sa.Column("expected_joining_date", sa.Date(), nullable=True))
    op.add_column(
        "applications",
        sa.Column("department_allotted_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_applications_department_allotted_id_departments",
        "applications",
        "departments",
        ["department_allotted_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("applications", sa.Column("room_allotted", sa.String(length=50), nullable=True))
    op.add_column("applications", sa.Column("orientation_date", sa.Date(), nullable=True))
    op.add_column("applications", sa.Column("hod_assigned", sa.String(length=150), nullable=True))

    op.add_column("candidates", sa.Column("reference_name", sa.String(length=150), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("candidates", "reference_name")

    op.drop_column("applications", "hod_assigned")
    op.drop_column("applications", "orientation_date")
    op.drop_column("applications", "room_allotted")
    op.drop_constraint(
        "fk_applications_department_allotted_id_departments", "applications", type_="foreignkey"
    )
    op.drop_column("applications", "department_allotted_id")
    op.drop_column("applications", "expected_joining_date")
    op.drop_column("applications", "offer_given_date")
    op.drop_column("applications", "interview_scheduled_date")
    op.drop_column("applications", "called_date")
    op.drop_column("applications", "salary_fixed")
    op.drop_column("applications", "panel_remarks")
    op.drop_column("applications", "panel_result")
    op.drop_column("applications", "panel_members")
    # Postgres has no ALTER TYPE ... DROP VALUE -- the new status labels
    # intentionally stay in the enum type on downgrade, same limitation as
    # every other enum-value addition in this repo's migration history.
