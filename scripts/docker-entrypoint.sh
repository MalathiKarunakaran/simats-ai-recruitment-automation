#!/bin/bash
set -euo pipefail

echo "Running database migrations..."
# alembic/env.py runs each migration in its own transaction
# (transaction_per_migration=True) specifically so a fresh-database
# `alembic upgrade head` doesn't trip over migrations that ADD VALUE to a
# Postgres enum and a LATER migration using that new value -- see env.py's
# own comment for the full story (found live during the first real VPS
# deploy). Nothing special needed here as a result -- a single upgrade
# handles the whole chain correctly regardless of starting revision.
alembic upgrade head

# Default of 4 workers, not 1 -- Phase 7 load testing found that a single
# process's synchronous-endpoint thread pool becomes the bottleneck well
# before the database does (see LOAD_TEST_RESULTS.md): occasional
# multi-second stalls appeared under 50 concurrent users with one worker.
# Override via UVICORN_WORKERS for a specific VPS's CPU count.
#
# NOTE: app/core/rate_limit.py's buckets are per process, so every limiter
# there allows up to WORKERS x its configured count per window. Documented
# in that module; keep in mind when raising this.
WORKERS="${UVICORN_WORKERS:-4}"

# Which peer may set X-Forwarded-For / X-Forwarded-Proto. The container's
# port is published on 127.0.0.1 only, so the ONLY thing that can ever
# connect is a process on the host (Caddy), and from inside the container
# that host is the Docker network's default gateway. Derive it rather than
# hard-code a bridge address that Docker may renumber. An explicit
# TRUSTED_PROXY_IPS in .env wins (comma-separated IPs/CIDRs). Read from
# /proc/net/route because python:slim has no `ip`.
if [ -z "${TRUSTED_PROXY_IPS:-}" ]; then
  TRUSTED_PROXY_IPS="$(python - <<'PY'
import socket, struct
with open("/proc/net/route") as f:
    for line in f.readlines()[1:]:
        fields = line.split()
        if fields[1] == "00000000":  # destination 0.0.0.0 = default route
            print(socket.inet_ntoa(struct.pack("<L", int(fields[2], 16))))
            break
PY
)"
fi
export TRUSTED_PROXY_IPS
echo "Trusting X-Forwarded-For from: ${TRUSTED_PROXY_IPS:-<none>}"

echo "Starting server with ${WORKERS} worker(s)..."
# --no-proxy-headers: forwarded headers are interpreted exactly once, by the
# ProxyHeadersMiddleware app/main.py adds from TRUSTED_PROXY_IPS. Uvicorn's
# own copy (default on, trusting 127.0.0.1) would be a second, differently
# configured resolver in front of it.
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$WORKERS" --no-proxy-headers
