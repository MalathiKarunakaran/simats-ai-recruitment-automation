"""phase12_employee_designation_id_backfill

Revision ID: f4b8c9d1e2a3
Revises: aa05adcc1a38
Create Date: 2026-08-10 19:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4b8c9d1e2a3'
down_revision: Union[str, Sequence[str], None] = 'aa05adcc1a38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Adds Employee.designation_id (nullable FK -> designations.id,
    ON DELETE SET NULL), purely additive alongside the existing free-text
    `designation` column (same "FK alongside free-text" precedent as
    VacancyRequest.designation_id), then backfills it via a case-insensitive
    exact match against Designation.name -- same "log before/after counts"
    discipline as a1b2c3d4e5f7_phase11_backfill_department_category.py.

    This dev DB currently has 0 employees, so the backfill is a live no-op --
    still written and logged correctly for when real data exists (and for
    the pytest coverage that exercises it against fixture data).
    """
    op.add_column('employees', sa.Column('designation_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f('fk_employees_designation_id_designations'),
        'employees', 'designations', ['designation_id'], ['id'], ondelete='SET NULL',
    )

    bind = op.get_bind()

    total_before = bind.execute(
        sa.text("SELECT count(*) FROM employees WHERE designation_id IS NULL")
    ).scalar_one()

    op.execute(
        """
        UPDATE employees e
        SET designation_id = d.id
        FROM designations d
        WHERE LOWER(TRIM(e.designation)) = LOWER(TRIM(d.name))
          AND e.designation_id IS NULL
        """
    )

    unmatched_after = bind.execute(
        sa.text("SELECT count(*) FROM employees WHERE designation_id IS NULL")
    ).scalar_one()
    matched = total_before - unmatched_after
    print(
        f"[{revision}] employees.designation_id backfill: {matched} matched, "
        f"{unmatched_after} left NULL (no case-insensitive name match), out of {total_before} candidates"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f('fk_employees_designation_id_designations'), 'employees', type_='foreignkey')
    op.drop_column('employees', 'designation_id')
