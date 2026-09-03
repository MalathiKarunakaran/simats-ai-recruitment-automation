"""Strip the seed placeholder prefix from campus names.

`app/db/seed.py` created every campus as
`Campus — {code} (TODO: update with official name)`. On production someone
later replaced the `(TODO: ...)` half with the real name but kept the leading
`Campus — {code} - `, so all seven rows read like

    Campus — SSE - SIMATS Engineering

instead of `SIMATS Engineering`. That went unnoticed for a long time because
every screen in the app renders `campus.code` alone; the ONLY place that
renders `campus.name` to a non-admin is the public QR vacancy-request form,
which shows `{code} — {name}` and so displayed the memorable

    SSE — Campus — SSE - SIMATS Engineering

Written as a migration rather than a one-off UPDATE against production so
local dev, CI and prod converge without anyone having to remember a script.
On a database whose names are already clean (local dev is) every row fails
the `stripped == row.name` check and this is a no-op.

Scope note: this strips a mechanical prefix and trims whitespace. It does NOT
reword anything -- guessing at an institution's official name is not a
migration's job, and production and local dev currently disagree about two of
them (SHIFT's "Aviation", STUDIO's "Unison" vs "Union"). Those are flagged
for a human rather than silently reconciled here.

Revision ID: 9f4c1d7ba2e6
Revises: a2b3c4d5e6f7
Create Date: 2026-09-03
"""

import re

import sqlalchemy as sa
from alembic import op

revision = "9f4c1d7ba2e6"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


# "Campus — SSE - ", "Campus - SSE — ", "Campus—SSE-" ... the separator has
# been typed by several hands, so match any dash-ish character on both sides
# rather than pinning the em dash the seeder happened to use.
DASH = r"[‐-―\-]"


def _prefix(code: str) -> re.Pattern[str]:
    return re.compile(rf"^\s*Campus\s*{DASH}\s*{re.escape(code)}\s*{DASH}\s*", re.IGNORECASE)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, code, name FROM campuses")).fetchall()

    for row in rows:
        stripped = _prefix(row.code).sub("", row.name or "").strip()
        # A row still holding the untouched `(TODO: update with official
        # name)` placeholder has no real name hiding behind the prefix --
        # blanking it would be worse than leaving the honest placeholder, and
        # `name` is NOT NULL besides.
        if not stripped or stripped == row.name:
            continue
        bind.execute(
            sa.text("UPDATE campuses SET name = :name WHERE id = :id"),
            {"name": stripped, "id": row.id},
        )


def downgrade() -> None:
    """Put the prefix back, for anyone rolling the deploy backwards.

    The exact original spacing is not recoverable, so this reconstructs the
    canonical `Campus — {code} - {name}` form rather than pretending to
    restore byte-for-byte.
    """
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, code, name FROM campuses")).fetchall()

    for row in rows:
        name = row.name or ""
        if _prefix(row.code).match(name):
            continue
        bind.execute(
            sa.text("UPDATE campuses SET name = :name WHERE id = :id"),
            {"name": f"Campus — {row.code} - {name}", "id": row.id},
        )
