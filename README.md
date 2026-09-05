# SIMATS AI Recruitment Automation System

A campus-aware recruitment automation platform for SIMATS (Saveetha
Institute of Medical and Technical Sciences), covering the full hiring
lifecycle: vacancy requisition → multi-stage approval (Dean → HR) → job
posting/publishing → candidate application → AI-assisted resume
screening/ranking → interview scheduling and feedback → offers → joining →
department/room allotment → orientation → hand-over to HOD, plus
AI-assisted JD generation, an AI assistant ("Hermes"), executive dashboards
with charts, and reporting/exports.

**Status: full stack, both sides complete.** Backend is a finished FastAPI
app across 7 build phases. Frontend (React + Vite + TypeScript) covers all
15 modules end to end, rebuilt once to match the institution's actual
manual hiring process (not just a generic automated flow), and every
sidebar page has since been reviewed at least once for filtering, unwired
backend capability, and role-visibility correctness. See
[`HISTORY.md`](HISTORY.md) for the detailed phase-by-phase backend build
log and design-decision narrative, and [`frontend/README.md`](frontend/README.md)
for frontend-specific notes.

## Tech stack

**Backend**: FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL 16, PyJWT +
Argon2id password hashing, Anthropic SDK (Hermes assistant only) and
OpenAI SDK (JD generation / resume scoring / interview questions), MinIO
(resume storage), ChromaDB (resume/JD similarity), `pypdf`, `openpyxl` +
`python-pptx` (report exports), `qrcode`. Python 3.14.

**Frontend**: React 19, Vite, TypeScript (project references — see the
`tsc` note below), TanStack Query, React Router, Tailwind CSS v4, Radix UI
primitives, Recharts (dashboard charts), Vitest + Testing Library.

## Repo layout

- `app/` — the FastAPI backend (`api/v1/routers/`, `core/`, `db/`,
  `models/`, `schemas/`, `services/`). See `CLAUDE.md` for the full
  breakdown, including the two state-machine choke points
  (`vacancy_workflow.py`, `pipeline.py`) that own every status transition.
- `alembic/versions/` — database migrations.
- `tests/` — the pytest suite (one file per router/concern).
- `frontend/` — the React/Vite/TS staff console (`src/api/`, `src/pages/`,
  `src/components/`).
- `data/` — the generated recruitment-tracker import template.
- `scripts/` — one-off/maintenance scripts (e.g. load testing, template
  generation).
- `CLAUDE.md` — the authoritative reference for conventions, RBAC rules,
  and known gaps if you're extending this codebase.
- `DEPLOYMENT.md` / `LOAD_TEST_RESULTS.md` — Docker deployment runbook and
  load-test findings.

## Prerequisites

- Docker Desktop (Postgres, MinIO, ChromaDB)
- Python 3.14 and Node.js (for the frontend)
- An OpenAI API key (optional — JD generation / resume screening /
  interview-question generation return a clean `503` without one) and/or
  an Anthropic API key (optional — the Hermes assistant needs one)

## Setup

### Backend

```bash
# 1. Create a venv and install dependencies
python -m venv venv
venv/Scripts/python.exe -m pip install -r requirements-dev.txt   # Windows
# venv/bin/python -m pip install -r requirements-dev.txt         # macOS/Linux

# 2. Configure environment
cp .env.example .env
# Edit .env: generate a real secret with
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
# and set JWT_SECRET_KEY. Set SEED_SUPER_ADMIN_EMAIL to your own email if
# you want to log in as yourself. OPENAI_API_KEY/ANTHROPIC_API_KEY are
# optional -- the app and full test suite run fine without them.

# 3. Start Postgres + MinIO + ChromaDB (ports are offset from Postgres/MinIO
# defaults -- see docker-compose.yml comments for why)
docker compose up -d

# 4. Apply migrations
venv/Scripts/python.exe -m alembic upgrade head

# 5. Seed data (idempotent -- safe to re-run)
venv/Scripts/python.exe -m app.db.seed
# Prints a one-time Super Admin password if SEED_SUPER_ADMIN_PASSWORD is unset.

# 6. Run the API
venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/docs for the interactive Swagger UI.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # VITE_API_BASE_URL, defaults to http://localhost:8000/api/v1
npm run dev                  # http://localhost:5173
```

The backend's `.env` needs `CORS_ALLOWED_ORIGINS` to include
`http://localhost:5173` (already the case in `.env.example`) or the
browser will block the cross-origin API calls.

### Seeded test logins

All sample users share one password: `SEED_SAMPLE_USER_PASSWORD` in
`.env`, default `DevPass123!`. Super Admin's password is either what you
set in `SEED_SUPER_ADMIN_PASSWORD` or a one-time value printed at seed
time.

| Email | Role |
|---|---|
| (from `SEED_SUPER_ADMIN_EMAIL`, default `superadmin@example.com`) | Super Admin |
| `hr.admin@example.com` | HR Admin |
| `associate.dean@example.com` | Associate Dean (Recruitment) |
| `management@example.com` | Management |
| `hod.sse@example.com` / `hod.scad@example.com` | Campus HOD (two different campuses) |
| `recruitment.officer.sse@example.com` | Recruitment Officer |
| `panel.member.sse@example.com` / `panel.member.scad@example.com` | Interview Panel Member (two different campuses) |
| `candidate@example.com` | Candidate |

## Testing

```bash
# Backend -- one-time: CREATE DATABASE simats_recruitment_test
venv/Scripts/python.exe -m pytest -v

# Frontend
cd frontend
npx tsc -b --force   # NOT `tsc --noEmit` -- see the note below
npm run test
```

End-to-end (Playwright, `e2e/`) runs in CI against the built bundle on
every push. To run it locally against a dev stack seeded the same way:

```bash
venv/Scripts/python.exe -m app.db.seed
venv/Scripts/python.exe -m scripts.e2e_seed          # fixture master data the specs discover
E2E_TOKENS="$(venv/Scripts/python.exe scripts/e2e_mint_tokens.py)"   E2E_BASE_URL=http://localhost:5173 npx playwright test
```

243 backend tests, 181 frontend tests (32 files), all passing as of this
README. Backend tests never make a live call to Anthropic/OpenAI/
MinIO/ChromaDB — all four are FastAPI-injectable dependencies overridden
with in-memory fakes in `tests/conftest.py`.

**`tsc` footgun**: `frontend/tsconfig.json` is a project-reference solution
file with `"files": []`. Running bare `npx tsc --noEmit` silently
type-checks *zero files* and exits `0` even with real type errors present.
Always use `npx tsc -b --force` (what `npm run build` already does)
from inside `frontend/`.

## Known gaps

- No live AI API keys are required to run or test this app, but JD
  generation / resume screening / interview-question generation / Hermes
  all return a clean `503` until `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are
  set.
- CI (`.github/workflows/ci.yml`) runs pytest, the frontend checks, the
  migration chain and the Playwright suite on every push; it does not
  deploy — see `DEPLOYMENT.md` for the manual deploy steps.
- `DEPLOYMENT.md`'s Docker runbook was verified locally; it has not been
  run against a real remote VPS.
- The original spec mentions 8 campuses but only names 7 — the system
  implements exactly those 7 (`app/models/enums.py::CAMPUS_CODES`). This
  is an intentional, documented spec-vs-build gap, not a bug.

See `CLAUDE.md` for the full set of repo conventions (RBAC, state-machine
choke points, AI-client degradation pattern) if you're extending this
codebase.
