#!/usr/bin/env bash
#
# Back up a self-hosted TimeTrack stack: PostgreSQL dump, the storage volume
# and a copy of .env (which holds ENCRYPTION_KEY). Recipe from
# docs/self-hosting.md ("Backup and restore").
#
# Usage:
#   scripts/backup.sh [--out DIR] [--no-env]
#
#   --out DIR   Where to write the backup (default: ./backups under the stack
#               directory). A timestamped sub-directory is created.
#   --no-env    Do not copy .env into the backup. You then MUST store
#               ENCRYPTION_KEY yourself, or encrypted fields are lost.
#
# Environment: TIMETRACK_DIR (stack directory), ENV_FILE, COMPOSE_PROJECT_NAME.
# The database service must be running. Nothing secret is printed.

set -euo pipefail
# shellcheck source=lib/backup-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/backup-common.sh"

OUT_DIR="${BACKUP_DIR:-$TIMETRACK_DIR/backups}"
INCLUDE_ENV=1

while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      [ $# -ge 2 ] || tt_die "--out needs a directory"
      OUT_DIR="$2"
      shift 2
      ;;
    --no-env)
      INCLUDE_ENV=0
      shift
      ;;
    -h | --help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) tt_die "unknown argument: $1 (see --help)" ;;
  esac
done

tt_require docker
[ -f "$ENV_FILE" ] || tt_die "env file not found: $ENV_FILE"
[ -n "$(tt_env_value "$ENV_FILE" ENCRYPTION_KEY || true)" ] ||
  tt_warn "ENCRYPTION_KEY is empty or missing in $ENV_FILE"

# Fail early if the database is not up, before creating any files.
tt_dc exec -T "$DB_SERVICE" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 ||
  tt_die "database service '$DB_SERVICE' is not running (docker compose up -d $DB_SERVICE)"

STORAGE_VOLUME="$(tt_storage_volume)"
docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 ||
  tt_die "storage volume '$STORAGE_VOLUME' not found (set COMPOSE_PROJECT_NAME if you use another project name)"

umask 077
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/timetrack-$STAMP"
PARTIAL="$DEST.partial"
[ ! -e "$DEST" ] || tt_die "$DEST already exists"
mkdir "$PARTIAL"
trap 'rm -rf "$PARTIAL"' EXIT

tt_log "[1/4] Dumping database"
tt_dc exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -Fc "$DB_NAME" >"$PARTIAL/db.dump"
[ -s "$PARTIAL/db.dump" ] || tt_die "database dump is empty"

tt_log "[2/4] Archiving storage volume ($STORAGE_VOLUME)"
docker run --rm -v "$STORAGE_VOLUME":/data:ro -v "$PARTIAL":/backup "$HELPER_IMAGE" \
  tar czf /backup/storage.tgz -C /data .

# Count rows in a scratch restore of the dump, not in the live database, so the
# counts match the dump exactly even if the app wrote in between.
tt_log "[3/4] Recording row counts (from the dump)"
SCRATCH_DB="tt_count_$$"
cleanup_scratch() { tt_dc exec -T "$DB_SERVICE" dropdb -U "$DB_USER" --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true; }
trap 'cleanup_scratch; rm -rf "$PARTIAL"' EXIT
tt_dc exec -T "$DB_SERVICE" createdb -U "$DB_USER" "$SCRATCH_DB"
tt_dc exec -T "$DB_SERVICE" pg_restore -U "$DB_USER" -d "$SCRATCH_DB" --no-owner <"$PARTIAL/db.dump" >/dev/null
TT_PSQL_DB="$SCRATCH_DB" tt_row_counts >"$PARTIAL/rowcounts.tsv"
cleanup_scratch
trap 'rm -rf "$PARTIAL"' EXIT
[ -s "$PARTIAL/rowcounts.tsv" ] || tt_die "no tables found in database '$DB_NAME'"

if [ "$INCLUDE_ENV" = 1 ]; then
  tt_log "[4/4] Copying env file"
  cp "$ENV_FILE" "$PARTIAL/env"
  chmod 600 "$PARTIAL/env"
else
  tt_log "[4/4] Skipping env file (--no-env)"
fi

FILES=(db.dump storage.tgz rowcounts.tsv)
[ "$INCLUDE_ENV" = 1 ] && FILES+=(env)
(cd "$PARTIAL" && tt_sha256 "${FILES[@]}" >SHA256SUMS)

trap - EXIT
mv "$PARTIAL" "$DEST"

TABLES="$(wc -l <"$DEST/rowcounts.tsv" | tr -d ' ')"
tt_log ""
tt_log "Backup written to: $DEST"
tt_log "  db.dump       $(du -h "$DEST/db.dump" | cut -f1)  ($TABLES tables)"
tt_log "  storage.tgz   $(du -h "$DEST/storage.tgz" | cut -f1)"
if [ "$INCLUDE_ENV" = 1 ]; then
  tt_log "  env           copy of $(basename "$ENV_FILE"), mode 600 (contains secrets: protect it, encrypt it before it leaves this machine)"
else
  tt_warn "env file not included: store ENCRYPTION_KEY separately and safely"
fi
tt_encryption_key_reminder
tt_log "Copy the backup off this machine, and test a restore with scripts/test-restore.sh."
