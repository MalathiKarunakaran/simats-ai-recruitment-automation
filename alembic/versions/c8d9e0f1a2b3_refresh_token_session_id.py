"""Bind access tokens to a refresh-token session family (audit M3, 2026-09-04).

`refresh_tokens.session_id` identifies the family a row belongs to: a login
starts a new family and every rotation copies the id onto the replacement
row. Access JWTs carry it as `sid`, and `app/core/deps.py::get_current_user`
accepts a token only while its family still has an unrevoked row. Until
now a signed access token stayed valid for its full 30 minutes after force
logout, an admin or self-service password reset, or logout.

Existing rows get their own id as the family id, which is exactly right:
each of them is the latest row of a family that has never been tracked.

Revision ID: c8d9e0f1a2b3
Revises: 9f4c1d7ba2e6
Create Date: 2026-09-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c8d9e0f1a2b3"
down_revision = "9f4c1d7ba2e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "refresh_tokens",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute("UPDATE refresh_tokens SET session_id = id WHERE session_id IS NULL")
    op.alter_column("refresh_tokens", "session_id", nullable=False)
    op.create_index("ix_refresh_tokens_session_id", "refresh_tokens", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_refresh_tokens_session_id", table_name="refresh_tokens")
    op.drop_column("refresh_tokens", "session_id")
