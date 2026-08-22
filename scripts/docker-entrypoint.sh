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
WORKERS="${UVICORN_WORKERS:-4}"

echo "Starting server with ${WORKERS} worker(s)..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$WORKERS"
