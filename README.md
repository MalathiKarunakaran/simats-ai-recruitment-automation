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
- **Phase 4 (done): Hermes Orchestrator** — a read-only natural-language
  assistant (Module 14) over a manual Claude tool-use loop, plus a daily HR
  briefing endpoint. Reporting/dashboards (Module 12) remain Phase 5.

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

143 tests, zero live calls to Anthropic/MinIO/ChromaDB (all three are
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

Phase 4 (14): campus-scoping correctness for both single-campus and
global-scope callers (the safety-critical property — a single-campus
caller's `campus_code` tool argument is always ignored), an invalid
`campus_code` from a global caller returning an empty result with an
explanatory `scope_note` rather than an error, parallel tool-use blocks in
one turn all executing, the 4-call iteration cap raising a clean `502`, a
reporting-flavored question passing through without forcing a tool call, an
unknown/bad tool name producing an `is_error` tool result instead of
crashing the loop, AI-error → 503/502 mapping, role gating, daily-briefing
stats scoping, and audit log correctness.

Manual/live smoke test (needs a real `ANTHROPIC_API_KEY` and the Docker
services running): `POST /vacancy-requests/{id}/generate-jd` and inspect
`jd_draft`; `POST /candidates/{id}/resume` (verified against real MinIO via
`docker exec simats_recruitment_minio mc ls local/resumes/...`) then
`POST /applications/{id}/screen` end-to-end against live MinIO + ChromaDB +
Anthropic. Without a key, `generate-jd`/`screen` return a clean `503 AI
features are not configured` rather than a raw 500 — verified live.

Live-verified without a key (Phase 4): `POST /assistant/query` and
`GET /assistant/daily-briefing` both return a clean `503` (the
`get_ai_client` dependency fails before the route body runs, so no audit
log is written for these — consistent with the Phase 3 AI-endpoint
convention); `CANDIDATE` role gets `403` on both; unauthenticated gets
`401`; both routes appear in `/openapi.json`.

Phase 5 (21): `average_time_to_hire_days`/`vacancy_closure_rate_pct` exact
correctness against a constructed scenario (not just "not None"), campus
scoping for both single-campus and global callers (narrowing via
`campus_code`), `role_category` filtering, all 7 report types' row
shapes/counts, unknown `report_type` → `404`, invalid `campus_code`/
`role_category` → `422`, `CANDIDATE` role → `403`, and both exports
(`.xlsx` loads back via `openpyxl` with the expected header row;
`.pptx` loads back via `python-pptx` with exactly 1 slide and the
expected title text).

Manual/live smoke test against the running dev server with seeded data (no
`ANTHROPIC_API_KEY` needed — Phase 5 makes no AI calls): `GET
/dashboard/kpis` as `hr.admin@example.com` (global) vs. `hod.sse@example.com`
(home-campus-only, confirmed the `scope_note` and narrower
`campus_wise_hiring`); `GET /reports/recruitment-funnel` and `GET
/reports/ad-briefing`; downloaded `GET /reports/vacancies/export` and `GET
/reports/ad-briefing/export` and opened both with `openpyxl`/`python-pptx`
to confirm they're valid, correctly-structured files matching the seeded
data (not just a `200` status).

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
- **Hermes is read-only and narrow in scope** — it answers questions and
  suggests the correct existing endpoint, but never itself calls a mutating
  endpoint. It does not centrally route Phase 3's *mutating* agent actions
  (JD generation, resume screening, interview scheduling) — those remain
  individually callable REST endpoints. A reporting-flavored question gets a
  clear "not available yet" answer rather than a best-effort guess.
- **AD-briefing PPT branding** — the actual current SIMATS AD-meeting PPT
  template, logo file, and exact brand hex codes weren't available; the
  export reproduces the described *structure* (navy/gold, single slide,
  campus × role-category table) with documented placeholder colors
  (`app/services/exports.py::_NAVY`/`_GOLD`) — swap in the real brand
  assets when available.
- **Report exports are `.xlsx` only** — no PDF export this phase.
- **No report history/persistence** — every report/KPI/export is generated
  on demand from live data and streamed directly in the response; nothing
  is written to MinIO.
- **No AI-narrated report endpoint** — Module 12's spec mentions Claude for
  report narration, but Phase 4's `GET /assistant/daily-briefing` already
  covers narrative-over-stats; Module 12 stays pure structured data +
  exports.
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

**Phase 4:**
- Hermes uses a **manual Claude tool-use loop** (`app/services/hermes.py::
  run_assistant_query`), not the Anthropic SDK's beta Tool Runner —
  `ai_client.py` doesn't use the beta namespace anywhere else, so a Tool
  Runner here would be an inconsistent one-off. Capped at 4 API calls per
  query; on the 4th call, if Claude still wants a tool, the endpoint returns
  a clean `502` rather than looping forever.
- **The single safety-critical function in this phase** is
  `hermes._resolve_campus_filter`: for a single-campus caller, any
  `campus_code` tool argument Claude passes is *always* ignored — the
  filter is always the caller's own `scope.campus_id`, regardless of what
  the model asked for. A global-scope caller's `campus_code` narrows the
  query; omitting it spans every campus. Every tool result carries a
  `scope_note` string stating exactly what filter was applied, and the
  system prompt instructs Claude to never claim broader coverage than that
  note states.
- An invalid `campus_code` from a global-scope caller is handled by
  filtering on a nil UUID (`uuid.UUID(int=0)`, never produced by
  `gen_random_uuid()`) rather than branching — it deterministically matches
  zero rows without a raised exception, keeping every executor's query-building
  code uniform.
- Tool executors are read-only queries over existing tables — no new DB
  tables, no query-history table. `AuditLog` (`action=ASSISTANT_QUERY` /
  `ASSISTANT_DAILY_BRIEFING`) is the system of record for "who asked what,"
  logged inline in the router the same way `LOGIN_SUCCESS`/`LOGIN_FAILED`
  are (no entity is mutated, so there's nothing for a service-layer
  `log_create`/`log_update` to attach to).
- A bad/unknown tool call (wrong tool name, invalid enum value, malformed
  UUID) is caught per-tool-use-block inside the loop and turned into an
  `is_error: true` tool result fed back to Claude, rather than crashing the
  whole query — Claude gets a chance to recover or explain the limitation.
- The daily briefing's narrative text is a **separate, single, non-tool
  call** (`ai_client.generate_narrative`) over already-computed stats, not
  routed through the tool-use loop — the numbers are deterministic DB
  aggregates, so there's nothing for Claude to look up.

**Phase 5:**
- Phase 4's `hermes._resolve_campus_filter` was extracted verbatim into a
  new `app/services/scoping.py::resolve_campus_filter` (+ `NO_CAMPUS_MATCH`
  sentinel) so this phase's `reporting.py` doesn't duplicate that
  safety-critical logic. `hermes.py` now imports from it; behavior is
  unchanged (all 14 Phase 4 tests still pass after the refactor).
- **REST-level validation, not Hermes's tolerate-and-degrade pattern.**
  Hermes's tools treat a bad `campus_code` as an empty result, because
  failing an LLM tool call mid-loop is worse than a graceful non-answer.
  Module 12/15's endpoints are direct human-facing REST calls, so an
  invalid `campus_code`/`role_category` gets a normal `422` instead —
  `reporting.validate_campus_code`/`validate_role_category` run at the
  router layer *before* `resolve_campus_filter`, so that helper's own
  `NO_CAMPUS_MATCH` empty-result branch is never exercised from these
  routers.
- **Module 12's report list folds to 7 shapes, not 8.** The spec names
  "recruitment" and "candidate status" reports separately, but both mean
  the same application-status funnel breakdown — merged into one
  `recruitment-funnel` report.
- **Metric definitions** (none are literal DB fields): `open_positions` =
  `HiringSlot` rows with `status == OPEN`; `time_to_hire_days` for one hire
  = `Application.applied_at.date()` → `JoiningRecord.actual_joining_date`,
  only for applications that reached `EMPLOYEE_CREATED`;
  `vacancy_closure_rate_pct` = `CLOSED / (APPROVED or PUBLISHED or CLOSED)
  * 100` — a vacancy still in `DRAFT`/`SUBMITTED`/`REJECTED` was never
  "closable" in the first place; `campus_wise_hiring` = `Employee` rows
  grouped by `campus_id`.
- `ReportResponse` uses **one generic `rows: list[dict]` shape** for all 7
  report types rather than 7 near-identical Pydantic row models — a
  pragmatic first cut; each builder documents its own row shape next to its
  function in `app/services/reporting.py`.
- No new DB tables, no persisted report/KPI history — every number here is
  a read-only aggregate query computed on demand, matching the spec's own
  "generated on demand from live data" framing.
