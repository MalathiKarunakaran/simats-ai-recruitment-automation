"""phase11_merge_non_teaching_duplicate_departments

Revision ID: d4e6f1a2b3c5
Revises: 9e4d7b1a5c2f
Create Date: 2026-08-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e6f1a2b3c5'
down_revision: Union[str, Sequence[str], None] = '9e4d7b1a5c2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    On the SSE campus (and portably, anywhere the same pattern exists),
    academic departments were double-entered as two rows sharing the same
    `code` -- one plain ("CSE", category TEACHING) and one with a
    "(Non-Teaching)" name suffix (category NON_TEACHING) -- a data-entry
    workaround, not a schema limitation (see
    zany-snuggling-pie.md Phase 1 / CHANGELOG-equivalent plan doc). This
    merges each such pair into the TEACHING-categorized row, generically
    (no hardcoded department names/ids), so it's portable across
    environments including a fresh/test DB with different seed data.
    """
    bind = op.get_bind()

    before_count = bind.execute(sa.text("SELECT count(*) FROM departments")).scalar_one()

    # Pair detection: same (campus_id, code), one TEACHING (canonical) and
    # one NON_TEACHING (duplicate). NULL codes never self-join (NULL = NULL
    # is unknown in SQL), so departments without a code are never touched.
    op.execute(
        """
        CREATE TEMP TABLE dept_merge_pairs AS
        SELECT dup.id AS duplicate_id, canon.id AS canonical_id
        FROM departments dup
        JOIN departments canon
          ON dup.campus_id = canon.campus_id
         AND dup.code = canon.code
         AND dup.id <> canon.id
        WHERE dup.category = 'NON_TEACHING'
          AND canon.category = 'TEACHING'
          AND dup.code IS NOT NULL
        """
    )

    pair_count = bind.execute(sa.text("SELECT count(*) FROM dept_merge_pairs")).scalar_one()
    print(f"[{revision}] found {pair_count} duplicate department pair(s) to merge")

    # Repoint every FK column that references departments.id, duplicate ->
    # canonical. vacancy_requests/employees/users are the three named in the
    # plan; applications.department_allotted_id shares the same
    # ForeignKey("departments.id", ondelete="SET NULL") shape and is repointed
    # too so deleting the duplicate row below never silently nulls out real
    # data via ON DELETE SET NULL.
    for table, column in (
        ("vacancy_requests", "department_id"),
        ("employees", "department_id"),
        ("users", "department_id"),
        ("applications", "department_allotted_id"),
    ):
        op.execute(
            f"""
            UPDATE {table} t
            SET {column} = p.canonical_id
            FROM dept_merge_pairs p
            WHERE t.{column} = p.duplicate_id
            """
        )

    # designation_departments (composite PK, no independent identity): move
    # links to canonical, skipping any (designation_id, canonical_id) pair
    # that's already linked (would violate the composite PK), then delete any
    # leftover rows still pointing at the duplicate.
    op.execute(
        """
        UPDATE designation_departments dd
        SET department_id = p.canonical_id
        FROM dept_merge_pairs p
        WHERE dd.department_id = p.duplicate_id
          AND NOT EXISTS (
              SELECT 1 FROM designation_departments dd2
              WHERE dd2.designation_id = dd.designation_id
                AND dd2.department_id = p.canonical_id
          )
        """
    )
    op.execute(
        """
        DELETE FROM designation_departments dd
        USING dept_merge_pairs p
        WHERE dd.department_id = p.duplicate_id
        """
    )

    # Defensive: strip any stray "(Non-Teaching)" suffix that might remain on
    # a canonical row's name from bad historical data entry (none in the live
    # DB today, but cheap and harmless if a fresh/test DB has one).
    op.execute(
        r"""
        UPDATE departments
        SET name = regexp_replace(name, '\s*\(Non-Teaching\)\s*$', '', 'i')
        WHERE id IN (SELECT canonical_id FROM dept_merge_pairs)
          AND name ~* '\(Non-Teaching\)\s*$'
        """
    )

    op.execute(
        """
        DELETE FROM departments d
        USING dept_merge_pairs p
        WHERE d.id = p.duplicate_id
        """
    )

    op.execute("DROP TABLE dept_merge_pairs")

    after_count = bind.execute(sa.text("SELECT count(*) FROM departments")).scalar_one()
    print(f"[{revision}] departments: {before_count} -> {after_count}")


def downgrade() -> None:
    """Downgrade schema.

    Irreversible by necessity -- the duplicate department rows (and their
    original ids) are deleted, and every FK that used to point at them has
    already been repointed to the canonical row. There is no way to
    reconstruct which vacancy_requests/employees/users/designation_departments
    rows originally pointed at the now-deleted duplicate. Same honest
    "downgrade can't undo this" stance as 023e1b89bbec /
    ba2e30350b8a for this repo's other data-merging migrations.
    """
    pass
