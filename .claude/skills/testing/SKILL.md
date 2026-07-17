---
name: testing
description: pytest (backend) and Vitest (frontend) conventions for this repo -- conftest.py fixtures, the FakeAnthropicClient/FakeOpenAIClient pattern, transaction-rollback isolation, and the Radix Select jsdom polyfills. Load when writing or running tests, or when a test fails in a way that looks environment-related rather than a real bug.
---

# Testing patterns (SIMATS Recruitment)

## Backend: pytest (`tests/`, `pytest.ini`, `tests/conftest.py`)

`pytest.ini` is minimal: `testpaths = tests`, `pythonpath = .`. Run with:
```bash
venv/Scripts/python.exe -m pytest -v
```
Needs a one-time `CREATE DATABASE simats_recruitment_test` (see README) —
`TEST_DATABASE_URL` env var overrides the default `<DATABASE_URL's db>_test`.

170+ test functions across one file per router/concern (`test_auth.py`,
`test_vacancy_requests.py`, `test_hiring_slots_pipeline.py`, etc.).

Key fixtures in `conftest.py`:
- **`client`** — a `TestClient` with `get_db`, `get_ai_client`,
  `get_openai_client`, `get_minio_client`, `get_chroma_collection` all
  dependency-overridden with in-memory fakes. This is the fixture almost
  every test uses.
- **`FakeAnthropicClient`/`FakeOpenAIClient`** — dispatch canned structured-
  JSON responses by inspecting which JSON schema was requested (matches on a
  distinctive property name: `role_overview` → JD payload,
  `eligibility_score` → resume-score payload, `questions` → interview-
  questions payload). Pass a custom `response_provider` callable to a fixture
  instance when a test needs to exercise the AI-error → HTTP-status mapping
  in `ai_client.py` (raise a real `anthropic.RateLimitError`/`openai.APIStatusError`
  etc. from the provider).
- **`FakeMinioClient`**, **`FakeChromaCollection`** — same idea for object
  storage and vector search; `FakeChromaCollection` uses a deterministic
  fake "distance" (0.0 for exact document match, 0.5 otherwise) so
  duplicate-detection tests don't need a real embedding model.
- **`db_session`** — wraps each test in an outer transaction + SAVEPOINT
  that's rolled back at teardown, so router code calling `db.commit()`
  behaves normally within a test but nothing persists across tests.
- **`published_vacancy_factory`** / **`hired_employee_factory`** — drive a
  vacancy or an application all the way through the real
  `vacancy_workflow`/`pipeline`/`joining` service calls (not hand-built rows)
  so tests exercise the same code path the API does. `hired_employee_factory`
  mirrors `app/db/seed.py`'s full-happy-path sequence exactly.
- **`_reset_rate_limits`** (autouse) — clears `app.core.rate_limit`'s
  module-level buckets between tests, since every `TestClient` request shares
  one synthetic client IP.
- `auth_headers(client, user)` helper — logs in and returns a `Bearer` header
  dict; every RBAC test uses this rather than hand-building a JWT.

When adding a new AI-backed endpoint, write both: a happy-path test using the
default fake response, and an AI-error test that swaps in a `response_provider`
raising the relevant provider exception, asserting the 502/503 mapping.

## Frontend: Vitest (`frontend/src/test/setup.ts`, `frontend/vite.config.ts`)

```bash
cd frontend && npm run test     # vitest run
```
78+ tests, `*.test.tsx`/`*.test.ts` colocated next to the component/page/hook
they cover (not a separate `__tests__/` tree).

- `vite.config.ts`'s `test` block sets `environment: "jsdom"` and
  `setupFiles: ["./src/test/setup.ts"]`.
- This project runs Vitest **without** `globals: true` — test files import
  `describe`/`it`/`expect` explicitly rather than relying on ambient globals.
  Because of that, `setup.ts` wires up Testing Library's `cleanup` via an
  explicit `afterEach(cleanup)` — without it, DOM nodes accumulate across
  tests in the same file.
- **Radix Select jsdom polyfills**: jsdom doesn't implement
  `hasPointerCapture`/`setPointerCapture`/`releasePointerCapture`/
  `scrollIntoView`, which Radix's `Select` needs for pointer interactions —
  omitting them throws `"not a function"` mid-test. `setup.ts` stubs all four
  onto `Element.prototype`. If a new test involving `<Select>` fails with a
  pointer-capture error, check this file is actually being loaded, don't
  re-patch it locally in the test.
- **Query a Radix Select by role**: use `getByRole("combobox")` (the
  trigger's implicit role), not `getByRole("listbox")` or a data-testid —
  matches this repo's existing test convention.
- A couple of tests are known to occasionally flake on worker-pool startup
  contention (unrelated to the code under test) — if a failure looks like a
  timing/startup issue and passes in isolation, it's this, not a regression.

## TypeScript as a test gate

`npx tsc -b --force` should be run alongside Vitest, not instead of it —
`tsc --noEmit` at the repo root silently checks zero files (see `CLAUDE.md`).
Treat both as required before considering frontend work done: `tsc -b
--force` clean AND `npm run test` passing.
