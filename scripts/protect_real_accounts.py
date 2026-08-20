"""One-off data script promised by e5f6a7b8c9d0_user_deactivation_protected_flag.py's
own migration docstring -- flips deactivation_protected=True for the real,
active, human accounts in the DB (as opposed to the inert @example.com seed
placeholders, all of which are is_active=False and untouched by this script).

deactivation_protected is deliberately absent from UserUpdate (app/schemas/user.py)
-- there is no API path to set it, by design (see that migration's docstring) --
so a direct DB write via this script is the only way, same as the migration
itself planned.

Run once: venv/Scripts/python.exe scripts/protect_real_accounts.py
Idempotent -- re-running is a no-op for already-protected rows.
"""
from app.db.session import SessionLocal
from app.models.user import User

# The 3 real, active, human-named accounts in the DB as of 2026-08-20 -- every
# other row is an inactive @example.com seed/test placeholder. The migration's
# own docstring says "the two real accounts this was built for" without naming
# them; there is no remaining signal in the DB (identical created_at for the
# two coordinators, no notes field) to pick 2 of these 3, so all 3 real people
# are protected rather than arbitrarily leaving one exposed.
PROTECTED_EMAILS = [
    "malathi@saveetha.com",        # sole SUPER_ADMIN -- self-lockout risk if deactivated
    "narmadaa.sse@saveetha.com",   # real active Recruitment Coordinator
    "isaiselvim.sse@saveetha.com", # real active Recruitment Coordinator
]


def main() -> None:
    db = SessionLocal()
    try:
        for email in PROTECTED_EMAILS:
            user = db.query(User).filter(User.email == email).one_or_none()
            if user is None:
                print(f"SKIP (not found): {email}")
                continue
            if user.deactivation_protected:
                print(f"already protected: {email}")
                continue
            user.deactivation_protected = True
            print(f"protected: {email}")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
