#!/usr/bin/env bash
# Skærmbilleder med GPUI's render_to_image (virker også med låst skærm).
#   scripts/shot.sh                     alle skærme, lys og mørk
#   scripts/shot.sh hjem dark           én skærm, én tilstand
# Billederne lægges i screenshots/<skærm>-<lys|moerk>.png.
# Bygges med feature `shots` i egen target-dir, så den normale binær ikke påvirkes.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/app-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
# Demodata (MockBackend), medmindre TT_DEMO allerede er sat (også tom).
export TT_DEMO="${TT_DEMO-1}"

screens=(hjem kalender kunder projekter klippekort opgaver fakturaer rapporter indstillinger)
modes=(light dark)
[[ $# -ge 1 ]] && screens=("$1")
[[ $# -ge 2 ]] && modes=("$2")

mkdir -p screenshots
for s in "${screens[@]}"; do
  for m in "${modes[@]}"; do
    name=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/$s-$name.png"
    # TT_DEMO lader skærme vise en demo-tilstand (fx kørende timer).
    TT_SCREEN="$s" TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
