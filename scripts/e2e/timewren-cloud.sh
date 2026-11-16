#!/usr/bin/env bash
# TimeWren Cloud ende til ende mod en lokal produktionsbuild (se
# tests/e2e-timewren/README.md). Kræver:
#   - DATABASE_URL til en kasseret Postgres med skemaet (npx drizzle-kit push)
#   - en build: NODE_OPTIONS=--max-old-space-size=6144 npx next build
# Starter appen (standalone), en HTTPS-proxy, der bevarer Host, og en
# Resend-mock på ledige porte, kører Playwright og stopper det hele igen.
set -euo pipefail

cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?Sæt DATABASE_URL til en kasseret testdatabase}"
if [ ! -f .next/standalone/server.js ]; then
  echo "Ingen build: kør først 'npx next build'" >&2
  exit 1
fi

WORK="$(mktemp -d)"
PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  echo "Logs og mails: $WORK"
}
trap cleanup EXIT

free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}
APP_PORT="$(free_port)"
PROXY_PORT="$(free_port)"
MAIL_PORT="$(free_port)"

# Standalone-serveren skal have de statiske filer ved siden af sig (som i Dockerfile).
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -subj "/CN=timewren.com" \
  -addext "subjectAltName=DNS:timewren.com,DNS:www.timewren.com" 2>/dev/null

node tests/e2e/resend-mock.mjs "$MAIL_PORT" "$WORK/mails" >"$WORK/mail.log" 2>&1 &
PIDS+=($!)

# Prods form: TimeTrack som standardbrand (med TimeTracks Google-nøgler sat,
# som må ikke vises på TimeWren), TimeWren på timewren.com + www.
env -i PATH="$PATH" HOME="$HOME" \
  NODE_ENV=production PORT="$APP_PORT" HOSTNAME=127.0.0.1 \
  DATABASE_URL="$DATABASE_URL" \
  BETTER_AUTH_SECRET="e2e-only-$(openssl rand -hex 16)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  CRON_SECRET="e2e-only" \
  NEXT_PUBLIC_APP_URL=https://timetrack.dk \
  NEXT_PUBLIC_BRAND=timetrack \
  NEXT_PUBLIC_REGISTRATION_ENABLED=true \
  REQUIRE_EMAIL_VERIFICATION=true \
  MULTIBRAND_ENABLED=1 TIMEWREN_APP_ENABLED=1 \
  BRANDS_CONFIG='{"timewren":{"hosts":["timewren.com","www.timewren.com"]}}' \
  ALUNTA_API_KEY=e2e-billing-enabled \
  GOOGLE_CLIENT_ID=timetrack-google-id GOOGLE_CLIENT_SECRET=timetrack-google-secret \
  RESEND_API_KEY=re_e2e RESEND_BASE_URL="http://127.0.0.1:$MAIL_PORT" \
  node .next/standalone/server.js >"$WORK/app.log" 2>&1 &
PIDS+=($!)

node tests/e2e-timewren/https-proxy.mjs "$PROXY_PORT" "$APP_PORT" \
  "$WORK/key.pem" "$WORK/cert.pem" >"$WORK/proxy.log" 2>&1 &
PIDS+=($!)

for _ in $(seq 1 60); do
  if curl -fsk -o /dev/null --resolve "timewren.com:$PROXY_PORT:127.0.0.1" \
    "https://timewren.com:$PROXY_PORT/api/health"; then
    break
  fi
  sleep 1
done
curl -fsk -o /dev/null --resolve "timewren.com:$PROXY_PORT:127.0.0.1" \
  "https://timewren.com:$PROXY_PORT/api/health" || {
  echo "Appen svarer ikke; se $WORK/app.log" >&2
  tail -30 "$WORK/app.log" >&2
  exit 1
}

TW_PROXY_PORT="$PROXY_PORT" E2E_MAIL_DIR="$WORK/mails" DATABASE_URL="$DATABASE_URL" \
  npx playwright test -c tests/e2e-timewren/playwright.config.ts "$@"
