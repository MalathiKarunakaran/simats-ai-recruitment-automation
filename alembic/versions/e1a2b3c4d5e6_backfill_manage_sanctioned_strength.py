"""backfill_manage_sanctioned_strength

Grants MANAGE_SANCTIONED_STRENGTH to every existing HR_ADMIN user.

**This is the whole point of splitting it from `d0e1f2a3b4c5`.** The router
cutover in this same change swaps Sanctioned Strength's write endpoints from
`require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES)` to
`require_permission(MANAGE_SANCTIONED_STRENGTH)`. Without this backfill every
HR_ADMIN would LOSE access the moment the new code deploys, because they hold
no grant row for a permission that did not exist when their grants were
written.

SUPER_ADMIN is deliberately not backfilled: `has_permission` short-circuits
true for it and it never carries grant rows (same convention as
`e5a4d57be056`, which established this table).

`granted_by_id` is NULL for these rows -- they were not granted by a person.
The column is nullable precisely so a system backfill can say so honestly
rather than attributing itself to some arbitrary admin.

Idempotent: the anti-join means re-running adds nothing.

Revision ID: e1a2b3c4d5e6
Revises: d0e1f2a3b4c5
"""

from alembic import op

revision = "e1a2b3c4d5e6"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
        SELECT gen_random_uuid(), u.id, 'MANAGE_SANCTIONED_STRENGTH', NULL, now()
        FROM users u
        WHERE u.role = 'HR_ADMIN'
          AND NOT EXISTS (
              SELECT 1 FROM user_permission_grants g
              WHERE g.user_id = u.id AND g.permission = 'MANAGE_SANCTIONED_STRENGTH'
          )
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM user_permission_grants WHERE permission = 'MANAGE_SANCTIONED_STRENGTH'")
