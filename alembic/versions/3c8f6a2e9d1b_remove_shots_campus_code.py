"""remove_shots_campus_code

Revision ID: 3c8f6a2e9d1b
Revises: 7b2e4f9a1c3d
Create Date: 2026-08-06 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '3c8f6a2e9d1b'
down_revision: Union[str, Sequence[str], None] = '7b2e4f9a1c3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The SHIFT-adding migration's OLD_CODES/NEW_CODES, kept as this migration's
# NEW_CODES/OLD_CODES respectively -- SHOTS confirmed by the user 2026-08-06
# to be a duplicate of SHIFT, not a distinct campus, and removed.
WITH_SHOTS = ("SSE", "SCLAS", "SCAD", "STUDIO", "SPIER", "SHOTS", "SSPE", "SHIFT")
WITHOUT_SHOTS = ("SSE", "SCLAS", "SCAD", "STUDIO", "SPIER", "SSPE", "SHIFT")


def _constraint_sql(codes: tuple[str, ...]) -> str:
    return ", ".join(repr(c) for c in codes)


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint("campus_code_allowlist", "campuses", type_="check")
    op.create_check_constraint(
        "campus_code_allowlist",
        "campuses",
        f"code IN ({_constraint_sql(WITHOUT_SHOTS)})",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("campus_code_allowlist", "campuses", type_="check")
    op.create_check_constraint(
        "campus_code_allowlist",
        "campuses",
        f"code IN ({_constraint_sql(WITH_SHOTS)})",
    )
