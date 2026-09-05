"""Link a housekeeping roster row to the Employee the pipeline created.

Until now a Housekeeping hire that completed the pipeline produced an
Employee row and nothing else, while the Housekeeping working count is a
count of active `housekeeping_staff` rows -- so the vacancy count never
moved. `joining.py` now creates the roster row at hand-over to HOD and
records which employee it belongs to, so offboarding can deactivate it.
NULL for every row entered by hand or bulk upload.

Revision ID: d2e3f4a5b6c7
Revises: b7c1d2e3f4a5
Create Date: 2026-09-05
"""

import sqlalchemy as sa
from alembic import op

revision = "d2e3f4a5b6c7"
down_revision = "b7c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("housekeeping_staff", sa.Column("employee_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f("fk_housekeeping_staff_employee_id_employees"),
        "housekeeping_staff",
        "employees",
        ["employee_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        op.f("uq_housekeeping_staff_employee_id"), "housekeeping_staff", ["employee_id"]
    )


def downgrade() -> None:
    op.drop_constraint(op.f("uq_housekeeping_staff_employee_id"), "housekeeping_staff", type_="unique")
    op.drop_constraint(op.f("fk_housekeeping_staff_employee_id_employees"), "housekeeping_staff", type_="foreignkey")
    op.drop_column("housekeeping_staff", "employee_id")
