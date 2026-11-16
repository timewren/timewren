#!/usr/bin/env bash
# Skærmbilleder af Indstillinger → Opdateringer med en klar version (demo),
# foldet sammen og udfoldet, lys og mørk. Lægges i screenshots/aktivitet/.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/app-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
mkdir -p screenshots/aktivitet
for entry in foldet:closed aaben:open; do
  name="${entry%%:*}"
  notes="${entry#*:}"
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    env TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=opdateringer TT_UPDATE_DEMO=0.2.24 \
      TT_UPDATE_NOTES="$notes" TT_APPEARANCE="$m" \
      TT_SHOT="$PWD/screenshots/aktivitet/opdatering-efter-$name-$suffix.png" \
      perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
