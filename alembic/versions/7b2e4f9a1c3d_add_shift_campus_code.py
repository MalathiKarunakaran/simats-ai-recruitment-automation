"""add_shift_campus_code

Revision ID: 7b2e4f9a1c3d
Revises: 4a7c9e1f2b3d
Create Date: 2026-08-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7b2e4f9a1c3d'
down_revision: Union[str, Sequence[str], None] = '4a7c9e1f2b3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_CODES = ("SSE", "SCLAS", "SCAD", "STUDIO", "SPIER", "SHOTS", "SSPE")
NEW_CODES = OLD_CODES + ("SHIFT",)


def _constraint_sql(codes: tuple[str, ...]) -> str:
    return ", ".join(repr(c) for c in codes)


def upgrade() -> None:
    """Upgrade schema."""
    # campuses.code is a plain VARCHAR gated by a CHECK constraint (not a native
    # Postgres enum, unlike employment_type_enum/etc), so this is a simple
    # drop-and-recreate -- no ADD VALUE transaction-split gotcha applies here.
    # Adds SHIFT as an 8th real campus code, confirmed by the user 2026-08-06 --
    # closes the "8 campuses, only 7 ever named" gap noted in CLAUDE.md.
    op.drop_constraint("campus_code_allowlist", "campuses", type_="check")
    op.create_check_constraint(
        "campus_code_allowlist",
        "campuses",
        f"code IN ({_constraint_sql(NEW_CODES)})",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("campus_code_allowlist", "campuses", type_="check")
    op.create_check_constraint(
        "campus_code_allowlist",
        "campuses",
        f"code IN ({_constraint_sql(OLD_CODES)})",
    )
