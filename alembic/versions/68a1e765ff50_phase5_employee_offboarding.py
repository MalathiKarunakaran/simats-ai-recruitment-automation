"""phase5_employee_offboarding

Revision ID: 68a1e765ff50
Revises: 7160cc764eaa
Create Date: 2026-07-18 06:57:43.974299

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '68a1e765ff50'
down_revision: Union[str, Sequence[str], None] = '7160cc764eaa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Brand-new enum type (not ADD VALUE onto an existing one) -- can be
    # created and cleanly dropped in downgrade() like the other Phase 2
    # enums in 08d365f809c1_phase2_vacancy_pipeline_offers_joining.py.
    employment_status_enum = sa.Enum(
        "ACTIVE", "RESIGNED", "TERMINATED", "RETIRED", name="employment_status_enum"
    )
    employment_status_enum.create(op.get_bind())

    # server_default so existing rows get ACTIVE without the migration
    # failing on NOT NULL; the model's Python-level default is left as the
    # only source of truth for new inserts (server_default kept here too --
    # simplest correct option, no need for a follow-up drop).
    op.add_column(
        "employees",
        sa.Column(
            "employment_status",
            employment_status_enum,
            nullable=False,
            server_default="ACTIVE",
        ),
    )
    op.add_column("employees", sa.Column("separation_date", sa.Date(), nullable=True))
    op.add_column("employees", sa.Column("separation_reason", sa.Text(), nullable=True))
    op.add_column("employees", sa.Column("separated_by_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f("fk_employees_separated_by_id_users"),
        "employees",
        "users",
        ["separated_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f("fk_employees_separated_by_id_users"), "employees", type_="foreignkey")
    op.drop_column("employees", "separated_by_id")
    op.drop_column("employees", "separation_reason")
    op.drop_column("employees", "separation_date")
    op.drop_column("employees", "employment_status")

    # Safe to drop outright here -- unlike WITHDRAWN (added to an existing
    # enum that other rows may already reference), this type was created
    # fresh in this same migration and nothing else depends on it yet.
    sa.Enum(name="employment_status_enum").drop(op.get_bind(), checkfirst=True)
