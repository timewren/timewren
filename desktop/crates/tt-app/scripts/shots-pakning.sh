#!/usr/bin/env bash
# Skærmbilleder af første start efter opdatering fra 0.2.x (migrate.rs),
# lys og mørk, med render_to_image. Lægges i screenshots/pakning/.
# Den gamle mappe bygges fra fixturen i src/migrate/ (ingen rigtige data).
#   migrering-lokal       0.2.x uden konto: data og indstillinger flyttet
#   migrering-logget-ind  0.2.x med konto: "log ind igen"
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/integration-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

old_dir() {
  local dir="$1" extra="$2"
  mkdir -p "$dir"
  sqlite3 "$dir/timetrack.db" < src/migrate/schema-0.2.sql
  sqlite3 "$dir/timetrack.db" < src/migrate/fixture-0.2.sql
  [[ -n "$extra" ]] && sqlite3 "$dir/timetrack.db" "$extra"
  echo '{"license_key":"TT-TEST-0000","tier":"lifetime"}' > "$dir/license.json"
}

old_dir "$tmp/gammel-lokal" ""
old_dir "$tmp/gammel-konto" "INSERT INTO settings (key, value) VALUES ('sync_email', 'test@example.invalid');"

shots=(
  "migrering-lokal|$tmp/gammel-lokal"
  "migrering-logget-ind|$tmp/gammel-konto"
)

mkdir -p screenshots/pakning
# Indstillinger → Opdateringer med demodata: uden og med en klar version.
for name in opdateringer opdateringer-ny-version; do
  extra=$([[ $name == *ny-version ]] && echo "TT_UPDATE_DEMO=0.2.24" || true)
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    # shellcheck disable=SC2086
    env TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=opdateringer $extra TT_APPEARANCE="$m" \
      TT_SHOT="$PWD/screenshots/pakning/$name-$suffix.png" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
for entry in "${shots[@]}"; do
  name="${entry%%|*}"
  old="${entry#*|}"
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/pakning/$name-$suffix.png"
    # Ny, tom datamappe hver gang, så importen kører.
    rm -rf "$tmp/ny"
    env TT_DATA_DIR="$tmp/ny" TT_OLD_DATA_DIR="$old" TT_MEMORY_SECRETS=1 TT_NO_TRAY=1 \
      TT_NO_TRACKER=1 TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
