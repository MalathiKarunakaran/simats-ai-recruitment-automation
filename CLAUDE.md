# CLAUDE.md

## Core Behavior
1. Don't assume. Don't hide confusion. Surface tradeoffs.
2. Minimum code that solves the problem. Nothing speculative.
3. Touch only what you must. Clean up only your own mess.
4. Define success criteria. Loop until verified.

## How I Work
- Plan before build — confirm approach in chat before generating files
- I prefer execution-ready output, not outlines or scaffolds
- When iterating, make targeted corrections — don't rewrite the whole thing

## Communication
- Ask before assuming scope on ambiguous requests
- If a task needs more than ~3 file changes, outline the plan first
- Flag when you're uncertain rather than picking silently

## Never
- Never touch .env, secrets, or credentials files without asking
- Never `git push --force` without explicit confirmation
- Never delete files outside the current task's scope
Instructions for Claude Code when working in this repository.

## Source spec

`reference/RTCFR Prompt.docx` (deliberately untracked — a binary Word file,
not code; moved out of the repo root into `reference/` 2026-08-06 alongside
`reference/my rowugh prompt.txt` and `reference/skill.md`, the user's other
untracked personal notes) is the original Role/Task/Context/Features/Result
brief this system was built from, covering all 15 modules and the 7-phase
build plan. Read it first if asked to check whether something is "in scope"
or matches the original design intent. **Resolved 2026-08-06**: the doc's "8 campuses: SSE,
SCLAS, SCAD, STUDIO, SPIER, SHOTS, SSPE, and others" line only ever named 7,
leaving an implied 8th unspecified — the user has since confirmed the 8th is
**SHIFT** ("a college and as well dept too"), now a real campus in
`app/models/enums.py`'s `CAMPUS_CODES` (migration `7b2e4f9a1c3d`). This is no
longer an open gap; don't re-flag it as one.

## What this is

SIMATS AI Recruitment Automation System: a campus-aware recruitment automation
platform for SIMATS (Saveetha Institute of Medical and Technical Sciences),
covering the full hiring lifecycle — vacancy requisition → multi-stage
approval (Dean → HR) → job posting/publishing → candidate application →
AI-assisted resume screening/ranking → interview scheduling and feedback →
offers → joining/onboarding → employee record creation — plus AI-assisted JD
generation, an AI assistant ("Hermes"), executive dashboards, and reporting.
Backend is a complete FastAPI app across 7 phases (all done); the frontend
(React/Vite/TS) is being built out on top of it module by module — check
`frontend/README.md` for which screens are live vs. placeholder before
assuming a page exists.

## Tech stack

Backend (`requirements.txt`): FastAPI (>=0.115), SQLAlchemy 2.0 (>=2.0.36),
Alembic (>=1.14), `psycopg[binary]` (>=3.2), Pydantic v2 (>=2.9) +
pydantic-settings, PyJWT (>=2.9), `argon2-cffi` (Argon2id password hashing),
`anthropic` SDK (>=0.40 — still a dependency, but dormant: `ai_client.py`'s
Anthropic call functions are unused code since Module 14 "Hermes" was
ported to OpenAI 2026-08-24 (no Anthropic key was available; kept in place
in case Anthropic is reintroduced later, not deleted),
`openai` SDK (>=1.55, model `gpt-4o` — JD generation/resume scoring/interview
questions, **and Module 14 "Hermes" as of 2026-08-24**, including its
tool-calling reporting chatbot), `pypdf`, `minio`, `chromadb`, `openpyxl`,
`python-pptx`, `qrcode`.
Python 3.14 (see `Dockerfile`). Postgres 16.

Frontend (`frontend/package.json`): React 19.2, Vite 8, TypeScript ~6.0 (project
references, not a single tsconfig — see the tsc footgun below), TanStack Query
5, React Router 7, Tailwind CSS 4 (`@tailwindcss/vite`), Radix UI primitives
(dialog/label/popover/select/slot), `class-variance-authority` + `clsx` +
`tailwind-merge` for the component-variant pattern, `lucide-react` icons.
Testing: Vitest 4 + Testing Library + jsdom. Lint: `oxlint`.

## Repo layout

- `app/api/v1/routers/` — one router per resource (auth, users, campuses,
  departments, audit_logs, vacancy_requests, approved_vacancies, job_postings,
  job_distribution, candidates, applications, offers, joining, employees,
  resume_screening, interviews, notifications, assistant, dashboard, reports,
  migration). Registered in `app/api/v1/api.py`.
- `app/core/` — `config.py` (pydantic-settings), `security.py` (password
  hashing, JWT, opaque tokens), `deps.py` (auth/RBAC/campus-scope FastAPI
  dependencies), `rate_limit.py` (in-memory sliding-window limiter),
  `security_headers.py` (hand-rolled security-headers middleware).
- `app/db/` — `session.py` (engine/session factory), `base.py`, `seed.py`.
- `app/models/` — SQLAlchemy models, one file per entity, plus `enums.py`
  (every native Postgres ENUM and role/status grouping lives here).
- `app/schemas/` — Pydantic request/response schemas.
- `app/services/` — business logic, one file per concern. `pipeline.py` and
  `vacancy_workflow.py` are the two state-machine choke points (see below).
  `ai_client.py` centralizes both AI providers' call/error-handling logic.
- `alembic/versions/` — migrations, one per phase roughly (`phase1_...`
  through `phase4_...` and beyond).
- `tests/` — pytest suite (`conftest.py` has the fixtures — see testing skill).
- `frontend/src/api/` — one typed API module per backend resource, all going
  through `client.ts`'s `apiFetch`/`apiFetchBlob`/`publicFetch`.
- `frontend/src/pages/` — one page (list/detail/create/edit) per module.
- `frontend/src/components/ui/` — hand-written shadcn/ui-style primitives
  (button, card, badge, input, select, textarea, dialog, popover, label).
- `frontend/src/components/<domain>/` — feature components (StatusBadge per
  domain, pickers, forms).
- `frontend/src/hooks/`, `frontend/src/auth/`, `frontend/src/campus/`,
  `frontend/src/theme/` — cross-cutting frontend concerns.

## Conventions actually in use

**RBAC**: `UserRoleEnum` in `app/models/enums.py` (SUPER_ADMIN, HR_ADMIN,
ASSOCIATE_DEAN_RECRUITMENT, RECRUITMENT_OFFICER, RECRUITMENT_COORDINATOR,
CAMPUS_HOD, INTERVIEW_PANEL_MEMBER, MANAGEMENT, CANDIDATE — nine, and
RECRUITMENT_COORDINATOR is the one this file used to omit) is a distinct
concept from
`StaffRoleCategoryEnum` (TEACHING/NON_TEACHING/HOUSEKEEPING — what kind of
position a vacancy hires for). Never conflate them. `app/core/deps.py`'s
`require_roles(*roles)` gates endpoints; `get_campus_scope` +
`enforce_campus_match` gate campus-scoped data — cross-campus access to a
single resource returns **404, not 403**, so an unauthorized caller can't
even confirm the resource exists. `GLOBAL_SCOPE_ROLES` (SUPER_ADMIN, HR_ADMIN,
ASSOCIATE_DEAN_RECRUITMENT, MANAGEMENT **and RECRUITMENT_COORDINATOR**) see
all campuses; everyone else is scoped to `current_user.campus_id`.

That last member is easy to miss and is user-visible: **a Recruitment
Coordinator sees every campus, not their assigned one.** The only narrowing
that reaches them is `get_department_scope` (`user_department_scope` rows, PUT
`/users/{id}/department-scope`), which by design only restricts users who are
already globally scoped. Making a coordinator campus-scoped means taking them
out of `GLOBAL_SCOPE_ROLES`, which changes every module at once — raised with
the user 2026-08-31 and deliberately NOT done. Don't do it as a side effect of
some other change.

**Department categories are a SET, and every check is membership**: a
department is a place, not a staff category -- CSE employs Assistant
Professors (TEACHING) and Lab Assistants (NON_TEACHING) at the same time. So
`Department.supported_categories` is a Postgres array (NOT NULL, non-empty by
CHECK constraint), while `Designation.category` stays single-valued and is
the authoritative category for recruitment. **Never write
`designation.category == department.category`** -- that equality was the
original bug (2026-08-28, migration `e1f2a3b4c5d6`): it rejected every
NON_TEACHING designation on a department the old backfill had labelled
TEACHING. Use `Department.supports(category)`, the one helper all four
validation sites share (`designations.py`, `designation_import.py`,
`sanctioned_strength.py`, `sanctioned_strength_import.py`). Consequence for
list endpoints: per-category tab counts now OVERLAP and no longer sum to
`ALL`, which is a distinct department count -- a multi-category department
must appear once, never duplicated per category.

**State-machine choke points**: `app/services/vacancy_workflow.py` is the only
code allowed to move a `VacancyRequest` through
DRAFT → SUBMITTED → DEAN_APPROVED → APPROVED → PUBLISHED → CLOSED (or
REJECTED), and it alone creates `ApprovedVacancy`/`HiringSlot` rows (at HR's
final approval) and `JobPosting` rows (at explicit publish).
`app/services/pipeline.py`'s `transition_application_status()` /
`advance_if_behind()` is the single choke point for `Application.status` and
`HiringSlot` reserve/release/fill, including vacancy auto-close when the last
slot fills. Routers (applications, offers, joining, interviews) call into
these — never mutate `.status` directly in a router.

**AI 503-degradation pattern**: `app/services/ai_client.py`'s
`get_ai_client()`/`get_openai_client()` are FastAPI dependencies that raise
`HTTPException(503, "AI features are not configured (...API_KEY is not
set)")` when the relevant key is unset, rather than letting the SDK fail with
an unhandled `TypeError`/500 on first use. Both providers' real API errors
(`RateLimitError` → 503, `APIConnectionError`/`APIStatusError` → 502) are
mapped centrally in `_call`/`_call_openai`. Tests override these dependencies
with `FakeAnthropicClient`/`FakeOpenAIClient` (`tests/conftest.py`) — no test
ever makes a live AI call.

**Frontend mirrors backend guard clauses**: nav visibility
(`frontend/src/components/layout/AppShell.tsx`'s `NAV_ITEMS[].visibleForRoles`)
and page-level role checks are deliberately kept in sync with the backend's
actual RBAC gates (e.g. Offers nav only shown to HR_ADMIN/SUPER_ADMIN/
MANAGEMENT, mirroring `offers.py`'s own role gate) — these are UX affordances
only, not a security boundary; the backend re-checks everything.

**`tsc -b --force` vs `tsc --noEmit` footgun**: `frontend/tsconfig.json` is a
solution file with `"files": []` and references to `tsconfig.app.json` /
`tsconfig.node.json` (TS project references). Running `tsc --noEmit` at the
root silently type-checks **zero files** and exits 0 even with real type
errors present. Always use `npx tsc -b --force` (matches what `npm run
build` does via `tsc -b && vite build`); `--force` avoids stale
`.tsbuildinfo` incremental-build state hiding errors between runs.

## Running locally

```bash
# Backend deps (existing venv/, Python 3.14)
venv/Scripts/python.exe -m pip install -r requirements-dev.txt
cp .env.example .env   # then edit JWT_SECRET_KEY etc.

# Postgres: runs as a NATIVE Windows service (postgresql-x64-18) on the
# default port 5432 — Docker Desktop was uninstalled from this machine
# 2026-08-05, so `docker compose up -d` does NOT work for local dev and
# `docker` is not on PATH at all. (Postgres was on 5434 back when it ran in
# Docker; .env's DATABASE_URL already points at 5432.) docker-compose.yml is
# still real and still used — but for PRODUCTION on the Hostinger VPS only,
# see DEPLOYMENT.md.
#
# MinIO (9000/9001) and ChromaDB (8012) are NOT running locally. Everything
# that touches them degrades gracefully rather than erroring: bulk-upload
# archival falls back to a `storage_warning` in the response (see commit
# c81ceb4), so the whole master-data/bulk-upload surface is fully testable
# locally without them. Start them separately only if working on resume
# storage or semantic matching specifically.

venv/Scripts/python.exe -m alembic upgrade head
venv/Scripts/python.exe -m app.db.seed        # idempotent
venv/Scripts/python.exe -m uvicorn app.main:app --reload
# -> http://127.0.0.1:8000/docs

# Frontend
cd frontend && npm install && npm run dev
# -> http://localhost:5173 (CORS_ALLOWED_ORIGINS in .env.example already allows this)
```

## Testing

```bash
# Backend — needs a one-time `CREATE DATABASE simats_recruitment_test`
venv/Scripts/python.exe -m pytest -v

# Frontend
cd frontend
npx tsc -b --force     # NOT `tsc --noEmit` — see footgun above
npm run test           # vitest run
```

170+ backend tests (`tests/`, one file per router/concern), 78+ frontend
tests (Vitest + Testing Library, `*.test.tsx` colocated with components/pages).
Backend tests never hit live Anthropic/OpenAI/MinIO/ChromaDB — all four are
FastAPI-injectable dependencies overridden with in-memory fakes in
`tests/conftest.py`.

## Known gaps (be honest about these, don't paper over them)

- No live `ANTHROPIC_API_KEY` anywhere (local dev or production) — moot for
  Module 14 "Hermes" since its 2026-08-24 port to OpenAI, but still means
  no other Anthropic-backed feature could be added without one.
  `OPENAI_API_KEY` **is** configured in production (JD generation, resume
  scoring, interview questions, and now Hermes all work live there) but is
  not set in local `.env` — those endpoints return 503 in local dev until
  it's added there too.
- **Resolved 2026-08-27**: CI now exists — `.github/workflows/ci.yml`, three
  independent jobs on every push/PR to `master`: `backend` (pytest against a
  real Postgres 16 service), `frontend` (`tsc -b --force`, oxlint, Vitest),
  and `migrations` (`alembic upgrade head` against an empty DB, a
  single-head check, and `scripts/check_schema_drift.py`). That last job is
  not redundant with `backend`: `tests/conftest.py` builds its schema with
  `Base.metadata.create_all`, so the migration chain is otherwise never
  exercised even though production applies it on every deploy. The drift
  check filters one known alembic false positive (Postgres implements a
  UNIQUE constraint as a unique index, so every `unique=True` column reports
  a spurious remove_index/add_constraint pair) — see that script's docstring
  before "fixing" it.
- **Resolved 2026-08-23**: `DEPLOYMENT.md`'s runbook is now verified live —
  `backend`, `frontend`, `postgres`, `minio`, `chromadb` all run in
  production via `docker-compose.yml` on a Hostinger VPS
  (`srv1922215.hstgr.cloud`), reachable at `https://api.malathi.io` and
  `https://app.malathi.io`. The reverse proxy (Caddy) is a pre-existing
  host-level install on that VPS, not managed by this repo's tooling —
  see `DEPLOYMENT.md` section 6 before assuming a from-scratch
  reverse-proxy setup has been exercised end-to-end. That section also
  documents a real incident (2026-08-23, resolved): `app.malathi.io`'s
  Caddy block was serving a stale on-disk static snapshot instead of
  proxying to the `frontend` container, so container rebuilds silently
  never reached the live domain — check there first if a deploy looks
  "done" but a live domain doesn't reflect it.
- The production frontend Docker build uses `npm install`, not `npm ci` —
  the committed `package-lock.json` was generated on Windows, and `npm
  ci`'s strict lockfile-fidelity check miscomputes native optional
  binaries (Rolldown/lightningcss) when installing on Linux (npm/cli#4828).
