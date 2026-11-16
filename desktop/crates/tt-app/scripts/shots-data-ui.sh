#!/usr/bin/env bash
# Skærmbilleder af rettelserne fra v1/data-ui i lys og mørk til
# screenshots/data-ui/: Ret opgave, Ret klippekort og Fyld op.
#   scripts/shots-data-ui.sh
# Demo-tilstande via TT_DEMO (ret, fyld). Bruger scripts/shot.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
export TT_SHOT_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/data-ui-shots}"

shots=(opgaver:ret klippekort:ret klippekort:fyld)
[[ $# -ge 1 ]] && shots=("$1")

mkdir -p screenshots/data-ui
for item in "${shots[@]}"; do
  screen="${item%%:*}"
  demo="${item#*:}"
  for mode in light dark; do
    name=$([[ $mode == dark ]] && echo moerk || echo lys)
    TT_DEMO="$demo" scripts/shot.sh "$screen" "$mode"
    out="screenshots/data-ui/$screen-$demo-$name.png"
    mv "screenshots/$screen-$name.png" "$out"
    echo "gemt $out"
  done
done
