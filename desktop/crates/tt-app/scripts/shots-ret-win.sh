#!/usr/bin/env bash
# Skærmbilleder af rettelserne fra v1/ret-win i lys og mørk til
# docs/v1/skaermbilleder-ret-win/: vælgeren uden træffere (Opret kunde/Ny
# kunde), formularen "Ny kunde" og beskeden efter et stop under ét minut.
#   scripts/shots-ret-win.sh
# Demo-tilstande via TT_DEMO (vaelger, nykunde, kortstop). Bruger scripts/shot.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
export TT_SHOT_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/ret-win-shots}"

out_dir=../../docs/v1/skaermbilleder-ret-win
mkdir -p "$out_dir"
for demo in vaelger nykunde kortstop; do
  for mode in light dark; do
    name=$([[ $mode == dark ]] && echo moerk || echo lys)
    TT_DEMO="$demo" scripts/shot.sh hjem "$mode"
    out="$out_dir/hjem-$demo-$name.png"
    mv "screenshots/hjem-$name.png" "$out"
    echo "gemt $out"
  done
done
