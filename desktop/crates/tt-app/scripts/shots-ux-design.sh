#!/usr/bin/env bash
# Før/efter-skærmbilleder til design-gennemgangen (UX-runden 0.2.28), lys og
# mørk, med render_to_image. Lægges i
# screenshots/ux-design/<foer|efter>/<navn>-<lys|moerk>.png.
#   scripts/shots-ux-design.sh efter          alle
#   scripts/shots-ux-design.sh efter kunder   kun dem, hvis navn starter med "kunder"
# Appen kører i forgrunden med vagthund (alarm 60) og lukker selv.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/ux-design-shots}"

set_name="${1:?foer eller efter}"
filter="${2:-}"
cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# navn | miljøvariabler
shots=(
  "hjem|TT_DEMO=timer TT_SCREEN=hjem"
  "hjem-tom|TT_DEMO=1 TT_SCREEN=hjem"
  "kalender|TT_DEMO=1 TT_SCREEN=kalender"
  "aktivitet|TT_DEMO=1 TT_SCREEN=aktivitet"
  "kunder|TT_DEMO=1 TT_SCREEN=kunder"
  "projekter|TT_DEMO=1 TT_SCREEN=projekter"
  "klippekort|TT_DEMO=1 TT_SCREEN=klippekort"
  "fakturaer|TT_DEMO=1 TT_SCREEN=fakturaer"
  "rapporter|TT_DEMO=1 TT_SCREEN=rapporter"
  "indstillinger|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=konto"
  "indstillinger-sporing|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=sporing"
  "onboarding|TT_DEMO=1 TT_SCREEN=onboarding TT_ONBOARDING_STEP=valg"
  "rigtig-lokal-hjem|TT_DATA_DIR=$tmp/lokal TT_MEMORY_SECRETS=1 TT_NO_TRAY=1 TT_NO_TRACKER=1 TT_SKIP_ONBOARDING=1 TT_SCREEN=hjem"
  # Efter: smal menu (ikonrail) og et smalt vindue, der klapper menuen sammen.
  "hjem-smal-menu|TT_DEMO=timer TT_SCREEN=hjem TT_NAV=smal"
  "hjem-smalt-vindue|TT_DEMO=timer TT_SCREEN=hjem TT_WINDOW_WIDTH=960"
  "kunder-smalt-vindue|TT_DEMO=1 TT_SCREEN=kunder TT_WINDOW_WIDTH=960"
)

mkdir -p "screenshots/ux-design/$set_name"
for entry in "${shots[@]}"; do
  name="${entry%%|*}"
  vars="${entry#*|}"
  [[ -n "$filter" && "$name" != "$filter"* ]] && continue
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/ux-design/$set_name/$name-$suffix.png"
    # shellcheck disable=SC2086
    env $vars TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin" || echo "FEJL: $name $m"
  done
done
