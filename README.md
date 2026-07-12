# SIMATS AI Recruitment Automation System

A 15-module, 7-phase recruitment automation platform for SIMATS (8 campuses,
3 staff categories: Teaching / Non-Teaching / Housekeeping). Built phase by
phase, each phase reviewed before the next begins.

- **Phase 1 (done): Foundation** — DB schema, JWT auth, campus-scoped RBAC,
  base FastAPI skeleton.
- **Phase 2 (done): Core Workflow** — Vacancy Requisition & Approval,
  Candidate Pipeline, Offers, Joining & Onboarding, Auto-Closure Engine
  (Modules 2, 7, 9, 10, 11). No AI yet.
- **Phase 3 (done): AI Agents** — JD Generation, AI Resume Screening,
  Interview Management, Notifications (Modules 3, 6, 8, 13), each callable
  directly (no central orchestrator yet — that's Phase 4's Hermes
  Orchestrator). First phase touching real external services: Anthropic,
  MinIO, ChromaDB.

## Stack

FastAPI + SQLAlchemy 2.0 + PostgreSQL 16 + Alembic + JWT (PyJWT) + Argon2id
password hashing + Anthropic SDK (`claude-opus-4-8`) + MinIO + ChromaDB.
Backend-only; verified via Swagger UI (`/docs`) and pytest.

## Prerequisites

- Docker Desktop (for Postgres, MinIO, ChromaDB)
- The existing `venv/` (Python 3.14, already created)
- An Anthropic API key (optional — the app and full test suite run without
  one; only the live JD-generation and resume-screening endpoints need it)

## Setup

```bash
# 1. Install dependencies
venv/Scripts/python.exe -m pip install -r requirements-dev.txt

# 2. Configure environment
cp .env.example .env
# Edit .env: set SEED_SUPER_ADMIN_EMAIL to your own email if you want to log
# in as yourself, generate a real JWT_SECRET_KEY:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
# and set ANTHROPIC_API_KEY if you want to exercise the live AI endpoints.

# 3. Start Postgres + MinIO + ChromaDB
docker compose up -d
# Ports: Postgres 5434, MinIO 9000 (API) / 9001 (console), ChromaDB 8012 --
# all offset from defaults because this machine runs other unrelated
# containers on 5432/5433/8000/8001/3000/3001.

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
  (`hod.sse@example.com` @ SSE, `hod.scad@example.com` @ SCAD) and **two
  different-campus interview panel members** (`panel.member.sse@example.com`,
  `panel.member.scad@example.com`).
- **Three Phase 2 vacancy scenarios**, run through the real service layer:
  1. *Full happy path* at SSE — "Assistant Professor", 2 slots. Candidate A
     goes all the way through offer → joining → onboarding → employee
     creation (`SSE-0001`). Candidate B is Selected then Rejected (slot
     release). Candidate C re-reserves that freed slot and goes straight to
     Joined, triggering **auto-close**.
  2. *Mid-chain* at SCAD — "Lab Assistant" left at `SUBMITTED`.
  3. *Early rejection* at SSE — "Guest Lecturer" driven straight to `REJECTED`.
- **Three Phase 3 additions**, layered onto the scenarios above:
  1. A `DRAFT` vacancy ("Housekeeping Supervisor" @ SSPE) with a **hardcoded
     example `jd_draft`** — demonstrates the human-in-the-loop DRAFT-editable
     state without a live Anthropic call from seed data.
  2. A **directly-constructed `ResumeScore`** for Candidate A's (Alice)
     application — plausible hardcoded values, not a live AI/MinIO/ChromaDB
     call (seeding must never depend on or cost a live API key).
  3. A **real interview scheduling → panel feedback → completion** flow
     against Alice's application, via the actual `interviews` service.

## Verification

```bash
# Unit/integration tests (uses a separate simats_recruitment_test DB)
docker exec simats_recruitment_postgres psql -U simats_app -d simats_recruitment -c "CREATE DATABASE simats_recruitment_test"  # one-time
venv/Scripts/python.exe -m pytest -v
```

108 tests, zero live calls to Anthropic/MinIO/ChromaDB (all three are
FastAPI-injectable dependencies, overridden with in-memory fakes in
`tests/conftest.py` — see `fake_ai_client`/`fake_minio_client`/
`fake_chroma_collection` — so the suite is fast, free, and deterministic).

Phase 1 (35): auth flows, campus-scoped RBAC (404 not 403 on cross-campus
access), audit log correctness, seed idempotency.

Phase 2 (41): the hiring-slot/auto-close suite (slot reserve/release/fill,
skip-ahead vs. backward transitions, `force`-only terminal-status exits,
`VACANCY_AUTO_CLOSE` on last-slot-fill), the full approval chain, offer
side effects on the pipeline, joining/onboarding preconditions, sequential
employee codes.

Phase 3 (32): JD generation (role/campus/DRAFT-only gating, AI-error → 502
mapping), resume screening (happy path, duplicate detection via a
near-identical-text fake ChromaDB match, incomplete-profile flagging for a
too-short resume or missing phone, AI-error → 503 on rate-limit), candidate
ranking (score-descending order with `NULL`s last, campus scoping),
interview scheduling (panel-must-be-same-campus, pipeline status advance,
duplicate-feedback 409, `teaching_demo_score` only kept for `TEACHING`
role_category), and notification creation at every wired call site
(`notify`/`notify_role` fan-out, campus filtering for single-campus roles).

Manual/live smoke test (needs a real `ANTHROPIC_API_KEY` and the Docker
services running): `POST /vacancy-requests/{id}/generate-jd` and inspect
`jd_draft`; `POST /candidates/{id}/resume` (verified against real MinIO via
`docker exec simats_recruitment_minio mc ls local/resumes/...`) then
`POST /applications/{id}/screen` end-to-end against live MinIO + ChromaDB +
Anthropic. Without a key, `generate-jd`/`screen` return a clean `503 AI
features are not configured` rather than a raw 500 — verified live.

## Known stubs / deferred to later phases

- **Offer letters** — structured DB data only (salary, joining date, terms,
  status). No PDF/document rendering yet.
- **Password reset email delivery** — the reset token is generated and
  audit-logged but not emailed (printed to stdout for local dev).
- **Notification delivery (Module 13)** — the full agent interface is real
  (DB rows, trigger points wired into every workflow transition, campus/role
  fan-out), but delivery is a log-only stub (`status=SENT` immediately,
  printed to stdout). Real Gmail/Telegram sending via n8n is Phase 6.
- **JD generation prompt** — a best-effort RTCFR-structured system prompt
  reconstructed for this build. The actual n8n JD-generation prompt template
  referenced in the master spec was not available; `RTCFR Prompt.docx` in
  this repo is the *meta*-prompt used to instruct the build itself, not a
  JD template.
- **Interview meeting links** — HR manually pastes a link (e.g. a Google
  Meet/Zoom link they created themselves). No calendar/video API integration.
- **Joining documents** — still metadata-only stub rows (unchanged from
  Phase 2); real upload wiring to MinIO for these specifically hasn't been
  added (only Candidate resumes use the new MinIO integration).
- **Candidate self-service portal (Module 5)** — not assigned to any of the
  7 phases in the master spec; applications/resumes are recorded internally
  by Recruitment Officer/HR Admin via API. Deferred alongside the frontend.
- **Hermes Orchestrator / natural-language query routing** — Phase 4. Phase
  3's agents are individually callable REST endpoints, not yet centrally
  routed.
- **Dashboards / PPT reporting** — Phase 5.
- **n8n / Airtable / Gmail / Telegram interoperability & migration, external
  job-portal posting (Module 4)** — Phase 6.
- **Deployment hardening, load testing, VPS Docker deploy** — Phase 7.

## Notable design decisions

**Phase 1:**
- `campuses.code` is a lookup-table column with a DB-level `CHECK` allowlist
  (exactly the 7 codes above), not a bare Postgres ENUM.
- User creation/update/deactivation is restricted to `SUPER_ADMIN` /
  `HR_ADMIN`; `CAMPUS_HOD` gets read-only visibility into their own campus
  plus full self-service via `PATCH /users/me`.
- Audit logging is a service-helper pattern called explicitly from mutating
  routers (same DB transaction as the mutation), not ASGI middleware.
- Tests run against a dedicated Postgres database with schema created via
  `Base.metadata.create_all()` rather than a full `alembic upgrade head` per
  run, for speed.

**Phase 2:**
- Vacancies are modeled as five genuinely decomposed tables — VacancyRequest
  → ApprovedVacancy → JobPosting → Application → HiringSlot — not status
  flags on one row.
- `VacancyRequestStatusEnum` adds a `DEAN_APPROVED` intermediate state not
  literally named in the master spec's 6 statuses.
- `app/services/pipeline.py` is the single choke point for every
  `Application` status change and all hiring-slot reserve/release/fill/
  auto-close logic (Module 11).
- `app/db/session.py`'s `SessionLocal` uses `autoflush=True` (changed from
  Phase 1) — Phase 2's services chain multiple writes-then-reads within one
  transaction, and without autoflush a re-query can silently see stale data.
- `StaffRoleCategoryEnum` (Teaching/Non-Teaching/Housekeeping) is a
  deliberately separate enum from `UserRoleEnum`.

**Phase 3:**
- Every Claude call goes through `app/services/ai_client.py` — never import
  `anthropic` directly elsewhere. Model is `claude-opus-4-8` for every call.
  Structured outputs via `output_config.format.json_schema` (not deprecated
  `output_format`, not assistant-turn prefill — prefill 400s on this model).
  Adaptive thinking (`thinking: {"type": "adaptive"}`) for resume scoring
  (real reasoning over qualifications/skills); no thinking for JD/question
  generation (straightforward generative tasks).
- `get_ai_client()`/`get_minio_client()`/`get_chroma_collection()` are
  FastAPI-injectable dependencies (not module-level singletons) specifically
  so tests can override them with in-memory fakes — the same pattern Phase 1
  established for `get_db`.
- An empty/unset `ANTHROPIC_API_KEY` is checked explicitly in `get_ai_client`
  and fails with a clean `503`, not a raw `500` — the Anthropic SDK's own
  failure mode for a missing key is a plain `TypeError`, not an
  `anthropic.AnthropicError` subclass, so it wouldn't have been caught by
  `ai_client._call`'s exception mapping otherwise. Found and fixed via live
  testing without a real key configured.
- ChromaDB, not Claude, computes semantic resume/JD similarity — Anthropic
  has no public embeddings endpoint. ChromaDB's own default embedding
  function handles it; the distance-to-similarity-percent conversion is a
  documented approximation, one signal among several in Claude's own scoring
  call, not a precise metric on its own.
- Resume extraction + scoring are **one combined Claude call**
  (`score_and_extract_resume`), not two — both tasks read the same
  resume+JD context, so combining avoids doubling token cost/latency.
- `InterviewPanelAssignment` is a join table, not a `HiringSlot.skills`-style
  Postgres `ARRAY` column — panel members need individually addressable
  `InterviewFeedback` rows with a uniqueness constraint per panelist, which
  an array can't carry.
- Candidate ranking is per-`JobPosting` (the applicant pool), not "per
  hiring slot" — slots are anonymous/interchangeable until an `Application`
  reaches `SELECTED`, so a literal per-slot ranking isn't meaningful.
- **Correction of a Phase 1 mistake**: Phase 1's docker-compose comment
  assumed ChromaDB was a Phase 6 concern. That was wrong — Module 6 (Resume
  Screening) needs it and Module 6 is explicitly Phase 3. Fixed here rather
  than carried forward silently.
- The `chromadb/chroma` Docker image ships neither `curl` nor `wget`, so its
  healthcheck uses `bash`'s `/dev/tcp` to make a raw HTTP request instead —
  and must invoke `bash` explicitly (`CMD`, not `CMD-SHELL`), since
  `CMD-SHELL` runs `/bin/sh` (`dash` on this image), which doesn't support
  `/dev/tcp`. Found and fixed by testing the healthcheck live, not assumed.
