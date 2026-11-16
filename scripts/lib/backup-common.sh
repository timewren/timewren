# Shared helpers for scripts/backup.sh, scripts/restore.sh and
# scripts/test-restore.sh. Sourced, not executed.
#
# Nothing here prints values from the env file. The only things written to
# the terminal are paths, sizes, table names and row counts.

# Directory holding docker-compose.yml and .env. Defaults to the repository
# root; set TIMETRACK_DIR when the stack lives elsewhere.
TIMETRACK_DIR="${TIMETRACK_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-$TIMETRACK_DIR/.env}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-timetrack}"
DB_NAME="${DB_NAME:-timetrack}"
# Matches the app user in the Dockerfile; the storage volume must belong to it.
APP_UID_GID="${APP_UID_GID:-1001:1001}"
HELPER_IMAGE="${HELPER_IMAGE:-alpine:3}"

tt_log() { printf '%s\n' "$*"; }
tt_warn() { printf 'WARNING: %s\n' "$*" >&2; }
tt_die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

tt_require() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || tt_die "'$cmd' is required but not installed"
  done
}

# Run docker compose against the stack. COMPOSE_PROJECT_NAME and COMPOSE_FILE
# are honoured by docker compose itself.
tt_dc() {
  (cd "$TIMETRACK_DIR" && docker compose --env-file "$ENV_FILE" "$@")
}

# Compose project name, as docker compose resolves it for this stack (the
# exported COMPOSE_PROJECT_NAME, a COMPOSE_PROJECT_NAME in the env file, or the
# directory name). Falls back to "timetrack" if compose cannot tell.
_TT_PROJECT=""
tt_project() {
  if [ -z "$_TT_PROJECT" ]; then
    local json name=""
    json="$(tt_dc config --format json 2>/dev/null | tr -d '\n ')" || json=""
    name="$(printf '%s' "$json" | grep -o '^{"name":"[^"]*"' | cut -d'"' -f4 || true)"
    [ -n "$name" ] || name="${COMPOSE_PROJECT_NAME:-$(tt_env_value "$ENV_FILE" COMPOSE_PROJECT_NAME 2>/dev/null || true)}"
    _TT_PROJECT="${name:-timetrack}"
  fi
  printf '%s' "$_TT_PROJECT"
}

tt_storage_volume() { printf '%s_storage' "$(tt_project)"; }

# TT_PSQL_DB overrides the database (used to count rows in a scratch copy).
tt_psql() {
  tt_dc exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "${TT_PSQL_DB:-$DB_NAME}" -X -q -v ON_ERROR_STOP=1 "$@"
}

# Wait until the db service accepts connections (up to ~60 s).
tt_wait_db() {
  local i
  for i in $(seq 1 60); do
    if tt_dc exec -T "$DB_SERVICE" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  tt_die "database did not become ready"
}

# Exact row count per table in the public schema: "<table><TAB><count>",
# sorted by table name. Counts only, never row contents.
tt_row_counts() {
  tt_psql -At -F $'\t' -c "
    SELECT table_name,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
                               false, true, '')))[1]::text
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name COLLATE \"C\";"
}

# Read one key from the env file without printing it. Returns the value on
# stdout (for hashing or length checks only; callers must not echo it).
tt_env_value() {
  local file="$1" key="$2" line
  [ -f "$file" ] || return 1
  line="$(tr -d '\r' <"$file" | grep -E "^(export[[:space:]]+)?${key}=" | tail -n 1)" || return 1
  line="${line#export}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#"${key}="}"
  case "$line" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "$line"
}

tt_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

tt_encryption_key_reminder() {
  tt_log ""
  tt_log "IMPORTANT: keep ENCRYPTION_KEY together with this backup."
  tt_log "Without the exact key, encrypted fields (integration tokens, API keys,"
  tt_log "2FA secrets) cannot be decrypted after a restore."
}
