"""Mint a token pair for an existing user, for the authenticated e2e specs.

The login page is OTP-first (email -> code sent by mail), so a browser test
cannot log in the way a person does without a mailbox. This issues exactly
what a successful login issues -- an access JWT plus an opaque, rotating
refresh token row -- through the same helpers `routers/auth.py` uses, and
prints them as JSON. The spec places the refresh token in the browser's
cookie jar as the `simats_refresh_token` HttpOnly cookie for the API host
(audit M1: it is never in localStorage), which is all AuthContext needs to
bootstrap a session, and uses the access token for fixture discovery.

    # local dev
    venv/Scripts/python.exe scripts/e2e_mint_tokens.py superadmin@example.com

    # production (inside the backend container)
    docker exec -w /app simats_recruitment_backend \
        sh -c 'python scripts/e2e_mint_tokens.py'          # defaults to a SUPER_ADMIN

Then:  E2E_TOKENS='<that json>' npx playwright test wizard

Nothing here bypasses authorisation: the user must already exist and be
active, and the refresh token is a normal row that `/auth/logout` or the
admin can revoke like any other.
"""

import json
import sys
import uuid
from pathlib import Path

# Runnable from anywhere, same as generate_tracker_template.py.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import security  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.auth_token import RefreshToken  # noqa: E402
from app.models.enums import UserRoleEnum  # noqa: E402
from app.models.user import User  # noqa: E402


def main(email: str | None) -> None:
    db = SessionLocal()
    try:
        query = db.query(User).filter(User.is_active.is_(True))
        if email:
            user = query.filter(User.email == email).one_or_none()
        else:
            # The wizard spec needs a SUPER_ADMIN (the only role shown the
            # Campus picker); with no email given, take the oldest active one.
            user = (
                query.filter(User.role == UserRoleEnum.SUPER_ADMIN).order_by(User.created_at.asc()).first()
            )
        if user is None:
            sys.exit(f"no active user matching {email or 'SUPER_ADMIN'!r}")

        raw_refresh = security.generate_opaque_token()
        # One session family for both halves, exactly as a login issues them
        # (audit M3: the access token is only honoured while this family
        # has an unrevoked row).
        session_id = uuid.uuid4()
        db.add(
            RefreshToken(
                user_id=user.id,
                session_id=session_id,
                token_hash=security.hash_opaque_token(raw_refresh),
                expires_at=security.refresh_token_expiry(),
                ip_address=None,
                user_agent="e2e_mint_tokens.py",
            )
        )
        db.commit()

        print(
            json.dumps(
                {
                    "access_token": security.create_access_token(
                        user_id=user.id, role=user.role.value, campus_id=user.campus_id, session_id=session_id
                    ),
                    "refresh_token": raw_refresh,
                    "email": user.email,
                    "role": user.role.value,
                }
            )
        )
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) > 2:
        sys.exit("usage: e2e_mint_tokens.py [<email>]   (default: oldest active SUPER_ADMIN)")
    main(sys.argv[1] if len(sys.argv) == 2 else None)
