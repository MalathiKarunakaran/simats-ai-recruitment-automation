# CLAUDE.md

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
`anthropic` SDK (>=0.40, model `claude-opus-4-8` — Module 14 "Hermes" only),
`openai` SDK (>=1.55, model `gpt-4o` — JD generation/resume scoring/interview
questions), `pypdf`, `minio`, `chromadb`, `openpyxl`, `python-pptx`, `qrcode`.
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
ASSOCIATE_DEAN_RECRUITMENT, RECRUITMENT_OFFICER, CAMPUS_HOD,
INTERVIEW_PANEL_MEMBER, MANAGEMENT, CANDIDATE) is a distinct concept from
`StaffRoleCategoryEnum` (TEACHING/NON_TEACHING/HOUSEKEEPING — what kind of
position a vacancy hires for). Never conflate them. `app/core/deps.py`'s
`require_roles(*roles)` gates endpoints; `get_campus_scope` +
`enforce_campus_match` gate campus-scoped data — cross-campus access to a
single resource returns **404, not 403**, so an unauthorized caller can't
even confirm the resource exists. `GLOBAL_SCOPE_ROLES` (SUPER_ADMIN, HR_ADMIN,
ASSOCIATE_DEAN_RECRUITMENT, MANAGEMENT) see all campuses; everyone else is
scoped to `current_user.campus_id`.

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

# Postgres (5434) + MinIO (9000/9001) + ChromaDB (8012) — ports offset from
# defaults, see docker-compose.yml comments for why
docker compose up -d

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

- No live AI API keys configured in this dev environment — AI endpoints
  return 503 until `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` are set.
- No GitHub Actions CI — no `.github/workflows/` exists yet.
- `DEPLOYMENT.md`'s runbook was verified locally via Docker, never against a
  real remote VPS.
