#!/usr/bin/env bash
# TimeWren self-host installer: from a fresh Linux box with Docker to a running
# instance with one command. Read it first, it is short.
#
#   curl -fsSL https://timewren.com/install.sh | bash
#   # Or, inside a checkout: ./scripts/install.sh
#
# What it does:
#   1. Checks that Docker and Docker Compose v2.24+ are installed and reachable.
#   2. Creates .env from .env.example with fresh random secrets
#      (POSTGRES_PASSWORD, BETTER_AUTH_SECRET, ENCRYPTION_KEY, CRON_SECRET).
#   3. Pulls and starts the stack, or rebuilds it in a source checkout.
#   4. Waits until the app reports healthy.
#
# What it does not do:
#   - Install Docker. If Docker is missing it tells you where to get it and
#     stops. The script never calls sudo.
#   - Overwrite an existing .env. Run it again and it keeps your secrets and
#     just (re)starts the stack, so it is safe to repeat.
#   - Print secrets. They are written to .env (mode 600) and nowhere else.
#
# Options:
#   --url URL      Public URL people will open (default http://localhost:PORT).
#                  Only used when .env is created; read at runtime.
#   --port PORT    Host port for the app (writes APP_PORT; default 3000). Without
#                  --url, the URL becomes http://localhost:PORT to match.
#   --version TAG  GitHub release tag (standalone default: latest release).
#   --dir PATH     Installation directory (default: checkout root or current dir).
#   --with-caddy --domain HOST  Add automatic HTTPS; DNS must point here.
#   --no-start     Create .env and stop before starting the stack.
#   --timeout SEC  How long to wait for the app to become healthy (default 900).
#   -h, --help     Show this text.
#
# Full guide: docs/self-hosting.md

set -euo pipefail

MIN_COMPOSE_MAJOR=2
MIN_COMPOSE_MINOR=24

APP_URL="${NEXT_PUBLIC_APP_URL:-}"
APP_PORT_ARG="${APP_PORT:-}"
VERSION="${TIMEWREN_VERSION:-}"
WITH_CADDY=0
DOMAIN="${CADDY_DOMAIN:-}"
INSTALL_DIR="${TIMEWREN_INSTALL_DIR:-}"
START=1
TIMEOUT=900

say() { printf '%s\n' "$*"; }
err() { printf 'Error: %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

usage() {
  say 'TimeWren installer: --url URL --port PORT --version TAG --dir PATH'
  say '  --with-caddy --domain HOST  Enable automatic HTTPS (ports 80/443)'
  say '  --no-start --timeout SEC --help'
  say 'Requires Docker Compose >=2.24. Keeps existing .env and secrets.'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) [ $# -ge 2 ] || die "--url needs a value"; APP_URL="${2%/}"; shift 2 ;;
    --port) [ $# -ge 2 ] || die "--port needs a value"; APP_PORT_ARG="$2"; shift 2 ;;
    --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift 2 ;;
    --dir) [ $# -ge 2 ] || die "--dir needs a value"; INSTALL_DIR="$2"; shift 2 ;;
    --with-caddy) WITH_CADDY=1; shift ;;
    --domain) [ $# -ge 2 ] || die "--domain needs a value"; DOMAIN="$2"; shift 2 ;;
    --no-start) START=0; shift ;;
    --timeout) [ $# -ge 2 ] || die "--timeout needs a value"; TIMEOUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

case "$TIMEOUT" in ''|*[!0-9]*) die "--timeout must be a number of seconds" ;; esac
if [ -n "$APP_PORT_ARG" ]; then
  case "$APP_PORT_ARG" in ''|*[!0-9]*) die "--port must be a number" ;; esac
  [ "$APP_PORT_ARG" -ge 1 ] && [ "$APP_PORT_ARG" -le 65535 ] || die "--port must be between 1 and 65535"
fi
if [ -n "$APP_URL" ]; then
  [[ "$APP_URL" != *[$'\n\r\t $\"\'`#\\']* ]] || die "--url contains unsafe characters"
  [[ "$APP_URL" != *@* ]] || die "--url must not include credentials"
  case "$APP_URL" in http://*|https://*) ;; *) die "--url must start with http:// or https://" ;; esac
fi

# A custom port without an explicit URL: keep the runtime origin consistent.
if [ -n "$APP_PORT_ARG" ] && [ -z "$APP_URL" ] && [ "$WITH_CADDY" -eq 0 ]; then
  APP_URL="http://localhost:$APP_PORT_ARG"
fi

if [ "$WITH_CADDY" -eq 1 ]; then
  [[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] && [[ "$DOMAIN" == *.* ]] || die "--with-caddy needs --domain with a DNS hostname"
  [ -z "$APP_URL" ] || [ "$APP_URL" = "https://$DOMAIN" ] || die "--url must match https://DOMAIN with Caddy"
  APP_URL="https://$DOMAIN"
fi
[[ -z "$VERSION" || "$VERSION" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "Invalid --version tag"

# BASH_SOURCE is empty when invoked as curl | bash.
SOURCE="${BASH_SOURCE[0]:-}"
if [ -z "$INSTALL_DIR" ] && [ -n "$SOURCE" ] && [ -f "$(dirname "$SOURCE")/../.env.example" ] && [ -f "$(dirname "$SOURCE")/../docker-compose.yml" ]; then
  ROOT="$(cd "$(dirname "$SOURCE")/.." && pwd)"
else
  INSTALL_DIR="${INSTALL_DIR:-$PWD}"
  mkdir -p "$INSTALL_DIR"
  ROOT="$(cd "$INSTALL_DIR" && pwd)"
fi
cd "$ROOT"

# --- 1. Docker and Compose ----------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed."
  say "Install Docker Engine with the Compose plugin first, then run this script again:" >&2
  say "  https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if ! compose_raw="$(docker compose version --short 2>/dev/null)"; then
  err "'docker compose' (Compose v2 plugin) is not available."
  say "Install the Compose plugin: https://docs.docker.com/compose/install/" >&2
  exit 1
fi
compose_ver="${compose_raw#v}"
c_major="${compose_ver%%.*}"
c_rest="${compose_ver#*.}"
c_minor="${c_rest%%.*}"
case "$c_major$c_minor" in
  ''|*[!0-9]*) die "Could not read the Docker Compose version from '$compose_raw'." ;;
esac
if [ "$c_major" -lt "$MIN_COMPOSE_MAJOR" ] \
  || { [ "$c_major" -eq "$MIN_COMPOSE_MAJOR" ] && [ "$c_minor" -lt "$MIN_COMPOSE_MINOR" ]; }; then
  die "Docker Compose $compose_ver is too old, v$MIN_COMPOSE_MAJOR.$MIN_COMPOSE_MINOR or newer is required."
fi

if ! docker info >/dev/null 2>&1; then
  err "Cannot reach the Docker daemon."
  say "Is Docker running, and is your user allowed to use it?" >&2
  say "  Start it:      sudo systemctl start docker" >&2
  say "  Allow yourself: sudo usermod -aG docker \"\$USER\" (then log in again)" >&2
  exit 1
fi
say "Docker OK (Compose $compose_ver)."

# Download matching release files only for a standalone installation.
if [ ! -f docker-compose.yml ] || [ ! -f .env.example ]; then
  command -v curl >/dev/null 2>&1 || die "curl is required to download release files"
  if [ -z "$VERSION" ] && [ -f .env ]; then
    VERSION="$(sed -n 's/^TIMEWREN_VERSION=//p' .env | head -n 1)"
  fi
  if [ -z "$VERSION" ] && [ -f .timewren-release ]; then
    VERSION="$(cat .timewren-release)"
  fi
  if [ -z "$VERSION" ]; then
    VERSION="$(curl -fsSL https://api.github.com/repos/timewren/timewren/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  fi
  [[ "$VERSION" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "Cannot resolve latest release; pass --version TAG"
  # Preserve the release on retry if the second download fails.
  printf '%s\n' "$VERSION" > .timewren-release
  for file in docker-compose.yml .env.example; do
    [ -f "$file" ] && continue
    download="$(mktemp "$file.XXXXXX")"
    if ! curl -fsSL "https://raw.githubusercontent.com/timewren/timewren/$VERSION/$file" -o "$download"; then
      rm -f "$download"
      die "Could not download $file for the selected release"
    fi
    mv "$download" "$file"
  done
fi
if [ "$WITH_CADDY" -eq 1 ] && [ ! -f docker-compose.caddy.yml ]; then
  if [ -z "$VERSION" ] && [ -f .env ]; then
    VERSION="$(sed -n 's/^TIMEWREN_VERSION=//p' .env | head -n 1)"
  fi
  [[ "$VERSION" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "Pass --version TAG to download the Caddy overlay"
  download="$(mktemp docker-compose.caddy.yml.XXXXXX)"
  if ! curl -fsSL "https://raw.githubusercontent.com/timewren/timewren/${VERSION:-latest}/docker-compose.caddy.yml" -o "$download"; then
    rm -f "$download"
    die "Could not download Caddy overlay; pass --version TAG"
  fi
  mv "$download" docker-compose.caddy.yml
fi

# --- 2. .env ------------------------------------------------------------------

# Random hex without printing it. 32 bytes = 64 hex characters.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

if [ -e .env ]; then
  say ".env already exists: leaving it untouched (secrets are kept)."
  for v in POSTGRES_PASSWORD BETTER_AUTH_SECRET ENCRYPTION_KEY CRON_SECRET; do
    if ! grep -Eq "^${v}=.+" .env; then
      die "$v is empty or missing in .env. Fill it in (openssl rand -hex 32) and run again."
    fi
  done
  if [ "$WITH_CADDY" -eq 1 ]; then
    grep -Fxq "CADDY_DOMAIN=$DOMAIN" .env && grep -Fxq 'COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml' .env \
      || die "Existing .env: set CADDY_DOMAIN and COMPOSE_FILE manually to enable Caddy; no settings were changed."
  fi
  if [ -n "$APP_URL" ] || [ -n "$APP_PORT_ARG" ] || [ -n "$VERSION" ]; then
    say "Note: --url/--port/--version are ignored because .env already exists. Edit .env instead."
  fi
else
  umask 077
  tmp="$(mktemp .env.XXXXXX)"
  trap 'rm -f "$tmp"' EXIT
  # Secrets go through the environment, not argv, so they never show up in `ps`.
  PG="$(gen_secret)" AUTH="$(gen_secret)" ENC="$(gen_secret)" CRON="$(gen_secret)" \
  URL="$APP_URL" PORT="$APP_PORT_ARG" PIN="$VERSION" DOMAIN_VALUE="$DOMAIN" CADDY="$WITH_CADDY" \
  awk '
    BEGIN {
      v["POSTGRES_PASSWORD"] = ENVIRON["PG"]
      v["BETTER_AUTH_SECRET"] = ENVIRON["AUTH"]
      v["ENCRYPTION_KEY"] = ENVIRON["ENC"]
      v["CRON_SECRET"] = ENVIRON["CRON"]
      if (ENVIRON["URL"] != "") v["NEXT_PUBLIC_APP_URL"] = ENVIRON["URL"]
    }
    {
      eq = index($0, "=")
      key = eq > 0 ? substr($0, 1, eq - 1) : ""
      if (key in v) { print key "=" v[key] } else print
    }
    END {
      if (ENVIRON["PORT"] != "") print "APP_PORT=" ENVIRON["PORT"]
      if (ENVIRON["PIN"] != "") print "TIMEWREN_VERSION=" ENVIRON["PIN"]
      if (ENVIRON["CADDY"] == "1") {
        print "CADDY_DOMAIN=" ENVIRON["DOMAIN_VALUE"]
        print "COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml"
      }
    }
  ' .env.example > "$tmp"
  for v in POSTGRES_PASSWORD BETTER_AUTH_SECRET ENCRYPTION_KEY CRON_SECRET; do
    grep -Eq "^${v}=[0-9a-f]{64}$" "$tmp" || die "Failed to generate $v."
  done
  if [ -n "$APP_URL" ]; then
    grep -Fxq "NEXT_PUBLIC_APP_URL=$APP_URL" "$tmp" || die "Failed to set NEXT_PUBLIC_APP_URL (missing from .env.example?)."
  fi
  chmod 600 "$tmp"
  mv "$tmp" .env
  trap - EXIT
  say "Created .env with new random secrets (mode 600)."
  say "Back up ENCRYPTION_KEY from .env: without it, connected integrations must be reconnected."
fi

if [ "$START" -eq 0 ]; then
  say "Skipping start (--no-start). Start later with: docker compose up -d"
  exit 0
fi

# --- 3. Start -----------------------------------------------------------------

if [ -f Dockerfile ] && [ -f package.json ]; then
  say "Building and starting the stack from this checkout."
  docker compose up -d --build
else
  say "Pulling images and starting the stack."
  docker compose pull
  docker compose up -d
fi

# --- 4. Wait for health -------------------------------------------------------

say "Waiting for the app to become healthy (up to ${TIMEOUT}s)..."
deadline=$(( $(date +%s) + TIMEOUT ))
status="unknown"
while :; do
  cid="$(docker compose ps -q app 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
  fi
  case "$status" in
    healthy) break ;;
    exited|dead|unhealthy|restarting)
      err "The app container is $status. Inspect locally with: docker compose logs app"
      exit 1
      ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    err "Timed out after ${TIMEOUT}s (last status: $status)."
    say "Check progress with: docker compose logs -f app" >&2
    exit 1
  fi
  sleep 5
done

say ""
say "TimeWren is running."
say "  Open the URL configured as NEXT_PUBLIC_APP_URL in .env."
say "  The first account you create becomes the instance admin."
say "  Behind a domain: see docs/self-hosting.md (reverse proxy and TLS)."
