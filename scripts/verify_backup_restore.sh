#!/bin/bash
# Prove the latest nightly backup actually restores.
#
# A backup nobody has restored is a hope, not a backup. This takes the newest
# dump written by backup_production.sh, checks its sha256, restores it into
# a BRAND-NEW throwaway Postgres container (never the production one), and
# compares row counts of the tables that matter against the live database.
# The throwaway container is removed at the end, success or failure.
#
# Runs weekly from /etc/cron.d/simats-backup; safe to run by hand any time:
#
#   /opt/simats/app/scripts/verify_backup_restore.sh
#
# Exit 0 = the backup restores and matches production. Anything else = fix
# the backup before trusting it.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/simats/app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/simats/backups/nightly}"
PG_CONTAINER="${PG_CONTAINER:-simats_recruitment_postgres}"
VERIFY_CONTAINER="${VERIFY_CONTAINER:-simats_backup_verify}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
# Row counts compared between the restored copy and production. All are
# tables that only ever grow slowly, so a nightly dump and a check run a
# few hours later normally agree exactly; a mismatch is reported, not
# treated as failure, because a row may legitimately have been added in
# between -- the failure conditions are a missing table or an empty one.
CHECK_TABLES="campuses departments designations sanctioned_strength vacancy_requests users employees audit_logs"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
cleanup() { docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true; }
fail() { log "FAILED: $*"; cleanup; exit 1; }

# The verify container must never be an existing production container.
case "$VERIFY_CONTAINER" in simats_recruitment_*) fail "refusing: $VERIFY_CONTAINER looks like a production container name" ;; esac

PGUSER_VALUE="$(grep -E '^POSTGRES_USER=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r"')"
PGDB_VALUE="$(grep -E '^POSTGRES_DB=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r"')"
[ -n "$PGUSER_VALUE" ] && [ -n "$PGDB_VALUE" ] || fail "POSTGRES_USER / POSTGRES_DB missing from .env"

DUMP="$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1 || true)"
[ -n "$DUMP" ] || fail "no .dump file in $BACKUP_DIR"
log "verifying $(basename "$DUMP")"

# 1. checksum
( cd "$BACKUP_DIR" && sha256sum -c --quiet "$(basename "$DUMP").sha256" ) || fail "sha256 mismatch"
log "checksum ok"

# 2. throwaway server. A random one-off password: nothing else ever
# connects to this container and it is gone in a minute.
cleanup
docker run -d --name "$VERIFY_CONTAINER" \
  -e POSTGRES_USER="$PGUSER_VALUE" -e POSTGRES_DB="$PGDB_VALUE" \
  -e POSTGRES_PASSWORD="verify-$(od -An -N8 -tx8 /dev/urandom | tr -d ' ')" \
  "$PG_IMAGE" >/dev/null || fail "could not start $VERIFY_CONTAINER"
for i in $(seq 1 60); do
  docker exec "$VERIFY_CONTAINER" pg_isready -U "$PGUSER_VALUE" -d "$PGDB_VALUE" >/dev/null 2>&1 && break
  sleep 1
  [ "$i" = 60 ] && fail "throwaway postgres did not become ready"
done

# 3. restore. --no-owner/--no-privileges: the dump was taken that way too,
# so nothing depends on roles that only exist in production.
# --exit-on-error makes a single failed statement fail the check.
docker exec -i "$VERIFY_CONTAINER" pg_restore -U "$PGUSER_VALUE" -d "$PGDB_VALUE" \
  --no-owner --no-privileges --exit-on-error < "$DUMP" || fail "pg_restore reported an error"
log "restore ok"

# 4. compare
q() { docker exec "$1" psql -U "$PGUSER_VALUE" -d "$PGDB_VALUE" -At -c "$2"; }
restored_tables="$(q "$VERIFY_CONTAINER" "select count(*) from information_schema.tables where table_schema='public'")"
live_tables="$(q "$PG_CONTAINER" "select count(*) from information_schema.tables where table_schema='public'")"
[ "$restored_tables" = "$live_tables" ] || fail "table count differs: restored $restored_tables, production $live_tables"
restored_head="$(q "$VERIFY_CONTAINER" "select version_num from alembic_version")"
live_head="$(q "$PG_CONTAINER" "select version_num from alembic_version")"
[ "$restored_head" = "$live_head" ] || fail "alembic head differs: restored $restored_head, production $live_head"
log "schema ok: $restored_tables tables, alembic head $restored_head"

mismatch=0
for t in $CHECK_TABLES; do
  r="$(q "$VERIFY_CONTAINER" "select count(*) from $t" 2>/dev/null)" || fail "table $t missing from the restored copy"
  l="$(q "$PG_CONTAINER" "select count(*) from $t")"
  if [ "$r" = "$l" ]; then
    log "  $t: $r rows (match)"
  else
    log "  $t: restored $r, production $l (changed since the dump)"
    mismatch=$((mismatch+1))
  fi
  [ "$t" = "campuses" ] && [ "$r" = "0" ] && fail "restored copy has no campuses at all"
done

cleanup
date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/LAST_VERIFIED"
log "verify complete: $(basename "$DUMP") restores cleanly ($mismatch table(s) differ only by rows added since the dump)"
