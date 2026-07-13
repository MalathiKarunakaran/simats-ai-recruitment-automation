# Deployment Runbook

This is a Docker-based deployment guide for the SIMATS AI Recruitment
Automation System. It was written and verified in Phase 7 by actually
building and running the full stack locally via Docker — **no real VPS
was available in the environment this was built in**, so this has not
been run against a live remote server. Follow this runbook when a real
VPS becomes available; every command here is exactly what was used for
local verification, just pointed at `localhost` instead of a real host.

## Prerequisites

- A Linux VPS with Docker and the Docker Compose plugin installed.
- A domain name (for TLS termination via a reverse proxy — see below).
- This repository cloned onto the VPS.

## 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` for production:

- `JWT_SECRET_KEY` — generate a real one: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Never reuse the dev default.
- `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`/`MINIO_SECRET_KEY` — real, unique passwords, not `change_me_locally`.
- `SEED_SUPER_ADMIN_EMAIL`/`SEED_SUPER_ADMIN_PASSWORD` — set a real admin email; leave the password blank to have one auto-generated and printed once at seed time (never persisted in plaintext).
- `SEED_SAMPLE_USER_PASSWORD` — only relevant if you intend to seed demo data in production, which you normally would not; leave as-is or ignore.
- `ANTHROPIC_API_KEY` — a real key for JD generation/resume screening/Hermes to work; the app runs fine without one (those specific endpoints return a clean `503`).
- `N8N_BASE_URL` — point at your real n8n instance's webhook base URL for real notification delivery/job-portal distribution; leave blank to run with notifications honestly marked `FAILED` and distribution returning `503`.
- `PUBLIC_APPLY_BASE_URL` — your real careers-page/apply-link domain, once one exists.
- `CORS_ALLOWED_ORIGINS` — your frontend's real origin(s), comma-separated, once a frontend is deployed. Leave blank if the API has no browser-based frontend calling it cross-origin.

## 2. Build and start the stack

```bash
docker compose build backend
docker compose up -d
```

This starts `postgres`, `minio`, `chromadb`, and `backend` (the FastAPI
app). `backend`'s entrypoint (`scripts/docker-entrypoint.sh`) runs
`alembic upgrade head` automatically before starting the server — no
separate migration step needed on first boot or subsequent deploys.

By default `backend` runs with **4 uvicorn workers** (see
`scripts/docker-entrypoint.sh` and `LOAD_TEST_RESULTS.md` for why — a
single worker's synchronous-endpoint thread pool was found to be the real
concurrency ceiling under load, well before the database). Override with
`UVICORN_WORKERS=N` in `.env` to match your VPS's CPU count. **If you
raise the worker count significantly beyond 4, also raise Postgres's
`max_connections`** — `app/db/session.py`'s connection pool is sized
per-worker (20 connections each: `pool_size=10, max_overflow=10`), so
`workers × 20` must stay under Postgres's `max_connections` (100 by
default in the `postgres:16-alpine` image used here).

## 3. Verify

```bash
curl http://localhost:8010/health          # {"status": "ok"}
curl http://localhost:8010/docs            # Swagger UI
curl http://localhost:8010/openapi.json -o openapi.json   # static snapshot, if wanted
```

(Port `8010` per `docker-compose.yml`'s host mapping — adjust if you
changed it.)

## 4. Seed data (optional, first run only)

Seeding is idempotent (safe to re-run) but creates demo/sample data
(sample users, demo vacancy scenarios) — skip this for a real production
rollout beyond the campuses/departments/Super Admin you actually need,
or run it once and then delete the demo vacancy/candidate rows it created.

```bash
docker compose exec backend python -m app.db.seed
```

## 5. Migrating legacy data

If migrating vacancy data out of the existing n8n + Airtable pipeline, use
Phase 6's CSV importer rather than manual entry:

```bash
curl -X POST https://your-domain/api/v1/migration/import-legacy-vacancies \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@legacy_vacancies.csv"
```

See `app/services/migration.py::REQUIRED_COLUMNS` for the expected CSV
column schema (a documented best-effort mapping — the real Airtable
export format wasn't available when this was built). Every imported row
lands as a `DRAFT` vacancy request for human review; nothing is
auto-submitted or auto-published.

## 6. Reverse proxy / TLS (not deployed here, example only)

This app should sit behind a reverse proxy that terminates TLS and
forwards to `backend`'s port `8000` (internal) / `8010` (host-mapped).
Example using Caddy (simplest option — automatic Let's Encrypt, no manual
cert management):

```
# /etc/caddy/Caddyfile
api.your-domain.com {
    reverse_proxy localhost:8010
}
```

`app/core/security_headers.py`'s middleware only adds `Strict-Transport-
Security` when it sees `X-Forwarded-Proto: https` (or a direct HTTPS
request) — Caddy sets that header automatically; if using nginx instead,
add `proxy_set_header X-Forwarded-Proto $scheme;` to your config.

## 7. Backups

The Postgres data lives in the `postgres_data` named volume
(`docker-compose.yml`). Back it up with:

```bash
docker exec simats_recruitment_postgres pg_dump -U <POSTGRES_USER> <POSTGRES_DB> > backup-$(date +%Y%m%d).sql
```

MinIO's `minio_data` volume holds uploaded resumes — back it up the same
way (volume snapshot, or `mc mirror` to another bucket/host).

## 8. Logs

```bash
docker compose logs -f backend
```

## Known limitation of this runbook

Everything above was verified by building and running the full stack
**locally** (not on a remote VPS — none was available/authorized in this
environment). The commands are the real ones used; only the target host
changes for a real deployment. Treat step 2's Docker build and step 3's
verification as proven; treat the reverse-proxy/TLS section as guidance,
since no real domain/certificate was involved in verification.
