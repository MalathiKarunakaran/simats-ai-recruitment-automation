#!/bin/bash
# Nightly production backup: Postgres (pg_dump, custom format) + the MinIO
# volume (uploaded resumes, bulk-upload originals) + n8n (workflows and
# credentials, since 2026-10-30), with checksums, an archive-integrity
# check, retention, and an optional off-server copy.
#
# Runs on the VPS HOST as root from /etc/cron.d/simats-backup (see
# scripts/simats-backup.cron). It never stops, restarts or recreates any
# running container: the dump is taken through `docker exec` on the live
# Postgres container (pg_dump is a consistent snapshot, no lock on writers),
# and the MinIO volume is read through a throwaway alpine container mounted
# read-only.
#
# Output, per run, under $BACKUP_DIR (default /opt/simats/backups/nightly):
#   simats_recruitment-YYYYmmdd-HHMMSS.dump    pg_dump --format=custom (compressed)
#   minio_data-YYYYmmdd-HHMMSS.tar.gz          the MinIO volume
#   n8n-YYYYmmdd-HHMMSS.tar.gz                 n8n's exported workflows and
#                                              credentials, plus /opt/n8n's
#                                              .env and docker-compose.yml
#   <each>.sha256                              checksum, verified by verify_backup_restore.sh
#   LAST_SUCCESS                               timestamp of the last fully successful run
#
# Retention: daily files are kept RETAIN_DAYS days (default 30); the first
# backup taken on the 1st of a month is kept RETAIN_MONTHLY_DAYS days
# (default 400).
#
# Off-server copy: if BACKUP_REMOTE is set (an rsync destination such as
# "backup@host:/srv/simats-backups/" or a mounted path), the whole directory
# is mirrored there after each run. Unset, the script logs that no
# off-server copy was made -- it does NOT fail, so the local backup still
# happens -- and the Hostinger VPS backup is the only off-server copy.
#
# Credentials are read from the app's .env and never printed.
#
#   /opt/simats/app/scripts/backup_production.sh            # normal run
#   BACKUP_DIR=/tmp/bk /opt/simats/app/scripts/backup_production.sh   # elsewhere
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/simats/app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/simats/backups/nightly}"
PG_CONTAINER="${PG_CONTAINER:-simats_recruitment_postgres}"
MINIO_VOLUME="${MINIO_VOLUME:-app_minio_data}"
N8N_CONTAINER="${N8N_CONTAINER:-n8n}"
N8N_DIR="${N8N_DIR:-/opt/n8n}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
RETAIN_MONTHLY_DAYS="${RETAIN_MONTHLY_DAYS:-400}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

# --- credentials: names only from .env, values stay in variables ---
[ -f "$APP_DIR/.env" ] || fail ".env not found at $APP_DIR/.env"
PGUSER_VALUE="$(grep -E '^POSTGRES_USER=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r"')"
PGDB_VALUE="$(grep -E '^POSTGRES_DB=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r"')"
[ -n "$PGUSER_VALUE" ] && [ -n "$PGDB_VALUE" ] || fail "POSTGRES_USER / POSTGRES_DB missing from .env"

docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || fail "container $PG_CONTAINER not found"
[ "$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER")" = "true" ] || fail "$PG_CONTAINER is not running"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP="$BACKUP_DIR/${PGDB_VALUE}-${STAMP}.dump"
MINIO_TAR="$BACKUP_DIR/minio_data-${STAMP}.tar.gz"
N8N_TAR="$BACKUP_DIR/n8n-${STAMP}.tar.gz"

log "backup start -> $BACKUP_DIR"

# --- 1. Postgres: custom format (compressed, selective restore, pg_restore --list-able) ---
# The container's own pg_dump matches the server version exactly. Written
# to a temp name and renamed only after the integrity check, so a partial
# file is never mistaken for a backup.
docker exec "$PG_CONTAINER" pg_dump -U "$PGUSER_VALUE" -d "$PGDB_VALUE" \
  --format=custom --compress=9 --no-owner --no-privileges > "$DUMP.part" \
  || fail "pg_dump exited non-zero"
[ -s "$DUMP.part" ] || fail "pg_dump produced an empty file"

# Integrity: the archive's table of contents must be readable, and must
# contain the tables we cannot live without.
TOC="$(docker exec -i "$PG_CONTAINER" pg_restore --list < "$DUMP.part" 2>&1)" \
  || fail "pg_restore --list could not read the archive"
for table in vacancy_requests sanctioned_strength users employees; do
  grep -q "TABLE DATA public ${table} " <<<"$TOC" || fail "archive has no data entry for table ${table}"
done
mv "$DUMP.part" "$DUMP"
chmod 600 "$DUMP"
log "postgres dump ok: $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1)), $(grep -c 'TABLE DATA' <<<"$TOC") tables with data"

# --- 2. MinIO volume: read-only mount into a throwaway container ---
if docker volume inspect "$MINIO_VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "$MINIO_VOLUME":/data:ro -v "$BACKUP_DIR":/out alpine:3 \
    sh -c "tar czf /out/$(basename "$MINIO_TAR").part -C /data ." \
    || fail "minio volume tar failed"
  mv "$MINIO_TAR.part" "$MINIO_TAR"
  chmod 600 "$MINIO_TAR"
  log "minio volume ok: $(basename "$MINIO_TAR") ($(du -h "$MINIO_TAR" | cut -f1))"
else
  log "WARNING: volume $MINIO_VOLUME not found, skipping MinIO"
  MINIO_TAR=""
fi

# --- 2b. n8n: its own export, not a copy of the live SQLite file ---
# Copying database.sqlite while n8n writes to it (WAL mode) can capture a
# torn file; `n8n export` reads it through n8n and writes plain JSON.
# Credentials stay encrypted in the export, and the key that decrypts them
# (N8N_ENCRYPTION_KEY) lives in $N8N_DIR/.env -- which is why that file is
# in the archive: without it a restore gets workflows but no credentials.
# Restore: copy .env/docker-compose.yml back to $N8N_DIR, `docker compose up
# -d`, then `n8n import:credentials --input=...` and
# `n8n import:workflow --input=...` inside the container.
if [ "$(docker inspect -f '{{.State.Running}}' "$N8N_CONTAINER" 2>/dev/null)" = "true" ]; then
  N8N_STAGE="$(mktemp -d)"
  docker exec "$N8N_CONTAINER" sh -c 'rm -rf /tmp/n8n-backup && mkdir -p /tmp/n8n-backup &&
      n8n export:workflow --all --output=/tmp/n8n-backup/workflows.json >/dev/null &&
      n8n export:credentials --all --output=/tmp/n8n-backup/credentials.json >/dev/null' \
    || { rm -rf "$N8N_STAGE"; fail "n8n export failed"; }
  docker cp -q "$N8N_CONTAINER":/tmp/n8n-backup/. "$N8N_STAGE"/ || { rm -rf "$N8N_STAGE"; fail "n8n export copy failed"; }
  docker exec "$N8N_CONTAINER" rm -rf /tmp/n8n-backup
  cp -p "$N8N_DIR/.env" "$N8N_DIR/docker-compose.yml" "$N8N_STAGE"/ || { rm -rf "$N8N_STAGE"; fail "n8n config copy failed"; }
  [ -s "$N8N_STAGE/workflows.json" ] || { rm -rf "$N8N_STAGE"; fail "n8n export has no workflows"; }
  tar czf "$N8N_TAR.part" -C "$N8N_STAGE" . || { rm -rf "$N8N_STAGE"; fail "n8n tar failed"; }
  rm -rf "$N8N_STAGE"
  mv "$N8N_TAR.part" "$N8N_TAR"
  chmod 600 "$N8N_TAR"
  log "n8n ok: $(basename "$N8N_TAR") ($(du -h "$N8N_TAR" | cut -f1))"
else
  log "WARNING: container $N8N_CONTAINER not running, skipping n8n"
  N8N_TAR=""
fi

# --- 3. checksums ---
( cd "$BACKUP_DIR" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256" )
[ -n "$MINIO_TAR" ] && ( cd "$BACKUP_DIR" && sha256sum "$(basename "$MINIO_TAR")" > "$(basename "$MINIO_TAR").sha256" )
[ -n "$N8N_TAR" ] && ( cd "$BACKUP_DIR" && sha256sum "$(basename "$N8N_TAR")" > "$(basename "$N8N_TAR").sha256" )

# --- 4. retention ---
# Monthly keepers: anything taken on the 1st. Everything else: RETAIN_DAYS.
deleted=0
while IFS= read -r -d '' f; do
  name="$(basename "$f")"
  day="$(sed -E 's/.*-([0-9]{8})-[0-9]{6}\..*/\1/' <<<"$name")"
  if [ "${day:6:2}" = "01" ]; then
    if [ -n "$(find "$f" -mtime +"$RETAIN_MONTHLY_DAYS" -print)" ]; then rm -f "$f" "$f.sha256"; deleted=$((deleted+1)); fi
  elif [ -n "$(find "$f" -mtime +"$RETAIN_DAYS" -print)" ]; then
    rm -f "$f" "$f.sha256"; deleted=$((deleted+1))
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.tar.gz' \) -print0)
log "retention: removed $deleted old file(s); $(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' | wc -l) dump(s) kept, $(du -sh "$BACKUP_DIR" | cut -f1) total"

# --- 5. off-server copy ---
if [ -n "$BACKUP_REMOTE" ]; then
  rsync -a --delete-after -e "ssh -o BatchMode=yes -o ConnectTimeout=20" "$BACKUP_DIR/" "$BACKUP_REMOTE" \
    || fail "off-server rsync to $BACKUP_REMOTE failed"
  log "off-server copy ok -> $BACKUP_REMOTE"
else
  log "no BACKUP_REMOTE configured: no off-server copy made by this script (Hostinger VPS backups are the only off-server copy)"
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/LAST_SUCCESS"
log "backup complete"
