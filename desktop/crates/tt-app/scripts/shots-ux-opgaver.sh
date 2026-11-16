#!/usr/bin/env bash
# Skærmbilleder af Opgaver (liste, board, panel, hurtig oprettelse m.m.) i
# lys og mørk til screenshots/ux-opgaver/. Demo-tilstandene vælges med
# TT_DEMO (se OpgaverScreen::apply_demo). Kalenderen tages med TT_SCREEN.
#   scripts/shots-ux-opgaver.sh [præfiks]    præfiks = efter (standard) eller foer
set -euo pipefail
cd "$(dirname "$0")/.."
prefix="${1:-efter}"
export TT_SHOT_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/ux-opgaver-shots}"
export TT_DATA_DIR="${TT_DATA_DIR:-$HOME/dev/tt-ux-data-opgaver}"
mkdir -p "$TT_DATA_DIR" screenshots/ux-opgaver

# skærm:demo:navn
shots=(
  "opgaver:1:liste"
  "opgaver:opg-liste:liste-grupperet"
  "opgaver:opg-board:board"
  "opgaver:opg-panel:board-panel"
  "opgaver:opg-add:board-hurtig-oprettelse"
  "opgaver:opg-filter:board-forfalder-snart"
  "opgaver:opg-tom:board-ingen-match"
  "opgaver:opg-form:formular"
  "opgaver:opg-kolonner:board-egne-kolonner"
  "opgaver:opg-kolonner-panel:board-egne-kolonner-panel"
  "kalender:1:kalender"
)
[[ $# -ge 2 ]] && shots=("$2")

for item in "${shots[@]}"; do
  IFS=: read -r screen demo name <<<"$item"
  for mode in light dark; do
    short=$([[ $mode == dark ]] && echo moerk || echo lys)
    TT_DEMO="$demo" scripts/shot.sh "$screen" "$mode"
    out="screenshots/ux-opgaver/$prefix-$name-$short.png"
    mv "screenshots/$screen-$short.png" "$out"
    echo "gemt $out"
  done
done
