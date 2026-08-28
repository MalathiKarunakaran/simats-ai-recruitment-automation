"""Replace Department.category with a multi-valued supported_categories array.

A department is a place, not a staff category: CSE employs Assistant
Professors (TEACHING) and Lab Assistants (NON_TEACHING) simultaneously. The
old single NOT NULL `category` column forced a false exclusivity, and every
validation site compared it for EQUALITY against the designation's own
category -- so a NON_TEACHING designation on a department the backfill had
labelled TEACHING was rejected outright. That is the bulk-upload failure this
migration exists to fix.

No data is lost: every row's existing scalar `category` becomes the single
member of its new array, so behaviour is identical until someone widens a
department. Widening is then a pure UI/API action, no further migration.

Revision ID: e1f2a3b4c5d6
Revises: d8e9f0a1b2c3
Create Date: 2026-08-28
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e1f2a3b4c5d6"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None

# `create_type=False` on both: `staff_role_category_enum` is long-established
# (designations, sanctioned strength, vacancy requests all use it) so it
# already exists in every database this runs against. Letting alembic try to
# CREATE TYPE it again would abort the migration.
_CATEGORY_ENUM = postgresql.ENUM(
    "TEACHING", "NON_TEACHING", "HOUSEKEEPING", name="staff_role_category_enum", create_type=False
)


def upgrade() -> None:
    # Nullable first -- the table has real rows, so a NOT NULL column with no
    # default cannot be added in one step.
    op.add_column(
        "departments",
        sa.Column("supported_categories", postgresql.ARRAY(_CATEGORY_ENUM), nullable=True),
    )
    op.execute("UPDATE departments SET supported_categories = ARRAY[category]")
    op.alter_column("departments", "supported_categories", nullable=False)

    # A department supporting no category could hold no staff at all, which
    # would silently reject every designation pointed at it. Cheaper to
    # forbid at the DB than to re-derive the invariant at each call site.
    op.create_check_constraint(
        "ck_department_supported_categories_not_empty",
        "departments",
        "array_length(supported_categories, 1) >= 1",
    )
    # Every list/count query filters with the array containment operator
    # (`@>`), which only a GIN index can serve.
    op.create_index(
        "ix_departments_supported_categories",
        "departments",
        ["supported_categories"],
        postgresql_using="gin",
    )

    op.drop_column("departments", "category")


def downgrade() -> None:
    # Lossy by nature: a department widened to several categories collapses
    # back to its first. Ordering is the array's own, which the upgrade seeded
    # from the old scalar, so a database that was never widened round-trips
    # exactly.
    op.add_column(
        "departments",
        sa.Column("category", _CATEGORY_ENUM, nullable=True),
    )
    op.execute("UPDATE departments SET category = supported_categories[1]")
    op.alter_column("departments", "category", nullable=False)

    op.drop_index("ix_departments_supported_categories", table_name="departments")
    op.drop_constraint("ck_department_supported_categories_not_empty", "departments", type_="check")
    op.drop_column("departments", "supported_categories")
