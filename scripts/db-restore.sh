#!/bin/bash
#
# TimeTrack Database Restore Script
#
# Usage:
#   ./scripts/db-restore.sh list              — List available backups
#   ./scripts/db-restore.sh download <file>   — Download a backup
#   ./scripts/db-restore.sh restore <file>    — Download + restore to database
#
# Requirements: curl, gunzip, psql (or docker exec)
# Run from the server where TimeTrack is deployed.
#
# Environment variables (set in .env or export before running):
#   S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_PREFIX
#   DATABASE_URL (or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
#   DOCKER_CONTAINER (optional — postgres container name for docker exec)

set -euo pipefail

# --- S3 Config (Hetzner Object Storage) ---
S3_ENDPOINT="${S3_ENDPOINT:-hel1.your-objectstorage.com}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-ZCYJHBURU9GG5X5KU83D}"
S3_SECRET_KEY="${S3_SECRET_KEY:-5BzARMGAqCCj6cIhA6c0RAh7hTYS23KOPJZCwJy3}"
S3_BUCKET="${S3_BUCKET:-mahope}"
S3_PREFIX="${S3_PREFIX:-timetrack}"

# --- Database Config ---
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5438}"
DB_NAME="${DB_NAME:-timetrack}"
DB_USER="${DB_USER:-timetrack}"
DB_PASSWORD="${DB_PASSWORD:-}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-}"

# Parse DATABASE_URL if set
if [ -n "${DATABASE_URL:-}" ]; then
  DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
  DB_PASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
  DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi

RESTORE_DIR="/tmp/timetrack-restore"
mkdir -p "$RESTORE_DIR"

# --- S3 helpers (using curl + AWS Signature v4-style for Hetzner) ---
s3_list() {
  local date_value
  date_value=$(date -u +"%a, %d %b %Y %H:%M:%S GMT" 2>/dev/null || date -R -u)
  local string_to_sign="GET\n\n\n${date_value}\n/${S3_BUCKET}/${S3_PREFIX}/"
  local signature
  signature=$(printf '%b' "$string_to_sign" | openssl dgst -sha1 -hmac "$S3_SECRET_KEY" -binary | base64)

  curl -sf \
    -H "Host: ${S3_BUCKET}.${S3_ENDPOINT}" \
    -H "Date: ${date_value}" \
    -H "Authorization: AWS ${S3_ACCESS_KEY}:${signature}" \
    "https://${S3_BUCKET}.${S3_ENDPOINT}/${S3_PREFIX}/" \
    | grep -oP '<Key>[^<]+</Key>' \
    | sed 's/<Key>//g; s/<\/Key>//g' \
    | sort -r
}

s3_download() {
  local key="$1"
  local output="$2"
  local date_value
  date_value=$(date -u +"%a, %d %b %Y %H:%M:%S GMT" 2>/dev/null || date -R -u)
  local string_to_sign="GET\n\n\n${date_value}\n/${S3_BUCKET}/${key}"
  local signature
  signature=$(printf '%b' "$string_to_sign" | openssl dgst -sha1 -hmac "$S3_SECRET_KEY" -binary | base64)

  curl -sf \
    -H "Host: ${S3_BUCKET}.${S3_ENDPOINT}" \
    -H "Date: ${date_value}" \
    -H "Authorization: AWS ${S3_ACCESS_KEY}:${signature}" \
    "https://${S3_BUCKET}.${S3_ENDPOINT}/${key}" \
    -o "$output"
}

run_psql() {
  if [ -n "$DOCKER_CONTAINER" ]; then
    docker exec -i "$DOCKER_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" "$@"
  else
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
  fi
}

# --- Commands ---
cmd_list() {
  echo "=== Tilgængelige backups (nyeste først) ==="
  echo ""
  local backups
  backups=$(s3_list)
  if [ -z "$backups" ]; then
    echo "Ingen backups fundet i s3://${S3_BUCKET}/${S3_PREFIX}/"
    exit 1
  fi
  local i=1
  while IFS= read -r key; do
    local filename
    filename=$(basename "$key")
    echo "  $i) $filename"
    i=$((i + 1))
  done <<< "$backups"
  echo ""
  echo "Brug: $0 restore <filnavn>"
}

cmd_download() {
  local filename="$1"
  local key="${S3_PREFIX}/${filename}"
  local output="${RESTORE_DIR}/${filename}"

  echo "Downloader $filename fra S3..."
  s3_download "$key" "$output"
  echo "Gemt i: $output"
  echo ""
  echo "Fil-størrelse: $(du -h "$output" | cut -f1)"
}

cmd_restore() {
  local filename="$1"
  local key="${S3_PREFIX}/${filename}"
  local output="${RESTORE_DIR}/${filename}"

  echo "========================================"
  echo "  TIMETRACK DATABASE RESTORE"
  echo "========================================"
  echo ""
  echo "  Backup:   $filename"
  echo "  Database: $DB_NAME @ $DB_HOST:$DB_PORT"
  echo "  Bruger:   $DB_USER"
  if [ -n "$DOCKER_CONTAINER" ]; then
    echo "  Container: $DOCKER_CONTAINER"
  fi
  echo ""
  echo "  ADVARSEL: Dette overskriver den nuværende database!"
  echo ""
  read -p "  Fortsæt? (skriv 'ja' for at bekræfte): " confirm
  if [ "$confirm" != "ja" ]; then
    echo "Afbrudt."
    exit 0
  fi

  # Download
  if [ ! -f "$output" ]; then
    echo ""
    echo "[1/3] Downloader backup..."
    s3_download "$key" "$output"
    echo "  OK — $(du -h "$output" | cut -f1)"
  else
    echo ""
    echo "[1/3] Backup allerede downloadet: $output"
  fi

  # Decompress if gzipped
  local sql_file="$output"
  if [[ "$filename" == *.gz ]]; then
    echo "[2/3] Dekomprimerer..."
    sql_file="${output%.gz}"
    gunzip -kf "$output"
    echo "  OK — $(du -h "$sql_file" | cut -f1)"
  else
    echo "[2/3] Ikke komprimeret, springer over."
  fi

  # Restore
  echo "[3/3] Gendanner database..."
  echo "  Dropper og genskaber schema..."
  run_psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true
  echo "  Importerer data..."
  run_psql < "$sql_file"
  echo ""
  echo "========================================"
  echo "  RESTORE FULDFØRT"
  echo "========================================"
  echo ""
  echo "  Husk at genstarte appen: docker restart <app-container>"

  # Cleanup
  rm -f "$sql_file"
  if [ "$sql_file" != "$output" ]; then
    rm -f "$output"
  fi
}

# --- Main ---
case "${1:-}" in
  list)
    cmd_list
    ;;
  download)
    if [ -z "${2:-}" ]; then
      echo "Brug: $0 download <filnavn>"
      exit 1
    fi
    cmd_download "$2"
    ;;
  restore)
    if [ -z "${2:-}" ]; then
      echo "Brug: $0 restore <filnavn>"
      echo "Kør '$0 list' for at se tilgængelige backups."
      exit 1
    fi
    cmd_restore "$2"
    ;;
  *)
    echo "TimeTrack Database Restore"
    echo ""
    echo "Brug:"
    echo "  $0 list                  — Vis tilgængelige backups"
    echo "  $0 download <filnavn>   — Download en backup"
    echo "  $0 restore <filnavn>    — Gendan database fra backup"
    echo ""
    echo "Eksempel:"
    echo "  $0 list"
    echo "  $0 restore timetrack-2026-05-12.sql.gz"
    ;;
esac
