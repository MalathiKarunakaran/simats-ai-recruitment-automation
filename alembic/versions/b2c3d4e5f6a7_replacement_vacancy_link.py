"""Link a vacancy request to the employee it replaces.

When an employee is offboarded, HR can raise a replacement vacancy request
in the same act (app/services/employees.py::raise_replacement_vacancy_request).
The draft is a one-position clone of the requisition the leaver was hired
against, and this column records who it replaces so the request page can
say so and reports can count replacement hiring separately from growth.
Nullable: every request raised any other way leaves it empty. SET NULL on
delete, since the request must outlive an employee row that is ever
removed.

Revision ID: b2c3d4e5f6a7
Revises: c4d5e6f7a8b9
Create Date: 2026-09-07
"""

import sqlalchemy as sa
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vacancy_requests", sa.Column("replacement_for_employee_id", sa.UUID(), nullable=True))
    op.create_index(
        op.f("ix_vacancy_requests_replacement_for_employee_id"),
        "vacancy_requests",
        ["replacement_for_employee_id"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("fk_vacancy_requests_replacement_for_employee_id_employees"),
        "vacancy_requests",
        "employees",
        ["replacement_for_employee_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_vacancy_requests_replacement_for_employee_id_employees"), "vacancy_requests", type_="foreignkey"
    )
    op.drop_index(op.f("ix_vacancy_requests_replacement_for_employee_id"), table_name="vacancy_requests")
    op.drop_column("vacancy_requests", "replacement_for_employee_id")
