#!/bin/sh
# Startup script for TimeTrack production
# Runs database migrations before starting the app

echo "🚀 Starting TimeTrack..."

# Check if required environment variables are set
echo "📊 Checking environment variables..."
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL is not set!"
  exit 1
fi

if [ -z "$BETTER_AUTH_SECRET" ]; then
  echo "❌ ERROR: BETTER_AUTH_SECRET is not set!"
  exit 1
fi

if [ -z "$NEXT_PUBLIC_APP_URL" ]; then
  echo "⚠️  Warning: NEXT_PUBLIC_APP_URL is not set, using default"
fi

echo "✅ Environment variables are set"

# Optionally run database migrations (default: off)
if [ "$MIGRATE_ON_START" = "1" ]; then
  echo "🔄 Running database migrations..."
  echo "📍 Migration script: tsx scripts/migrate.ts"

  # Disable exit on error temporarily. Capture output to a file (and echo it)
  # so a failure can be sent to Discord with the actual error attached.
  MIGRATE_LOG=/tmp/migrate.log
  set +e
  npm run db:migrate > "$MIGRATE_LOG" 2>&1
  MIGRATION_EXIT_CODE=$?
  set -e
  cat "$MIGRATE_LOG"

  if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
    echo "✅ Database migrations completed successfully"
  else
    echo "🚨 Migration exited with code: $MIGRATION_EXIT_CODE"
    echo "   App will start anyway — sending Discord alert (incident 2026-08-14:"
    echo "   a silent migration failure hid the menu for every customer for a week)"
    node scripts/notify-migration-failure.mjs "$MIGRATION_EXIT_CODE" "$MIGRATE_LOG" || true
  fi
else
  echo "⏭️  Skipping migrations (set MIGRATE_ON_START=1 to enable)"
fi

# Start the Next.js application
echo ""
echo "🌟 Starting Next.js server..."
exec node server.js
