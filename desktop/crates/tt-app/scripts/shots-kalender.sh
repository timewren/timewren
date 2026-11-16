#!/usr/bin/env bash
# Skærmbilleder af kalenderdelen (v1/kalender): idle-dialogens fire valg,
# mødekortet og Indstillinger → Kalender. render_to_image, så det virker med
# låst skærm. Lægges i screenshots/kalender/<navn>-<lys|moerk>.png.
#   scripts/shots-kalender.sh          alle
#   scripts/shots-kalender.sh idle     kun dem, hvis navn starter med "idle"
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/kalender-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
filter="${1:-}"

# navn | miljøvariabler
shots=(
  "idle-fire-valg|TT_DEMO=idle TT_SCREEN=hjem"
  "idle-fire-valg-en|TT_DEMO=idle TT_DEMO_LANG=en TT_SCREEN=hjem"
  "idle-fire-valg-de|TT_DEMO=idle TT_DEMO_LANG=de TT_SCREEN=hjem"
  "moedekort|TT_DEMO=moede TT_SCREEN=hjem"
  "moedekort-sv|TT_DEMO=moede TT_DEMO_LANG=sv TT_SCREEN=hjem"
  "aktivitet-kalender|TT_DEMO=moede TT_SCREEN=aktivitet"
  "indstillinger-kalender|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=kalender"
  "indstillinger-kalender-nb|TT_DEMO=1 TT_DEMO_LANG=nb TT_SCREEN=indstillinger TT_SETTINGS=kalender"
)

mkdir -p screenshots/kalender
for entry in "${shots[@]}"; do
  name="${entry%%|*}"
  vars="${entry#*|}"
  [[ -n "$filter" && "$name" != "$filter"* ]] && continue
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/kalender/$name-$suffix.png"
    # shellcheck disable=SC2086
    env $vars TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
