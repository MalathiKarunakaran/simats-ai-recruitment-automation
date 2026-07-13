# SIMATS Recruitment — Frontend

React + Vite + TypeScript staff console for the SIMATS AI Recruitment Automation System. See the repo root `README.md` for the overall project/phase history — this covers only the frontend.

## Stack

React 19 + Vite + TypeScript, Tailwind CSS v4, hand-written shadcn/ui-style components (Radix primitives + CVA, generated via the shadcn CLI's pattern but written directly since this environment has no interactive TTY for the CLI itself), React Router, TanStack Query, Vitest + React Testing Library.

## Status

**Foundation phase (done)**: auth (login, silent session restore via refresh token, logout), a role-based shell (sidebar nav, topbar), dark/light mode, a campus switcher (interactive for global-scope roles, a locked label for single-campus roles), and the Executive Dashboard (`GET /dashboard/kpis`) as the first vertical slice.

**Vacancy Requests (Module 2, done)**: list (with a status filter and a campus column, since the backend's list endpoint has no `campus_code` narrowing param — global callers see every campus in one list), detail (role/status-gated action buttons for the full `submit → dean-approve → HR-approve → publish → close` chain plus `reject`, each computed against the exact backend guard rules in `app/services/vacancy_workflow.py`), and a shared create/edit form (`campus_id`/`department_id` are immutable after creation, matching the backend's `PATCH` schema). Verified live end-to-end through the entire approval chain plus a reject flow with a typed reason.

Every other module (Applications, Interviews, Offers, Reports, etc.) is a disabled "soon" nav item — not built yet. This app has no candidate-facing screens; a `CANDIDATE` login shows a clear "not permitted" page (Module 5's candidate portal is separately deferred, same as on the backend). AI-driven actions (JD generation, resume screening) are deliberately out of scope for the Vacancy Requests screens — deferred to a later "AI Agents" frontend phase, mirroring the backend's own Phase 2/Phase 3 split.

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

## Design decisions

- **Token storage**: the access token lives only in memory (React context state), never in `localStorage`/`sessionStorage` — it can't be read by an XSS payload that runs after page load. The refresh token *is* stored in `localStorage` (so a page reload doesn't force re-login), a standard, well-understood tradeoff for a bearer-token SPA. A future hardening step would move refresh to an httpOnly cookie, which needs backend changes not done this phase.
- **`api/client.ts`** is the only place that calls `fetch` for authenticated requests — it injects the `Authorization` header and, on a `401`, attempts exactly one silent refresh + retry before logging out. `login`/`refresh` themselves go through `publicFetch` to avoid recursing through that same interceptor.
- **Theme state lives in a top-level `ThemeProvider`** (mounted in `main.tsx`, above the router), not inside `ThemeToggle` itself — found via live testing that mounting it only inside the authenticated shell meant the `<html>` `dark` class never got (re)applied on `/login`, so the preference silently reverted to light on that one route despite `localStorage` still holding `"dark"`. Fixed by lifting the class-application effect to a provider that's always mounted regardless of route/auth state.
- **Campus switcher is genuinely wired**, not decorative: it drives the `campus_code` query param into `GET /dashboard/kpis` via TanStack Query's query key, so switching it visibly re-fetches and re-scopes the KPIs for global-scope roles. Single-campus roles see a locked label instead — their `campus_code` would be ignored server-side anyway (`app/services/scoping.py::resolve_campus_filter`), so the switcher for them isn't wired to anything.
- **Vacancy request action buttons are computed client-side from `(role, status)`**, mirroring the backend's own guard clauses exactly (see the table in the Vacancy Requests plan) rather than just showing every action and letting the backend `409`/`403` sort it out — better UX, verified live at every stage of the approval chain that the right (and only the right) buttons appear.
- **No new toast/notification library** — action errors (e.g. a stale `409` from a concurrent status change) show as an inline banner near the action buttons, consistent with `LoginPage`'s existing inline-error pattern from the Foundation phase.
