#!/bin/bash
set -euo pipefail

echo "Running database migrations..."
alembic upgrade head

# Default of 4 workers, not 1 -- Phase 7 load testing found that a single
# process's synchronous-endpoint thread pool becomes the bottleneck well
# before the database does (see LOAD_TEST_RESULTS.md): occasional
# multi-second stalls appeared under 50 concurrent users with one worker.
# Override via UVICORN_WORKERS for a specific VPS's CPU count.
WORKERS="${UVICORN_WORKERS:-4}"

echo "Starting server with ${WORKERS} worker(s)..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$WORKERS"
