# SIMATS AI Recruitment Automation System

A 15-module, 7-phase recruitment automation platform for SIMATS (8 campuses,
3 staff categories: Teaching / Non-Teaching / Housekeeping). Built phase by
phase, each phase reviewed before the next begins.

- **Phase 1 (done): Foundation** — DB schema, JWT auth, campus-scoped RBAC,
  base FastAPI skeleton.
- **Phase 2 (done): Core Workflow** — Vacancy Requisition & Approval,
  Candidate Pipeline, Offers, Joining & Onboarding, Auto-Closure Engine
  (Modules 2, 7, 9, 10, 11). No AI yet, no MinIO yet, no frontend yet — see
  "Known stubs" below.

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
- **Three Phase 2 vacancy scenarios**, run through the real service layer
  (not hand-rolled shortcuts) so seeding doubles as a smoke test:
  1. *Full happy path* at SSE — "Assistant Professor", 2 slots. Candidate A
     goes all the way through offer → joining → onboarding → employee
     creation (`SSE-0001`). Candidate B is Selected then Rejected (exercises
     slot release). Candidate C re-reserves that freed slot and goes
     straight to Joined, filling the vacancy's last slot and triggering
     **auto-close** (`VacancyRequest.status = CLOSED`).
  2. *Mid-chain* at SCAD — "Lab Assistant" left at `SUBMITTED`, for manually
     exploring dean-approve/reject in Swagger.
  3. *Early rejection* at SSE — "Guest Lecturer" driven `SUBMITTED → REJECTED`
     directly (Dean-stage rejection, distinct from scenario 1's later
     offer-stage rejection).

## Verification

```bash
# Unit/integration tests (uses a separate simats_recruitment_test DB)
docker exec simats_recruitment_postgres psql -U simats_app -d simats_recruitment -c "CREATE DATABASE simats_recruitment_test"  # one-time
venv/Scripts/python.exe -m pytest -v
```

76 tests. Phase 1 (35): login/refresh/logout/password-reset flows, Super
Admin/Associate Dean global visibility, **Campus HOD list/detail scoped to
their own campus with a 404 — not 403 — on cross-campus access**, role-gated
user/campus/department writes, audit log correctness (no plaintext password
ever logged), seed idempotency.

Phase 2 (41), most importantly the hiring-slot/auto-close suite
(`test_hiring_slots_pipeline.py`): Selecting an application reserves an
`OPEN` slot and 409s when none remain; Rejecting a Selected/Offer-stage
application releases its slot; skip-ahead transitions are allowed but
backward moves without `force` are 409; `REJECTED` requires a reason and is
reachable from any non-terminal status; terminal statuses can't be exited
without `force=true`, which is Super-Admin-only and audit-logged under a
distinct action (`APPLICATION_STATUS_FORCE_CORRECTION`); filling the last
open slot auto-closes the `ApprovedVacancy`/`JobPosting`/`VacancyRequest` and
writes a `VACANCY_AUTO_CLOSE` audit row. Plus: the full approval chain
(HOD→Dean→HR, with Super Admin able to skip the Dean stage), offer
send/accept/decline/withdraw side effects on the pipeline, joining/onboarding
preconditions (can't complete onboarding with pending documents, can't
create an employee before onboarding is complete), sequential per-campus
employee codes, and campus/role scoping throughout.

Manual smoke test (also covered by the test suite, but useful to see live):
login → `POST /vacancy-requests` → `.../submit` → `.../dean-approve` →
`.../hr-approve` (creates N `HiringSlot`s) → `.../publish` (creates a
`JobPosting`) → `POST /candidates` → `POST /applications` → walk the
application through `PATCH /applications/{id}/status` to `SELECTED` →
`JOINED` and confirm the slot fills and the vacancy auto-closes once every
slot is filled, visible via `GET /approved-vacancies/{id}/hiring-slots` and
`GET /audit-logs`.

## Known stubs / deferred to later phases

- **File uploads (resumes, joining documents)** — metadata-only stub rows
  (type, status PENDING/RECEIVED, nullable `storage_key`). No upload
  endpoint yet. Real upload wired to MinIO in Phase 3.
- **Offer letters** — structured DB data only (salary, joining date, terms,
  status). No PDF/document rendering yet.
- **Password reset email delivery** — the reset token is generated and
  audit-logged but not emailed (printed to stdout for local dev).
- **Automated offer/reminder emails** — log-only stub; real delivery is the
  Notification Agent (Module 13), Phase 3.
- **MinIO** (resumes/certificates/offer letters) — Phase 3.
- **ChromaDB** (resume embeddings / semantic JD matching) — Phase 6.
- **Candidate self-service portal (Module 5)** — not assigned to any of the
  7 phases in the master spec; applications are recorded internally by
  Recruitment Officer/HR Admin via API instead. Deferred alongside the rest
  of the frontend.
- **AI agents / Hermes Orchestrator** (JD generation, resume screening,
  interview scheduling, natural-language queries) — Phase 4.
- **Dashboards / PPT reporting** — Phase 5.
- **n8n / Airtable / Gmail / Telegram interoperability & migration, external
  job-portal posting (Module 4)** — Phase 6.
- **Deployment hardening, load testing, VPS Docker deploy** — Phase 7.

## Notable design decisions

**Phase 1:**
- `campuses.code` is a lookup-table column with a DB-level `CHECK` allowlist
  (exactly the 7 codes above), not a bare Postgres ENUM — campuses carry
  more attributes than a code, and a lookup table avoids ENUM-alteration
  pain if the campus list ever changes.
- User creation/update/deactivation is restricted to `SUPER_ADMIN` /
  `HR_ADMIN`; `CAMPUS_HOD` gets read-only visibility into their own campus
  plus full self-service via `PATCH /users/me`.
- Audit logging is a service-helper pattern called explicitly from mutating
  routers (same DB transaction as the mutation), not ASGI middleware —
  middleware writing after `call_next()` fights the sync-session-per-request
  lifecycle.
- Tests run against a dedicated Postgres database with schema created via
  `Base.metadata.create_all()` rather than a full `alembic upgrade head` per
  run, for speed — worth revisiting once migrations get more complex.

**Phase 2:**
- Vacancies are modeled as five genuinely decomposed tables — VacancyRequest
  → ApprovedVacancy → JobPosting → Application → HiringSlot — not status
  flags on one row. A single HR approval for N posts creates N `HiringSlot`
  rows; each `Application` reserves exactly one slot (at the `SELECTED`
  transition).
- `VacancyRequestStatusEnum` adds a `DEAN_APPROVED` intermediate state not
  literally named in the master spec's 6 statuses, needed to distinguish
  "Dean approved, awaiting HR" from the spec's single "Approved" (HR's
  *final* approval — the moment `ApprovedVacancy` + `HiringSlot`s exist).
- `app/services/pipeline.py` is the single choke point for every
  `Application` status change and all hiring-slot reserve/release/fill/
  auto-close logic (Module 11) — the Applications, Offers, and Joining
  routers all call into it rather than duplicating slot-state logic.
  Skip-ahead transitions are allowed (e.g. Shortlisted straight to
  Selected); backward moves require `force=true`, restricted to
  `SUPER_ADMIN` and logged under a distinct audit action.
- `app/db/session.py`'s `SessionLocal` was changed from `autoflush=False`
  (Phase 1's setting) to `autoflush=True` (SQLAlchemy's default) — Phase 2's
  services chain multiple writes-then-reads within one transaction (e.g.
  reserve a slot, then later in the same request re-query for that
  reservation), and without autoflush that re-query can silently see
  stale pre-write state.
- `StaffRoleCategoryEnum` (Teaching/Non-Teaching/Housekeeping) is a
  deliberately separate enum from Phase 1's `UserRoleEnum` — one is "what
  kind of position is being hired for," the other is "who can log in and do
  what." Never conflate the two.
