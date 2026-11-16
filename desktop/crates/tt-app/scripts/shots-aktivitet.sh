#!/usr/bin/env bash
# Skærmbilleder af Aktivitet (dag, valg, Tildel, Luk dagen), I dag med uklare
# blokke og Indstillinger → Sporing, lys og mørk. Lægges i screenshots/aktivitet/.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/app-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
mkdir -p screenshots/aktivitet
# navn:skærm:demo[:indstilling]
for entry in \
  aktivitet:aktivitet:1 \
  aktivitet-valg:aktivitet:1,aktivitet-valg \
  aktivitet-tildel:aktivitet:1,aktivitet-tildel \
  aktivitet-luk-dagen:aktivitet:1,lukdagen \
  hjem-uklare:hjem:1 \
  sporing:indstillinger:1:sporing; do
  IFS=: read -r name screen demo section <<<"$entry"
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    env TT_DEMO="$demo" TT_SCREEN="$screen" TT_SETTINGS="${section:-}" TT_APPEARANCE="$m" TT_SHOT_DELAY_MS=1500 \
      TT_SHOT="$PWD/screenshots/aktivitet/$name-$suffix.png" \
      perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
