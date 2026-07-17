---
name: backend
description: FastAPI backend patterns for this repo -- JWT auth, RBAC/campus-scope dependencies, the two state-machine service choke points, and the AI-client 503-degradation pattern. Load when writing or reviewing a router, service, or auth/permissions change in app/.
---

# Backend patterns (SIMATS Recruitment)

## Auth (`app/core/security.py`, `app/core/deps.py`, `app/api/v1/routers/auth.py`)

- Passwords: Argon2id via `argon2-cffi` (`hash_password`/`verify_password` in
  `security.py`), never bcrypt/plain hashlib.
- Access tokens: short-lived JWT (`create_access_token`, HS256,
  `ACCESS_TOKEN_EXPIRE_MINUTES`), payload has `sub` (user id), `role`,
  `campus_id`, `type: "access"`, and a random `jti` so two tokens minted in
  the same second never collide.
- Refresh tokens: **opaque**, not JWTs — `generate_opaque_token()` returns the
  raw token handed to the client; only `hash_opaque_token()` (SHA-256) is
  persisted (`RefreshToken` model). Same pattern for password-reset tokens.
- `app/core/deps.py`:
  - `get_current_user` decodes the JWT, rejects non-`"access"` token types,
    and 401s (`credentials_exception`) if the user id doesn't decode/resolve.
  - `get_current_active_user` additionally 403s on `is_active=False`.
  - `require_roles(*roles)` — a dependency factory: `Depends(require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN))`.
  - `get_campus_scope` returns a `CampusScope(is_global, campus_id)` —
    `is_global=True` for roles in `GLOBAL_SCOPE_ROLES`.
  - `enforce_campus_match(scope, resource_campus_id)` — **raises 404, not
    403**, on cross-campus access to a single resource, so an unauthorized
    caller can't tell the resource exists at all. Use this exact pattern for
    any new single-resource read/write endpoint that's campus-scoped.

## State-machine choke points — the most important rule in this codebase

- `app/services/vacancy_workflow.py`: the only code allowed to move
  `VacancyRequest.status` through DRAFT → SUBMITTED → DEAN_APPROVED →
  APPROVED → PUBLISHED → CLOSED/REJECTED. Each function
  (`submit`/`dean_approve`/`reject`/`hr_approve`/`publish`/`close`) checks the
  current status itself and raises `HTTPException(409, ...)` on an invalid
  transition. `hr_approve` is also where `ApprovedVacancy` + `HiringSlot`
  rows get created; `publish` is where `JobPosting` gets created.
- `app/services/pipeline.py`: the only code allowed to move
  `Application.status` or `HiringSlot.status`. `transition_application_status()`
  enforces forward-only movement through `APPLICATION_STATUS_ORDER` (enums.py)
  unless `force=True` (Super-Admin-only correction), requires a `reason` for
  REJECTED/WITHDRAWN, and handles slot reserve (on SELECTED) / release (on
  REJECTED/WITHDRAWN) / fill-plus-maybe-autoclose (on JOINED) as side effects
  in the same function. `advance_if_behind()` is the idempotent variant offers/
  joining/interviews routers call — it's a no-op if the application already
  reached or passed `target_status`, so repeated/out-of-order calls don't 409.
- **If you're adding a new endpoint that changes Application or VacancyRequest
  status, call into these services — do not set `.status` directly in a
  router.** Every transition here also writes an audit log entry
  (`app/services/audit.py::log_event`, before/after snapshot) and fires
  notifications (`app/services/notifications.py`) — bypassing the service
  loses both.

## AI client 503-degradation pattern (`app/services/ai_client.py`)

Two providers, not unified behind one interface, on purpose: OpenAI
(`gpt-4o`) for the three structured-JSON calls (`generate_jd`,
`score_and_extract_resume`, `generate_interview_questions`); Anthropic
(`claude-opus-4-8`) only for Hermes's tool-use loop
(`call_with_tools`/`generate_narrative`), because Hermes's loop is written
against Anthropic's `tool_use` content-block shape.

- `get_ai_client()` / `get_openai_client()` are FastAPI dependencies that
  raise `HTTPException(503, "AI features are not configured (...API_KEY is
  not set)")` when the key is unset — this exists because an empty API key
  otherwise makes the SDK raise a bare `TypeError` on first call, which would
  surface as an unhandled 500. **Never construct `anthropic.Anthropic()`/
  `openai.OpenAI()` directly in a router or service** — always go through
  these two functions so tests can override them.
- Real provider errors are mapped centrally in `_call`/`_call_openai`:
  `RateLimitError` → 503, `APIConnectionError`/`APIStatusError` → 502, catch-
  all provider error → 502. Do this mapping once, in `ai_client.py`, not
  per-call-site.
- Tests never hit a live provider — `tests/conftest.py`'s `client` fixture
  overrides both dependencies with `FakeAnthropicClient`/`FakeOpenAIClient`.

## Error shape

No central FastAPI exception handler is registered in `app/main.py` — errors
are plain `fastapi.HTTPException(status_code=..., detail=...)` raised inline
at the point of failure (in routers or, more often, services). `detail` is a
human-readable string; the frontend's `client.ts::extractErrorMessage`
expects exactly this shape (a `detail` string, or a list of `{msg: ...}`
validation-error objects for 422s).

## Rate limiting (`app/core/rate_limit.py`)

Hand-rolled in-memory sliding-window limiter (`RateLimiter(max_requests=...,
window_seconds=..., name=...)`), used as a route dependency on brute-force-
prone endpoints (login, password-reset-request). State is a module-level
dict — **single-process only**, documented as a known limitation, not a bug
to "fix" without being asked; a multi-worker deployment would need Redis.
Tests must call `app.core.rate_limit.reset_all()` between requests sharing a
synthetic client IP (already wired as an autouse fixture in `conftest.py`).

## Router registration

New routers go in `app/api/v1/routers/<name>.py` with
`router = APIRouter(prefix="/<resource>", tags=["<resource>"])`, then get
imported and `include_router`'d in `app/api/v1/api.py`.
