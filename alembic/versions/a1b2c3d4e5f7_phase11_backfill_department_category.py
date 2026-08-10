"""phase11_backfill_department_category

Revision ID: a1b2c3d4e5f7
Revises: d4e6f1a2b3c5
Create Date: 2026-08-10 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, Sequence[str], None] = 'd4e6f1a2b3c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Subject-sounding keywords -> TEACHING. Deliberately broad ("science",
# "engineering", ...) rather than an exact-name list, so this stays portable
# to a fresh/test DB with different legacy department names -- see
# zany-snuggling-pie.md Phase 1. In the live dev DB this only actually
# matches "Computer Science" among the ~20 NULL-category rows.
_TEACHING_KEYWORDS = (
    "science",
    "engineering",
    "physics",
    "chemistry",
    "mathematics",
    "biology",
    "arts",
    "commerce",
)

# Admin/support-sounding keywords -> NON_TEACHING (also the ambiguous
# default below, so these are mostly documentation of intent rather than
# behavior-changing).
_NON_TEACHING_KEYWORDS = (
    "admin",
    "human resource",
    "hr",
    "security",
    "housekeeping",
    "maintain",
    "facilit",
    "finance",
    "account",
    "procurement",
    "transport",
)


def _case_clause() -> str:
    when_teaching = " OR ".join(f"name ILIKE '%{kw}%'" for kw in _TEACHING_KEYWORDS)
    when_non_teaching = " OR ".join(f"name ILIKE '%{kw}%'" for kw in _NON_TEACHING_KEYWORDS)
    return f"""
        CASE
            WHEN {when_teaching} THEN 'TEACHING'
            WHEN {when_non_teaching} THEN 'NON_TEACHING'
            ELSE 'NON_TEACHING'
        END::staff_role_category_enum
    """


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    null_before = bind.execute(
        sa.text("SELECT count(*) FROM departments WHERE category IS NULL")
    ).scalar_one()

    op.execute(
        f"""
        UPDATE departments
        SET category = {_case_clause()}
        WHERE category IS NULL
        """
    )

    null_after = bind.execute(
        sa.text("SELECT count(*) FROM departments WHERE category IS NULL")
    ).scalar_one()
    print(f"[{revision}] backfilled category on {null_before - null_after} department row(s), {null_after} NULL remaining")

    op.execute("ALTER TABLE departments ALTER COLUMN category SET NOT NULL")


def downgrade() -> None:
    """Downgrade schema.

    Only relaxes the NOT NULL constraint back to nullable -- the backfilled
    values themselves are not reverted to NULL, since there is no reliable
    way to tell which rows were genuinely NULL before this migration versus
    already correctly TEACHING/NON_TEACHING (e.g. from the merge migration
    just before this one). Same honest-downgrade stance as this repo's other
    data-mutating migrations.
    """
    op.execute("ALTER TABLE departments ALTER COLUMN category DROP NOT NULL")
