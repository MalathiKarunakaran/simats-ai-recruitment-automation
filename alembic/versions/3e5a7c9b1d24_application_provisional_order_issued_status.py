"""application status PROVISIONAL_ORDER_ISSUED

Revision ID: 3e5a7c9b1d24
Revises: 8c4e2a6b0d31
Create Date: 2026-10-31

docs/specs/provisional-order-and-allotment.md, Q1: a new application status
between JOINED and DEPARTMENT_ROOM_ALLOTTED. Its own revision so the label is
committed before anything uses it (env.py runs one transaction per
migration). Nothing existing is rewritten: applications already past JOINED
keep their status.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "3e5a7c9b1d24"
down_revision: Union[str, Sequence[str], None] = "8c4e2a6b0d31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE application_status_enum ADD VALUE IF NOT EXISTS 'PROVISIONAL_ORDER_ISSUED' "
        "AFTER 'JOINED'"
    )


def downgrade() -> None:
    # Postgres has no ALTER TYPE ... DROP VALUE: the 'PROVISIONAL_ORDER_ISSUED'
    # label stays in application_status_enum after a downgrade. Any row still
    # holding it must be moved off it by hand before downgrading further.
    pass
