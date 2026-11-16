#!/usr/bin/env bash
#
# End-to-end test of scripts/backup.sh and scripts/restore.sh on throwaway
# Docker stacks. Needs Docker and the repo's node_modules (npm ci).
#
#   1. Start stack A (database only), migrate, seed test data, add a file to
#      the storage volume.
#   2. Back it up.
#   3. Restore into stack B, which is empty, and compare the row count of
#      every table plus the storage file's checksum.
#   4. Prove the check can fail: restore a backup whose recorded counts were
#      altered, and expect a non-zero exit.
#
# No fixed host ports are used (the database gets a random localhost port for
# seeding), the compose projects are unique per run, and everything is removed
# on exit. Secrets are generated per run and never printed. Only counts are
# compared.
#
# Usage: scripts/test-restore.sh

set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/backup-common.sh
. "$REPO_DIR/scripts/lib/backup-common.sh"

tt_require docker npx openssl

RUN_ID="ttrestore-$$-$(date +%s)"
WORK="$(mktemp -d)"
PROJECT_A="$RUN_ID-a"
PROJECT_B="$RUN_ID-b"

cleanup() {
  local rc=$?
  for p in "$PROJECT_A" "$PROJECT_B"; do
    COMPOSE_PROJECT_NAME="$p" TIMETRACK_DIR="$WORK/stack" ENV_FILE="$WORK/stack/.env" \
      bash -c '. "'"$REPO_DIR"'/scripts/lib/backup-common.sh"; tt_dc down -v --remove-orphans' >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
  [ $rc -eq 0 ] && tt_log "test-restore: PASSED" || tt_log "test-restore: FAILED (exit $rc)"
  exit $rc
}
trap cleanup EXIT

# --- Stack directory: compose file, generated env, db port override --------
mkdir -p "$WORK/stack" "$WORK/out"
cp "$REPO_DIR/docker-compose.yml" "$WORK/stack/docker-compose.yml"
cat >"$WORK/stack/docker-compose.override.yml" <<'YML'
services:
  db:
    ports:
      - "127.0.0.1::5432"
YML
umask 077
{
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
  echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
  echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
  echo "CRON_SECRET=$(openssl rand -hex 32)"
} >"$WORK/stack/.env"
umask 022
export TIMETRACK_DIR="$WORK/stack" ENV_FILE="$WORK/stack/.env"

# The compose file's app service reads env_file: .env, which exists above.
# Only the db service is ever started, so nothing is built.

# --- 1. Stack A: schema, seed data, storage file ---------------------------
export COMPOSE_PROJECT_NAME="$PROJECT_A"
tt_log "[A] starting database ($PROJECT_A)"
tt_dc up -d --wait db >/dev/null
tt_wait_db
PORT="$(tt_dc port db 5432 | sed 's/.*://')"
PGPASS="$(tt_env_value "$ENV_FILE" POSTGRES_PASSWORD)"
export DATABASE_URL="postgresql://$DB_USER:$PGPASS@127.0.0.1:$PORT/$DB_NAME"

tt_log "[A] migrating and seeding test data"
(cd "$REPO_DIR" && npx tsx scripts/migrate-safe.ts >/dev/null && npx tsx scripts/seed.ts >/dev/null)
unset DATABASE_URL

docker volume create "$(tt_storage_volume)" >/dev/null
docker run --rm -v "$(tt_storage_volume)":/data "$HELPER_IMAGE" \
  sh -c 'mkdir -p /data/uploads && head -c 4096 /dev/urandom > /data/uploads/probe.bin'
STORAGE_SUM_A="$(docker run --rm -v "$(tt_storage_volume)":/data "$HELPER_IMAGE" sha256sum /data/uploads/probe.bin | cut -d' ' -f1)"

tt_row_counts >"$WORK/counts-a.tsv"
TABLES="$(wc -l <"$WORK/counts-a.tsv" | tr -d ' ')"
NONEMPTY="$(awk -F'\t' '$2 > 0' "$WORK/counts-a.tsv" | wc -l | tr -d ' ')"
tt_log "[A] $TABLES tables, $NONEMPTY with rows"
[ "$NONEMPTY" -gt 0 ] || tt_die "seed produced no rows; the test would prove nothing"

# --- 2. Back up -------------------------------------------------------------
tt_log "[A] running scripts/backup.sh"
"$REPO_DIR/scripts/backup.sh" --out "$WORK/out" | tee "$WORK/backup.log" | sed 's/^/    /'
BACKUP="$(find "$WORK/out" -mindepth 1 -maxdepth 1 -type d -name 'timetrack-*' | head -n 1)"
[ -n "$BACKUP" ] || tt_die "backup directory not created"
grep -q "ENCRYPTION_KEY" "$WORK/backup.log" || tt_die "backup output does not remind about ENCRYPTION_KEY"
KEY="$(tt_env_value "$ENV_FILE" ENCRYPTION_KEY)"
for secret in "$KEY" "$PGPASS"; do
  if grep -qF -- "$secret" "$WORK/backup.log"; then tt_die "backup output leaks a secret"; fi
done
diff -q "$WORK/counts-a.tsv" "$BACKUP/rowcounts.tsv" >/dev/null || tt_die "recorded counts differ from stack A"

# --- 3. Restore into an empty stack B ---------------------------------------
export COMPOSE_PROJECT_NAME="$PROJECT_B"
tt_log "[B] restoring into an empty stack ($PROJECT_B)"
if docker volume inspect "$(tt_storage_volume)" >/dev/null 2>&1; then
  tt_die "stack B is not empty"
fi
"$REPO_DIR/scripts/restore.sh" --yes --skip-start "$BACKUP" | tee "$WORK/restore.log" | sed 's/^/    /'
grep -q "^OK: all $TABLES tables" "$WORK/restore.log" || tt_die "restore did not report matching counts"
for secret in "$KEY" "$PGPASS"; do
  if grep -qF -- "$secret" "$WORK/restore.log"; then tt_die "restore output leaks a secret"; fi
done

# Independent check, not trusting restore.sh's own comparison.
tt_row_counts >"$WORK/counts-b.tsv"
diff "$WORK/counts-a.tsv" "$WORK/counts-b.tsv" || tt_die "row counts differ after restore"
STORAGE_SUM_B="$(docker run --rm -v "$(tt_storage_volume)":/data "$HELPER_IMAGE" sha256sum /data/uploads/probe.bin | cut -d' ' -f1)"
[ "$STORAGE_SUM_A" = "$STORAGE_SUM_B" ] || tt_die "storage file differs after restore"
OWNER="$(docker run --rm -v "$(tt_storage_volume)":/data "$HELPER_IMAGE" stat -c '%u:%g' /data/uploads/probe.bin)"
[ "$OWNER" = "$APP_UID_GID" ] || tt_die "storage file owner is $OWNER, expected $APP_UID_GID"
tt_log "[B] $TABLES tables identical, storage file identical, owner $OWNER"

# --- 4. Negative control: the comparison must be able to fail ---------------
tt_log "[B] negative control: restore with tampered row counts must fail"
BAD="$WORK/out/tampered"
cp -r "$BACKUP" "$BAD"
FIRST_NONEMPTY="$(awk -F'\t' '$2 > 0 {print $1; exit}' "$BACKUP/rowcounts.tsv")"
awk -F'\t' -v t="$FIRST_NONEMPTY" 'BEGIN{OFS="\t"} $1==t {$2=$2+1} {print}' "$BACKUP/rowcounts.tsv" >"$BAD/rowcounts.tsv"
(cd "$BAD" && tt_sha256 db.dump storage.tgz rowcounts.tsv env >SHA256SUMS)
if "$REPO_DIR/scripts/restore.sh" --yes --skip-start --force "$BAD" >"$WORK/bad.log" 2>&1; then
  tt_die "restore accepted tampered row counts"
fi
grep -q "restore verification failed" "$WORK/bad.log" || tt_die "tampered restore failed for the wrong reason"
tt_log "[B] tampered counts rejected as expected (table $FIRST_NONEMPTY)"

# Negative control 3: restoring onto a stack that already has files is refused.
if "$REPO_DIR/scripts/restore.sh" --yes --skip-start "$BACKUP" >"$WORK/bad3.log" 2>&1; then
  tt_die "restore accepted a non-empty storage volume"
fi
grep -q "is not empty" "$WORK/bad3.log" || tt_die "non-empty volume refused for the wrong reason"
tt_log "[B] non-empty storage volume refused as expected"

# Negative control 2: a damaged archive is caught by the checksum.
BAD2="$WORK/out/damaged"
cp -r "$BACKUP" "$BAD2"
printf 'x' >>"$BAD2/db.dump"
if "$REPO_DIR/scripts/restore.sh" --yes --skip-start "$BAD2" >"$WORK/bad2.log" 2>&1; then
  tt_die "restore accepted a damaged dump"
fi
grep -q "checksum mismatch" "$WORK/bad2.log" || tt_die "damaged dump failed for the wrong reason"
tt_log "[B] damaged dump rejected as expected"
