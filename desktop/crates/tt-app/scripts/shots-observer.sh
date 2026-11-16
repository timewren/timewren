#!/usr/bin/env bash
# Skærmbilleder af observatøren (v1/observer): kortet "Lær TimeTrack at kende",
# opgaven på forslaget og eksporten under Sporing. render_to_image, så det
# virker med låst skærm. Lægges i screenshots/observer/<navn>-<lys|moerk>.png.
#   scripts/shots-observer.sh          alle
#   scripts/shots-observer.sh hjem     kun dem, hvis navn starter med "hjem"
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/observer-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
filter="${1:-}"

# navn | miljøvariabler
shots=(
  "hjem-laer-spoergsmaal|TT_DEMO=1 TT_SCREEN=hjem"
  "hjem-laer-tidligt|TT_DEMO=1,laer-tidligt TT_SCREEN=hjem"
  "hjem-laer-en|TT_DEMO=1 TT_DEMO_LANG=en TT_SCREEN=hjem"
  "hjem-laer-de|TT_DEMO=1 TT_DEMO_LANG=de TT_SCREEN=hjem"
  "sporing-testsaet|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=sporing"
)

mkdir -p screenshots/observer
for entry in "${shots[@]}"; do
  name="${entry%%|*}"
  vars="${entry#*|}"
  [[ -n "$filter" && "$name" != "$filter"* ]] && continue
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/observer/$name-$suffix.png"
    # shellcheck disable=SC2086
    env $vars TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
