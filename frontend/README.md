# SIMATS Recruitment — Frontend

React + Vite + TypeScript staff console for the SIMATS AI Recruitment Automation System. See the repo root `README.md` for the current overall project status, or `HISTORY.md` for the backend's phase-by-phase build log — this file covers only the frontend.

## Stack

React 19 + Vite + TypeScript, Tailwind CSS v4, hand-written shadcn/ui-style components (Radix primitives + CVA, generated via the shadcn CLI's pattern but written directly since this environment has no interactive TTY for the CLI itself), React Router, TanStack Query, Recharts (dashboard charts), Vitest + React Testing Library.

## Status

**All 16 sidebar pages are built and live**, covering every module of the hiring lifecycle end to end: Dashboard (KPIs + charts), Vacancy Requests, Vacancy Approvals (an actionable "needs your action" queue, not just a read-only list), Job Postings (including job-ad generation, QR codes, and portal distribution), Candidates, Applications, Interviews, Offers, Onboarding, Reports (7 report types + an AD Briefing executive summary, both with Excel/PowerPoint export and date-range filtering), Employees (including offboarding), Import Data (the real recruitment-tracker workbook importer), Users, Eligibility Rules, Activity Log, and Settings (personal profile plus campus/department admin management).

The recruitment pipeline itself matches SIMATS's actual manual hiring process (4 fixed sourcing channels, a 12-step `Application` status pipeline through department/room allotment, orientation, and hand-over to HOD) rather than a generic automated flow — this was a deliberate rewrite partway through the build once the real process was clarified. AI-assisted JD generation, resume screening, interview-question generation, and candidate ranking are wired in as optional/secondary actions (via OpenAI) that never gate pipeline progress; a separate "Hermes" natural-language assistant (via Anthropic) has no dedicated frontend screen yet. This app has no candidate-facing screens; a `CANDIDATE` login shows a clear "not permitted" page (the candidate portal is a separately deferred module, same as on the backend).

Every list page follows the same enhancement pattern applied in a full sweep after initial launch: campus/status filters and free-text search (client-side, since most backend list endpoints don't support server-side text search), an empty-state message that distinguishes "nothing in this scope" from "filters narrowed it to zero," and role-gating that mirrors the backend's own guard clauses exactly rather than inventing stricter or looser rules client-side.

## Setup

```bash
npm install
cp .env.example .env.local   # VITE_API_BASE_URL, defaults to http://localhost:8000/api/v1
npm run dev                   # http://localhost:5173
```

The backend must have `CORS_ALLOWED_ORIGINS` include `http://localhost:5173` in its own `.env` (see the root `.env.example`) — without it the browser blocks the cross-origin API calls.

## Commands

- `npm run dev` — Vite dev server.
- `npm run build` — type-checks (`tsc -b`) then bundles.
- `npm run test` — Vitest.
- `npm run lint` — oxlint.

**`tsc` footgun**: `tsconfig.json` is a project-reference solution file with `"files": []`. A bare `npx tsc --noEmit` silently type-checks *zero files* and exits `0` even with real errors present. Always use `npx tsc -b --force` (what `npm run build` already does) to actually type-check — `--force` avoids a stale `.tsbuildinfo` hiding errors between runs.

## Design decisions

- **Token storage**: the access token lives only in memory (React context state), never in `localStorage`/`sessionStorage` — it can't be read by an XSS payload that runs after page load. The refresh token is an **HttpOnly, Secure (in production), SameSite=Strict cookie** set by the backend on the API host and scoped to its `/api/v1/auth` path (audit M1, 2026-09-04) — script never sees it, and nothing session-related is written to browser storage. The client sends every request with `credentials: "include"` plus an `X-Requested-With` header; the refresh and logout endpoints require that header and an allowed `Origin`, which together with SameSite=Strict is the CSRF protection. A page reload restores the session with one `/auth/refresh` call (a 401 is the normal logged-out state). The SPA's Content-Security-Policy is set by `nginx.conf`.
- **`api/client.ts`** is the only place that calls `fetch` for authenticated requests — it injects the `Authorization` header and, on a `401`, attempts exactly one silent refresh + retry before logging out. `login`/`refresh` themselves go through `publicFetch` to avoid recursing through that same interceptor.
- **Theme state lives in a top-level `ThemeProvider`** (mounted in `main.tsx`, above the router), not inside `ThemeToggle` itself — found via live testing that mounting it only inside the authenticated shell meant the `<html>` `dark` class never got (re)applied on `/login`, so the preference silently reverted to light on that one route despite `localStorage` still holding `"dark"`. Fixed by lifting the class-application effect to a provider that's always mounted regardless of route/auth state.
- **Campus switcher is genuinely wired**, not decorative: it drives the `campus_code` query param into `GET /dashboard/kpis` via TanStack Query's query key, so switching it visibly re-fetches and re-scopes the KPIs for global-scope roles. Single-campus roles see a locked label instead — their `campus_code` would be ignored server-side anyway (`app/services/scoping.py::resolve_campus_filter`), so the switcher for them isn't wired to anything.
- **Action buttons and write controls are computed client-side from `(role, status)`, mirroring the backend's own guard clauses exactly** — never just showing every action and letting the backend's `403`/`404`/`409` sort it out, and never inventing a stricter or looser client-side rule than the backend actually enforces. This is applied consistently across every module with a state machine or a role-gated write: Vacancy Requests/Approvals (`app/services/vacancy_workflow.py`'s full submit → dean-approve → HR-approve → publish → close/cancel/reject chain), Applications (`pipeline.py::transition_application_status`'s single choke point), Interviews/Offers/Onboarding (their own per-status guards), Employees (the one-way offboard guard), and Eligibility Rules (a read/write role split, not just an all-or-nothing page gate — confirmed live that a non-admin staff role sees the table read-only rather than being blocked entirely, since the backend's own read gate is broader than its write gate). Verified live at every stage of each workflow that the right (and only the right) buttons appear.
- **No new toast/notification library** — action errors (e.g. a stale `409` from a concurrent status change) show as an inline banner near the action buttons, consistent with `LoginPage`'s existing inline-error pattern from the Foundation phase.
