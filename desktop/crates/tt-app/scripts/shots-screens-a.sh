#!/usr/bin/env bash
# Skærmbilleder af skærme A (screens-a) i lys og mørk til screenshots/screens-a/.
#   scripts/shots-screens-a.sh            alle
#   scripts/shots-screens-a.sh kalender   én skærm (begge tilstande)
# Demo-tilstande via TT_DEMO: kalender-editor (editor), kunder-formular (formular).
# Bruger scripts/shot.sh og flytter billederne bagefter.
set -euo pipefail
cd "$(dirname "$0")/.."
export TT_SHOT_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/screens-a-shots}"

shots=(kalender kunder projekter klippekort opgaver kalender:editor kunder:formular)
[[ $# -ge 1 ]] && shots=("$1")

mkdir -p screenshots/screens-a
for item in "${shots[@]}"; do
  screen="${item%%:*}"
  demo=""
  [[ "$item" == *:* ]] && demo="${item#*:}"
  for mode in light dark; do
    name=$([[ $mode == dark ]] && echo moerk || echo lys)
    TT_DEMO="$demo" scripts/shot.sh "$screen" "$mode"
    out="screenshots/screens-a/$screen${demo:+-$demo}-$name.png"
    mv "screenshots/$screen-$name.png" "$out"
    echo "gemt $out"
  done
done
