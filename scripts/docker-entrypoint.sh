#!/bin/bash
set -euo pipefail

echo "Running database migrations..."
# f32d13801269 (phase5_pipeline_rename_add_values) ADD VALUEs to
# application_status_enum; the very next migration, ba2e30350b8a
# (phase5_pipeline_rename_migrate_data), UPDATEs rows to those new values.
# Postgres requires an ADD VALUE to be committed before it can be used --
# see f32d13801269's own docstring/comments. This whole script's default
# `alembic upgrade head` runs as ONE command, and alembic/env.py wraps a
# whole `upgrade` invocation in a single transaction (not per-revision), so
# on a fresh database (nothing yet applied) a single `alembic upgrade head`
# would apply both migrations in that same transaction and fail with
# "unsafe use of new value ... must be committed before they can be used".
# Splitting into two `alembic upgrade` invocations forces a commit between
# them. Safe to run unconditionally on any DB state -- upgrading to an
# already-applied revision is a no-op.
alembic upgrade f32d13801269
alembic upgrade head

# Default of 4 workers, not 1 -- Phase 7 load testing found that a single
# process's synchronous-endpoint thread pool becomes the bottleneck well
# before the database does (see LOAD_TEST_RESULTS.md): occasional
# multi-second stalls appeared under 50 concurrent users with one worker.
# Override via UVICORN_WORKERS for a specific VPS's CPU count.
WORKERS="${UVICORN_WORKERS:-4}"

echo "Starting server with ${WORKERS} worker(s)..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$WORKERS"
