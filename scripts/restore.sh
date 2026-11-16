#!/usr/bin/env bash
#
# Restore a backup made by scripts/backup.sh into a TimeTrack stack, then
# compare per-table row counts with the counts recorded at backup time.
# Intended for a fresh stack with the same .env (same ENCRYPTION_KEY).
#
# Usage:
#   scripts/restore.sh [--yes] [--skip-start] [--force] BACKUP_DIR
#
#   --yes         Do not ask for confirmation (the database is overwritten).
#   --skip-start  Leave app and cron stopped afterwards.
#   --force       Restore over a storage volume that already has files. Files
#                 not in the backup stay behind; without it the restore stops.
#
# Environment: TIMETRACK_DIR (stack directory), ENV_FILE, COMPOSE_PROJECT_NAME.
# Exit code is non-zero if any table's row count differs from the backup.
# Nothing secret is printed.

set -euo pipefail
# shellcheck source=lib/backup-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/backup-common.sh"

ASSUME_YES=0
START_APP=1
FORCE=0
BACKUP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --yes)
      ASSUME_YES=1
      shift
      ;;
    --skip-start)
      START_APP=0
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h | --help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) tt_die "unknown argument: $1 (see --help)" ;;
    *)
      [ -z "$BACKUP" ] || tt_die "only one backup directory can be given"
      BACKUP="$1"
      shift
      ;;
  esac
done

[ -n "$BACKUP" ] || tt_die "usage: scripts/restore.sh [--yes] [--skip-start] [--force] BACKUP_DIR"
[ -d "$BACKUP" ] || tt_die "backup directory not found: $BACKUP"
BACKUP="$(cd "$BACKUP" && pwd)"
for f in db.dump storage.tgz rowcounts.tsv SHA256SUMS; do
  [ -f "$BACKUP/$f" ] || tt_die "backup is incomplete: $f is missing in $BACKUP"
done

tt_require docker
[ -f "$ENV_FILE" ] || tt_die "env file not found: $ENV_FILE (restore it from the backup first: cp $BACKUP/env $ENV_FILE)"

tt_log "Verifying checksums"
(cd "$BACKUP" && tt_sha256 -c SHA256SUMS >/dev/null) || tt_die "checksum mismatch: the backup is damaged"

# Compare ENCRYPTION_KEY with the copy in the backup, by hash, never by value.
if [ -f "$BACKUP/env" ]; then
  current="$(tt_env_value "$ENV_FILE" ENCRYPTION_KEY || true)"
  saved="$(tt_env_value "$BACKUP/env" ENCRYPTION_KEY || true)"
  if [ -z "$current" ]; then
    tt_die "ENCRYPTION_KEY is missing in $ENV_FILE; encrypted fields would be unreadable"
  elif [ "$(printf '%s' "$current" | tt_sha256 | cut -d' ' -f1)" != "$(printf '%s' "$saved" | tt_sha256 | cut -d' ' -f1)" ]; then
    tt_die "ENCRYPTION_KEY in $ENV_FILE differs from the one in the backup; encrypted fields would be unreadable. Use the backup's env file."
  fi
else
  [ -n "$(tt_env_value "$ENV_FILE" ENCRYPTION_KEY || true)" ] ||
    tt_die "ENCRYPTION_KEY is missing in $ENV_FILE and the backup has no env copy"
  tt_warn "backup has no env copy: make sure ENCRYPTION_KEY is the one used when it was taken"
fi

# The storage restore extracts on top of the volume, so require it to be empty
# or missing; otherwise leftovers would make the result differ from the backup.
STORAGE_VOLUME="$(tt_storage_volume)"
if [ "$FORCE" != 1 ] && docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1; then
  if [ -n "$(docker run --rm -v "$STORAGE_VOLUME":/data:ro "$HELPER_IMAGE" ls -A /data)" ]; then
    tt_die "storage volume '$STORAGE_VOLUME' is not empty. Restore into a fresh stack, or pass --force to extract on top (existing files are kept)."
  fi
fi

tt_log ""
tt_log "This overwrites the database '$DB_NAME' and the storage volume '$(tt_storage_volume)'"
tt_log "of project '$(tt_project)' with backup $(basename "$BACKUP")."
if [ "$ASSUME_YES" != 1 ]; then
  [ -t 0 ] || tt_die "not a terminal: pass --yes to confirm"
  read -r -p "Type 'yes' to continue: " answer
  [ "$answer" = "yes" ] || {
    tt_log "Aborted."
    exit 1
  }
fi

tt_log "[1/5] Stopping app and cron"
tt_dc stop app cron >/dev/null 2>&1 || true

tt_log "[2/5] Starting database"
tt_dc up -d --wait "$DB_SERVICE" >/dev/null
tt_wait_db

tt_log "[3/5] Restoring database"
tt_dc exec -T "$DB_SERVICE" pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner <"$BACKUP/db.dump"

tt_log "[4/5] Restoring storage volume"
docker volume create "$STORAGE_VOLUME" >/dev/null
docker run --rm -v "$STORAGE_VOLUME":/data -v "$BACKUP":/backup:ro "$HELPER_IMAGE" \
  sh -c "tar xzf /backup/storage.tgz -C /data && chown -R $APP_UID_GID /data"

tt_log "[5/5] Comparing row counts with the backup"
ACTUAL="$(mktemp)"
trap 'rm -f "$ACTUAL"' EXIT
tt_row_counts >"$ACTUAL"
if diff -u "$BACKUP/rowcounts.tsv" "$ACTUAL" >/dev/null; then
  TABLES="$(wc -l <"$ACTUAL" | tr -d ' ')"
  tt_log "OK: all $TABLES tables have the same row counts as the backup."
else
  tt_warn "row counts differ from the backup (- backup, + restored):"
  diff -u "$BACKUP/rowcounts.tsv" "$ACTUAL" >&2 || true
  tt_die "restore verification failed"
fi

if [ "$START_APP" = 1 ]; then
  tt_log "Starting the full stack"
  tt_dc up -d >/dev/null
fi
tt_log "Restore complete."
