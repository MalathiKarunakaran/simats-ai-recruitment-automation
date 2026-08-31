"""map_manage_sanctioned_strength_to_granular

Retires MANAGE_SANCTIONED_STRENGTH in favour of the six granular permissions
added by `f1a2b3c4d5e6`, and makes sure nobody loses access in the process.

Three steps, in this order:

1. **Map existing holders.** Anyone holding MANAGE_SANCTIONED_STRENGTH had
   full write access, so they are granted all six. Mapping rather than
   re-granting by role is the point: an individually-granted user keeps
   exactly what a Super Admin gave them.

2. **Backfill VIEW for every staff user.** The read endpoints
   (`/views/*`, `/availability`, a row's history, the exports) were gated by
   `_staff_only` -- ANY authenticated staff member -- until this change made
   them require_permission(VIEW_SANCTIONED_STRENGTH). Without this step the
   new gate would silently revoke Sanctioned Strength viewing from the entire
   organization on deploy. SUPER_ADMIN is excluded (implicit bypass, never
   carries grant rows) and so is CANDIDATE (never reaches a staff endpoint).

3. **Delete the old rows.** Leaving them would mean two permissions
   controlling one module, and MANAGE_SANCTIONED_STRENGTH is no longer a
   member of PermissionEnum -- a surviving row would raise LookupError the
   next time SQLAlchemy loaded it. The Postgres label itself stays (no
   ALTER TYPE ... DROP VALUE), unused and unreferenced.

Idempotent throughout: every INSERT anti-joins on what is already there.

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
"""

from alembic import op

revision = "a2b3c4d5e6f7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None

_GRANULAR = (
    "VIEW_SANCTIONED_STRENGTH",
    "CREATE_SANCTIONED_STRENGTH",
    "EDIT_SANCTIONED_STRENGTH",
    "BULK_UPLOAD_SANCTIONED_STRENGTH",
    "VIEW_SANCTIONED_STRENGTH_UPLOAD_HISTORY",
    "DELETE_SANCTIONED_STRENGTH",
)


def upgrade() -> None:
    # 1. every MANAGE_ holder -> all six
    for label in _GRANULAR:
        op.execute(
            f"""
            INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
            SELECT gen_random_uuid(), g.user_id, '{label}', g.granted_by_id, now()
            FROM user_permission_grants g
            WHERE g.permission = 'MANAGE_SANCTIONED_STRENGTH'
              AND NOT EXISTS (
                  SELECT 1 FROM user_permission_grants x
                  WHERE x.user_id = g.user_id AND x.permission = '{label}'
              )
            """
        )

    # 2. every remaining staff user -> VIEW (preserves the old _staff_only read)
    op.execute(
        """
        INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
        SELECT gen_random_uuid(), u.id, 'VIEW_SANCTIONED_STRENGTH', NULL, now()
        FROM users u
        WHERE u.role NOT IN ('SUPER_ADMIN', 'CANDIDATE')
          AND NOT EXISTS (
              SELECT 1 FROM user_permission_grants g
              WHERE g.user_id = u.id AND g.permission = 'VIEW_SANCTIONED_STRENGTH'
          )
        """
    )

    # 2b. RECRUITMENT_OFFICER reached Sanctioned Strength upload history via
    #     `_SHARED_BULK_UPLOAD_ROLES`, which is no longer consulted for this
    #     entity. Keep it. RECRUITMENT_COORDINATOR is in that same tuple and is
    #     deliberately excluded -- holding the module by virtue of a broad role
    #     is what this change exists to end.
    op.execute(
        """
        INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
        SELECT gen_random_uuid(), u.id, 'VIEW_SANCTIONED_STRENGTH_UPLOAD_HISTORY', NULL, now()
        FROM users u
        WHERE u.role = 'RECRUITMENT_OFFICER'
          AND NOT EXISTS (
              SELECT 1 FROM user_permission_grants g
              WHERE g.user_id = u.id
                AND g.permission = 'VIEW_SANCTIONED_STRENGTH_UPLOAD_HISTORY'
          )
        """
    )

    # 3. retire the old permission
    op.execute("DELETE FROM user_permission_grants WHERE permission = 'MANAGE_SANCTIONED_STRENGTH'")


def downgrade() -> None:
    # Re-grant MANAGE_ to anyone who ended up with the full six, then drop the
    # granular rows. A user who only ever had VIEW (from step 2) correctly
    # gets no MANAGE_ row back.
    op.execute(
        """
        INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
        SELECT gen_random_uuid(), u.id, 'MANAGE_SANCTIONED_STRENGTH', NULL, now()
        FROM users u
        WHERE (
            SELECT count(*) FROM user_permission_grants g
            WHERE g.user_id = u.id AND g.permission IN %(granular)s
        ) = %(n)s
          AND NOT EXISTS (
              SELECT 1 FROM user_permission_grants x
              WHERE x.user_id = u.id AND x.permission = 'MANAGE_SANCTIONED_STRENGTH'
          )
        """
        % {"granular": "(" + ", ".join(f"'{label}'" for label in _GRANULAR) + ")", "n": len(_GRANULAR)}
    )
    op.execute(
        "DELETE FROM user_permission_grants WHERE permission IN ("
        + ", ".join(f"'{label}'" for label in _GRANULAR)
        + ")"
    )
