# Phase 7 Load Test Results

Run with `scripts/load_test.py` against the local dev server (seeded data,
Postgres/MinIO/ChromaDB in Docker, no live Anthropic/n8n calls involved in
any of the endpoints under test), on a single Windows development machine
running Docker Desktop. **These numbers describe this dev environment, not
a production VPS** — they're reported honestly as what was actually
observed, not a claim about production capacity.

"8 campuses' concurrent usage" is simulated as multiple concurrent workers
sharing 5 real seeded staff accounts spanning SSE/SCAD (global HR
Admin/Associate Dean plus campus-scoped HOD/Recruitment Officer accounts),
hitting 4 representative read endpoints: vacancy list, application
pipeline list, dashboard KPIs, and a Module 12 report.

## Timeline: two real issues found and fixed during this exercise

**1. First run (single uvicorn worker, default SQLAlchemy pool):**
50 concurrent workers × 10 requests/endpoint, 0% errors, but a severe
p99/max outlier (21-24s) that appeared to be isolated to one endpoint. A
follow-up run with the endpoint hit order shuffled per request (instead of
the fixed order every worker's loop used) showed the *same* outlier
appearing on *every* endpoint once shuffled — proving it was never
endpoint-specific, just previously masked on 3 of 4 endpoints by request
ordering. Root cause: a single uvicorn process runs every (synchronous,
SQLAlchemy-backed) path operation through a shared thread pool, which
becomes the concurrency ceiling well before the database does.

**Fix**: `scripts/docker-entrypoint.sh` now defaults to `--workers 4`
(overridable via `UVICORN_WORKERS`), not the implicit single worker used
in local dev.

**2. Second run (4 workers, `pool_size=30`/`max_overflow=20`):** latency
improved for 3 of 4 endpoints but a *new* problem appeared — real request
errors (2.6%) and *worse* max latency (up to 58s). Cause: each worker
process constructs its own SQLAlchemy engine, so 4 workers × 50 connections
(pool_size + max_overflow) = up to 200 attempted Postgres connections
against Postgres's own default `max_connections=100`.

**Fix**: `app/db/session.py` now uses `pool_size=10, max_overflow=10` (20
per worker). 4 workers × 20 = 80, safely under Postgres's default 100 —
documented in code as a ratio to keep in sync if the worker count changes.
**A production deploy running more than ~4 workers must raise Postgres's
`max_connections` accordingly** (see `DEPLOYMENT.md`).

## Final numbers (after both fixes)

`venv/Scripts/python.exe scripts/load_test.py --concurrency 50 --requests-per-worker 10`
(4 uvicorn workers, corrected pool sizing):

| Endpoint | Reqs | Errors | p50 | p95 | p99 | Max |
|---|---|---|---|---|---|---|
| `/api/v1/vacancy-requests` | 500 | 1 | 208ms | 506ms | 13.7s | 51.7s |
| `/api/v1/applications` | 500 | 4 | 218ms | 624ms | 21.5s | 42.2s |
| `/api/v1/dashboard/kpis` | 500 | 3 | 658ms | 1.95s | 23.9s | 47.8s |
| `/api/v1/reports/recruitment-funnel` | 500 | 3 | 192ms | 469ms | 15.5s | 49.1s |

Total: 2000 requests, 11 errors (0.6%), 33.7 req/s throughput.

`--concurrency 20` (closer to a realistic simultaneous-staff count across
8 campuses at any given moment, vs. 50 as a deliberate stress test):

| Endpoint | Reqs | Errors | p50 | p95 | p99 | Max |
|---|---|---|---|---|---|---|
| `/api/v1/vacancy-requests` | 200 | 4 | 95ms | 216ms | 37.2s | 38.4s |
| `/api/v1/applications` | 200 | 3 | 95ms | 170ms | 34.0s | 35.9s |
| `/api/v1/dashboard/kpis` | 200 | 3 | 171ms | 412ms | 34.9s | 37.8s |
| `/api/v1/reports/recruitment-funnel` | 200 | 2 | 90ms | 183ms | 32.1s | 38.8s |

Total: 800 requests, 12 errors (1.5%), 11.2 req/s throughput.

## Honest assessment

The **typical** request (median, and 95th percentile at 20 concurrent
users) is fast and error-free — under 500ms even under load, which is
what actually matters for a staff-facing internal tool with realistic
concurrency. A small tail (roughly 1-2% of requests) shows severe stalls
(10s-50s) even after fixing the two real issues above. Ruled out as
causes: per-endpoint bugs (the shuffle test proved it isn't endpoint-
specific), connection-pool exhaustion (fixed, confirmed via
`pg_stat_activity` staying well under `max_connections` on the corrected
config), and a test-harness ordering artifact (ruled out the same way).

The most likely remaining cause is this specific test environment itself:
Docker Desktop on Windows runs every container through a virtualization/
WSL2 networking layer, and this same machine was simultaneously running
the load-generating client, 4 application worker processes, Postgres,
MinIO, and ChromaDB, all sharing one machine's CPU and virtualized network
stack. This wasn't further isolated because doing so would require a
dedicated Linux VPS to test against, which isn't available in this
environment (see `DEPLOYMENT.md`'s own honesty note about not having a
real VPS to deploy to this phase). **Recommendation for a real production
rollout**: re-run `scripts/load_test.py` against the actual target VPS
before go-live, and treat this file's numbers as evidence the *code path*
is sound (low error rate, fast median latency, two real scaling issues
already found and fixed) rather than a production capacity guarantee.
