#!/usr/bin/env bash
# Skærmbilleder af den fælles mål-vælger, tildeling, regler og kunderettelse
# (UX-runden 0.2.28, vaelger), lys og mørk. Første argument er mappen under
# screenshots/ux-vaelger/ (fx "foer" eller "efter").
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/ux-vaelger}"
export TT_DATA_DIR="${TT_DATA_DIR:-$HOME/dev/tt-ux-data-vaelger}"
out="screenshots/ux-vaelger/${1:-efter}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
mkdir -p "$out" "$TT_DATA_DIR"
# navn:skærm:demo[:indstilling]
for entry in \
  hjem:hjem:1 \
  vaelger:hjem:1,vaelger \
  vaelger-soeg:hjem:1,vaelger-soeg \
  vaelger-kunde:hjem:1,vaelger-kunde \
  aktivitet:aktivitet:1 \
  aktivitet-tildel:aktivitet:1,aktivitet-tildel \
  aktivitet-altid:aktivitet:1,aktivitet-altid \
  kunder:kunder:1 \
  kunde-ret:kunder:1,kunde-ret \
  kalender:kalender:1 \
  regler:indstillinger:1:regler; do
  IFS=: read -r name screen demo section <<<"$entry"
  [[ -n "${ONLY:-}" && "$name" != ${ONLY}* ]] && continue
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    env TT_DEMO="$demo" TT_SCREEN="$screen" TT_SETTINGS="${section:-}" TT_APPEARANCE="$m" TT_SHOT_DELAY_MS=3000 \
      TT_SHOT="$PWD/$out/$name-$suffix.png" \
      perl -e 'alarm 60; exec @ARGV' "$bin" || echo "fejl: $name-$suffix"
  done
done
ls "$out" | wc -l
