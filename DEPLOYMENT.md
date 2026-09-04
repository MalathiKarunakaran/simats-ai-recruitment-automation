# Deployment Runbook

This is a Docker-based deployment guide for the SIMATS AI Recruitment
Automation System. Written in Phase 7 and verified locally via Docker at
the time; **since verified for real** against the production VPS
(`srv1922215.hstgr.cloud`, a Hostinger KVM 2 instance) on 2026-08-23 --
`backend`, `frontend`, `postgres`, `minio`, and `chromadb` are all live
there via `docker-compose.yml`, reachable at `https://api.malathi.io` and
`https://app.malathi.io` respectively. Every command here is the real one
used for that deployment.

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
- `CORS_ALLOWED_ORIGINS` — your frontend's real origin(s), comma-separated, once a frontend is deployed. Leave blank if the API has no browser-based frontend calling it cross-origin. **This list is also the CSRF allow-list** for the session-cookie endpoints (`/auth/refresh`, `/auth/logout` — see `app/core/session_cookie.py`): a request whose `Origin` is not here is refused.
- **The frontend and API hosts must be the same site** (one registrable domain — `app.malathi.io` and `api.malathi.io` are; `app.example.com` and `api.other.net` are not). The refresh token is an `HttpOnly; Secure; SameSite=Strict` cookie on the API host (audit M1, 2026-09-04), and a browser only attaches a Strict cookie to requests initiated from the same site. Moving the API to an unrelated domain would silently log every user out on reload. `ENVIRONMENT=production` is what turns the cookie's `Secure` flag on, so the API must be served over HTTPS there. The SPA's Content-Security-Policy lives in `frontend/nginx.conf` and names the API origin in `connect-src` — change both together.

## 2. Pull the code you intend to deploy

```bash
cd /opt/simats/app
git pull --ff-only origin master
git log --oneline -1          # <- ALWAYS check this
```

**Check the last line every time.** On 2026-09-02 `git pull` failed here while
the `docker compose build` that followed still exited 0 -- it rebuilt the
images from the *previous* commit and reported success. A green build says
nothing about which code it built.

The failure mode was specific and may recur: anonymous HTTPS fetches from this
VPS started getting `HTTP/2 401` with `www-authenticate: Basic realm="GitHub"`
on the `git-upload-pack` **POST**, while the GET ref advertisement still
returned 200 (so `git ls-remote` worked and `git fetch` did not). The repo is
public and two pulls had succeeded from the same host hours earlier, so this
looked like GitHub throttling anonymous fetches from that IP rather than a
config change.

Fixed by giving the VPS its own credentials instead of relying on anonymous
access: a **read-only deploy key** (`/root/.ssh/simats_deploy`, registered on
the repo as "srv1922215 production deploy (read-only)"), selected in
`/root/.ssh/config` for `Host github.com`, with `origin` switched to
`git@github.com:...`. It cannot push. If a future deploy ever needs to move to
a different host, generate a new key there rather than copying this one.

If SSH is ever unavailable too, a git bundle over `scp` is the fallback that
was used to ship `46b089b` -- it keeps the repo fully consistent, unlike
copying files over the working tree:

```bash
# on the machine that has the commits
git bundle create /tmp/update.bundle <last-deployed-sha>..master
scp /tmp/update.bundle root@srv1922215.hstgr.cloud:/tmp/
# on the VPS
cd /opt/simats/app
git bundle verify /tmp/update.bundle
git fetch /tmp/update.bundle master && git merge --ff-only FETCH_HEAD
```

## 3. Build and start the stack

```bash
docker compose build
docker compose up -d
```

This starts `postgres`, `minio`, `chromadb`, `backend` (the FastAPI app),
and `frontend` (the built React app, served by nginx). `backend`'s
entrypoint (`scripts/docker-entrypoint.sh`) runs `alembic upgrade head`
automatically before starting the server — no separate migration step
needed on first boot or subsequent deploys.

`frontend`'s `VITE_API_BASE_URL` build arg is baked into the static
bundle at build time (Vite inlines `import.meta.env.*`, it isn't read at
container start) — set it to your real API domain, e.g.
`https://api.your-domain.com/api/v1`, before building for production.

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

## 4. Verify

```bash
curl http://localhost:8010/health          # {"status": "ok"}
curl http://localhost:8010/docs            # Swagger UI
curl http://localhost:8010/openapi.json -o openapi.json   # static snapshot, if wanted
curl http://localhost:8011/                # frontend index.html
```

(Ports `8010`/`8011` per `docker-compose.yml`'s host mappings -- adjust
if you changed them.)

## 5. Seed data (optional, first run only)

Seeding is idempotent (safe to re-run) but creates demo/sample data
(sample users, demo vacancy scenarios) — skip this for a real production
rollout beyond the campuses/departments/Super Admin you actually need,
or run it once and then delete the demo vacancy/candidate rows it created.

```bash
docker compose exec backend python -m app.db.seed
```

## 6. Migrating legacy data

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

## 7. Reverse proxy / TLS

### Client IP behind the proxy (2026-09-03)

Caddy connects to the container through the Docker bridge, so from inside
the container every request's TCP peer is the bridge gateway (172.16.1.1 on
the current VPS). Until 2026-09-03 that address was what the rate limiter
keyed on and what every audit row recorded -- 584 of 584 production audit
rows carried it, and 30 failed logins from anyone throttled everyone.

The backend now resolves the real client from `X-Forwarded-For`, but only
when the immediate peer is listed in `TRUSTED_PROXY_IPS`
(`app/main.py` -> uvicorn's `ProxyHeadersMiddleware`; the reasoning is in
`app/core/client_ip.py`). `scripts/docker-entrypoint.sh` derives that
address from the container's default route at startup, so nothing needs
setting unless Caddy ever moves off the host. Check it took effect with:

```bash
docker logs simats_recruitment_backend 2>&1 | grep "Trusting X-Forwarded-For"
# and, after a few real logins:
docker exec simats_recruitment_postgres psql -U <user> -d <db>   -c "select ip_address, count(*) from audit_logs group by 1 order by 2 desc limit 5"
```

Caddy 2.5+ (the VPS runs 2.11) replaces any client-supplied
`X-Forwarded-For` with the real remote address unless `trusted_proxies` is
configured -- it is not, and must stay that way. Even if it were passed
through, uvicorn takes the right-most address that is not a trusted proxy,
so a spoofed prefix never wins.

Rate limits remain per uvicorn worker (see `app/core/rate_limit.py`):
with `UVICORN_WORKERS=4` each limit is effectively 4x its configured value.


This app should sit behind a reverse proxy that terminates TLS and
forwards to `backend`'s port `8000` (internal) / `8010` (host-mapped) and
`frontend`'s port `80` (internal) / `8011` (host-mapped). On the
production VPS this is a **host-level Caddy install, not managed by this
repo or its `docker-compose.yml`** (it predates the frontend/backend
container split and isn't version-controlled here):

```
# /etc/caddy/Caddyfile
api.your-domain.com {
    reverse_proxy localhost:8010
}

app.your-domain.com {
    reverse_proxy localhost:8011
}
```

**Known incident (2026-08-23, resolved)**: `app.your-domain.com`'s block
was actually configured as `root * /opt/simats/app/frontend/dist` +
`file_server` — serving a one-time static snapshot from disk instead of
proxying to the `frontend` container. Every `frontend` image rebuild
landed in the Docker container just fine but never touched that on-disk
folder, so the live domain silently kept serving an increasingly stale
build (missing CSS custom properties from later commits, causing
invisible white-on-white buttons) while direct container access
(`http://<vps-ip>:8011`) always showed the current one. Fixed by
switching that block to `reverse_proxy localhost:8011`, matching
`api.your-domain.com`'s already-correct pattern (backed up as
`/etc/caddy/Caddyfile.bak-<timestamp>` on the VPS). If a deploy is ever
"done" per this file but a live domain doesn't reflect it, checking
`/etc/caddy/Caddyfile` for a stray `file_server`/`root` block instead of
`reverse_proxy` is the first thing to rule out.

A Docker-based `caddy` service (build-context Caddyfile, `443:443` only)
was tried first and abandoned once the host-level proxy was found (and,
after the fix above, confirmed to actually work) -- see git history if
that approach is ever needed again (e.g. on a fresh VPS with no
pre-existing proxy).

`app/core/security_headers.py`'s middleware only adds `Strict-Transport-
Security` when it sees `X-Forwarded-Proto: https` (or a direct HTTPS
request) — Caddy sets that header automatically; if using nginx instead,
add `proxy_set_header X-Forwarded-Proto $scheme;` to your config.

## 8. Backups

The Postgres data lives in the `postgres_data` named volume
(`docker-compose.yml`). Back it up with:

```bash
docker exec simats_recruitment_postgres pg_dump -U <POSTGRES_USER> <POSTGRES_DB> > backup-$(date +%Y%m%d).sql
```

MinIO's `minio_data` volume holds uploaded resumes — back it up the same
way (volume snapshot, or `mc mirror` to another bucket/host).

## 9. Logs

```bash
docker compose logs -f backend
```

## Known limitations of this runbook

- The `frontend` service's `npm ci` fails outright in this VPS's build
  sandbox (Windows-generated `package-lock.json` + a Linux build target,
  a known npm bug — npm/cli#4828) — `frontend/Dockerfile` uses `npm
  install` instead. If regenerating the lockfile on Linux at some point,
  `npm ci` can likely go back to being the stricter, faster choice.
- Steps 1–5 and the frontend build/serve piece of step 6 have now been
  verified for real on the production VPS (see the top of this file).
  The **reverse proxy itself** (Caddy) was verified only as a pre-existing
  host-level install discovered live, not deployed by this repo's tooling
  — a from-scratch reverse-proxy setup on a brand new VPS with nothing
  already listening on 80/443 has not been exercised end-to-end.
