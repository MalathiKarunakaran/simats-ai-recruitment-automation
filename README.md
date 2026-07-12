# SIMATS AI Recruitment Automation System — Phase 1: Foundation

Phase 1 of a 15-module, 7-phase recruitment automation platform for SIMATS
(8 campuses, 3 staff categories: Teaching / Non-Teaching / Housekeeping —
those belong to Phase 2's Vacancy module and are **not** part of Phase 1).

This phase delivers only: **DB schema, JWT auth, campus-scoped RBAC, and a
base FastAPI skeleton.** No frontend, no AI agents, no MinIO, no ChromaDB —
see "Known stubs" below.

## Stack

FastAPI + SQLAlchemy 2.0 + PostgreSQL 16 + Alembic + JWT (PyJWT) + Argon2id
password hashing. Backend-only; verified via Swagger UI (`/docs`) and pytest.

## Prerequisites

- Docker Desktop (for Postgres)
- The existing `venv/` (Python 3.14, already created)

## Setup

```bash
# 1. Install dependencies
venv/Scripts/python.exe -m pip install -r requirements-dev.txt

# 2. Configure environment
cp .env.example .env
# Edit .env: set SEED_SUPER_ADMIN_EMAIL to your own email if you want to log
# in as yourself, and generate a real JWT_SECRET_KEY:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"

# 3. Start Postgres
docker compose up -d
# Note: mapped to host port 5434, not the default 5432/5433 -- this machine
# runs other unrelated Postgres containers on those ports.

# 4. Apply migrations
venv/Scripts/python.exe -m alembic upgrade head

# 5. Seed data (idempotent -- safe to re-run)
venv/Scripts/python.exe -m app.db.seed
# Prints a one-time Super Admin password if SEED_SUPER_ADMIN_PASSWORD is unset.

# 6. Run the API
venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/docs — click "Authorize" and log in with any
seeded user (email as username) to exercise every endpoint interactively.

## Seeded data

- 7 campuses: `SSE, SCLAS, SCAD, STUDIO, SPIER, SHOTS, SSPE` (placeholder
  `name` values marked TODO — official full names were not fabricated).
- 1 Super Admin (email/password from `.env`, or auto-generated).
- One sample user per role (shared password: `SEED_SAMPLE_USER_PASSWORD` in
  `.env`, default `DevPass123!`), including **two different-campus HODs**
  (`hod.sse@example.com` @ SSE, `hod.scad@example.com` @ SCAD) specifically
  so cross-campus RBAC denial is exercisable/testable out of the box.

## Verification

```bash
# Unit/integration tests (uses a separate simats_recruitment_test DB)
docker exec simats_recruitment_postgres psql -U simats_app -d simats_recruitment -c "CREATE DATABASE simats_recruitment_test"  # one-time
venv/Scripts/python.exe -m pytest -v
```

35 tests cover: login success/failure/deactivated-user, refresh token
rotation + revocation on logout, password reset (no email enumeration, all
sessions revoked on confirm), Super Admin/Associate Dean global visibility,
**Campus HOD list/detail scoped to their own campus with a 404 — not 403 —
on cross-campus access**, role-gated user/campus/department creation,
audit log rows created correctly for both mutations and auth events (with
an explicit assertion that no plaintext password ever appears in a logged
before/after snapshot), and seed-script idempotency.

Manual smoke test (also covered by the test suite, but useful to see live):
login (`POST /api/v1/auth/login`, form-encoded) → call `GET /api/v1/users`
with the access token → `POST /api/v1/auth/refresh` → `POST
/api/v1/auth/logout` → confirm the old refresh token is now rejected.

## Known stubs / deferred to later phases

- **Password reset email delivery** — the reset token is generated and
  audit-logged but not emailed (printed to stdout for local dev). Real
  delivery is the Notification Agent, a later phase.
- **MinIO** (resumes/certificates/offer letters) — Phase 3.
- **ChromaDB** (resume embeddings / semantic JD matching) — Phase 6.
- **Vacancy workflow & staff `role_category`** (Teaching/Non-Teaching/
  Housekeeping) — Phase 2. Deliberately a separate enum from this phase's
  user-access `role`, to avoid conflating "who can log in" with "what kind
  of position is being hired for."
- **AI agents / Hermes Orchestrator** (JD generation, resume screening,
  interview scheduling, natural-language queries) — Phase 4.
- **Dashboards / PPT reporting** — Phase 5.
- **n8n / Airtable / Gmail / Telegram interoperability & migration** —
  Phase 6.
- **Deployment hardening, load testing, VPS Docker deploy** — Phase 7.

## Notable Phase 1 design decisions

- `campuses.code` is a lookup-table column with a DB-level `CHECK` allowlist
  (exactly the 7 codes above), not a bare Postgres ENUM — campuses carry
  more attributes than a code, and a lookup table avoids ENUM-alteration
  pain if the campus list ever changes.
- User creation/update/deactivation is restricted to `SUPER_ADMIN` /
  `HR_ADMIN` in Phase 1; `CAMPUS_HOD` gets read-only visibility into their
  own campus plus full self-service via `PATCH /users/me`. The master spec
  doesn't fully define HOD user-management rights, so this is a deliberately
  conservative default.
- Audit logging is a service-helper pattern called explicitly from mutating
  routers (same DB transaction as the mutation), not ASGI middleware —
  middleware writing after `call_next()` fights the sync-session-per-request
  lifecycle.
- Tests run against a dedicated Postgres database with schema created via
  `Base.metadata.create_all()` rather than a full `alembic upgrade head` per
  run, for speed — worth revisiting once migrations get more complex.
