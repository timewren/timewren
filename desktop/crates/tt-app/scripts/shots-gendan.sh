#!/usr/bin/env bash
# Skærmbilleder af de genskabte 0.2-funktioner (v1/gendan). render_to_image,
# så det virker med låst skærm. Lægges i screenshots/gendan/<navn>-<lys|moerk>.png.
#   scripts/shots-gendan.sh            alle
#   scripts/shots-gendan.sh faktura    kun dem, hvis navn starter med "faktura"
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/gendan-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
filter="${1:-}"
# Demo-backuppen, MockBackend genkender.
demo_backup="${TMPDIR:-/tmp}/timetrack-backup-demo.ttbackup"
printf 'TT-MOCK-BACKUP' > "$demo_backup"

# navn | miljøvariabler
shots=(
  "faktura-opsaetning|TT_DEMO=lokal TT_SCREEN=indstillinger TT_SETTINGS=faktura"
  "faktura-opsaetning-cloud|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=faktura"
  "faktura-kladde-lokal|TT_DEMO=lokal TT_SCREEN=fakturaer TT_FAKTURA_VIEW=kladde"
  "faktura-opsaetning-en|TT_DEMO=lokal TT_DEMO_LANG=en TT_SCREEN=indstillinger TT_SETTINGS=faktura"
  "backup|TT_DEMO=lokal TT_SCREEN=indstillinger TT_SETTINGS=backup"
  "backup-gendan|TT_DEMO=lokal TT_SCREEN=indstillinger TT_SETTINGS=backup TT_BACKUP_FILE=$demo_backup"
  "backup-cloud|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=backup"
  "klippekort|TT_DEMO=lokal TT_SCREEN=klippekort"
  "hjem-forslag-klippekort|TT_DEMO=1 TT_SCREEN=hjem"
  "kalender-maaned|TT_DEMO=1 TT_SCREEN=kalender TT_KALENDER=maaned"
  "kalender-maaned-de|TT_DEMO=1 TT_DEMO_LANG=de TT_SCREEN=kalender TT_KALENDER=maaned"
)

mkdir -p screenshots/gendan
for entry in "${shots[@]}"; do
  name="${entry%%|*}"
  vars="${entry#*|}"
  [[ -n "$filter" && "$name" != "$filter"* ]] && continue
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/gendan/$name-$suffix.png"
    # shellcheck disable=SC2086
    env $vars TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
