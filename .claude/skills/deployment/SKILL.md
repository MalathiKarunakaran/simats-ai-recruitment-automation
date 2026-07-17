---
name: deployment
description: Docker Compose deployment for this repo -- container topology, worker/connection-pool sizing, and current CI status (there is none). Load when touching Dockerfile, docker-compose.yml, scripts/docker-entrypoint.sh, or being asked about deployment/CI.
---

# Deployment (SIMATS Recruitment)

Full runbook lives in `DEPLOYMENT.md` at repo root — this is a pointer/
summary, not a replacement; read that file for the actual step-by-step
commands (env setup, build/start, verify, seed, legacy-data migration,
reverse-proxy/TLS example, backups, logs).

## Container topology (`docker-compose.yml`)

Four services: `postgres` (16-alpine, host port **5434**, not 5432 — this
dev machine runs other unrelated Postgres containers), `minio` (9000 API /
9001 console), `chromadb` (host **8012**, mapped from the image's internal
8000 — offset because host 8000 is already taken on this machine), `backend`
(this app, host port **8010** → container 8000). All ports are
non-defaults **on this specific dev machine**; don't assume 5432/9000/8000
are free on a real deployment target, but also don't assume they need to
stay offset there either — check for actual conflicts.

`chromadb`'s healthcheck is a raw `/dev/tcp` HTTP request via `bash -c`
(the `chromadb/chroma` image ships neither curl nor wget, and `CMD-SHELL`'s
default `/bin/sh` is dash, which doesn't support `/dev/tcp` — bash must be
invoked explicitly). Hits `/api/v2/heartbeat` (`/api/v1/heartbeat` is
deprecated, returns 410 on the image version in use).

n8n itself is **not** self-hosted by this compose file — `N8N_BASE_URL`
points at an externally operated n8n instance; Phase 6's integration is a
webhook client only.

## Backend image (`Dockerfile`)

`python:3.14-slim`, matches the dev venv's Python version exactly. No
compiler toolchain installed (psycopg/argon2-cffi ship prebuilt wheels for
this platform) — add `build-essential` only if a future dependency's install
actually fails without one, not preemptively. Runs as a non-root `appuser`.
Entrypoint is `scripts/docker-entrypoint.sh`, which runs `alembic upgrade
head` automatically before starting uvicorn — no separate migration step
needed on first boot or redeploy.

## Worker / connection-pool sizing

`docker-entrypoint.sh` defaults to **4 uvicorn workers**
(`UVICORN_WORKERS` env var to override), based on Phase 7 load testing
(`LOAD_TEST_RESULTS.md`) that found a single worker's synchronous-endpoint
thread pool — not the database — was the real concurrency ceiling. Each
worker gets its own SQLAlchemy connection pool
(`pool_size=10, max_overflow=10` in `app/db/session.py`) = 20 connections/
worker, so 4 workers x 20 = 80, under Postgres's default `max_connections=100`.
**If you raise `UVICORN_WORKERS` meaningfully, raise Postgres's
`max_connections` first** — `workers x 20` must stay under it.

## CI/CD status: none

**There is no `.github/workflows/` directory and no GitHub Actions pipeline
in this repo as of this writing.** Deployment today is entirely manual:
`docker compose build backend && docker compose up -d`, verified by hand
(`curl /health`, `/docs`). Do not assume or reference a CI pipeline that
doesn't exist — if asked to "check CI" or "the pipeline," the honest answer
is that none exists yet; if asked to add one, that's new infrastructure, not
documentation of an existing pattern.

## Known limitation, stated plainly in `DEPLOYMENT.md`

The entire runbook was written and verified by building/running the stack
**locally**, not against a real remote VPS (none was available/authorized in
the environment it was built in). Treat the build/start/verify steps as
proven; treat the reverse-proxy/TLS section as guidance/example only.
