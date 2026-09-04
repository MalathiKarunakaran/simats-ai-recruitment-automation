"""Cap wrong guesses per login code (audit M2, 2026-09-04).

A 6-digit code was valid for ten minutes with no per-code attempt limit;
the only throttle was the per-IP rate limiter. `attempt_count` records the
wrong guesses a code has absorbed so `routers/auth.py::otp_verify` can
retire it at OTP_MAX_ATTEMPTS. Existing rows start at 0.

Revision ID: b7c1d2e3f4a5
Revises: c8d9e0f1a2b3
Create Date: 2026-09-04
"""

import sqlalchemy as sa
from alembic import op

revision = "b7c1d2e3f4a5"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "login_otps",
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("login_otps", "attempt_count")
