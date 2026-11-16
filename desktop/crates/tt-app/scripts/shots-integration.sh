#!/usr/bin/env bash
# Skærmbilleder af hele appen efter integrationen, lys og mørk, med
# render_to_image (virker også med låst skærm). Lægges i
# screenshots/integration/<navn>-<lys|moerk>.png.
#   scripts/shots-integration.sh          alle
#   scripts/shots-integration.sh kunder   kun dem, hvis navn starter med "kunder"
# Demo-billederne kører mod MockBackend (TT_DEMO). "rigtig-*" kører mod de
# rigtige data i en tom, midlertidig datamappe (første start = onboarding).
# Appen kører i forgrunden med vagthund (alarm 60) og lukker selv.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/integration-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
filter="${1:-}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# navn | miljøvariabler
shots=(
  "hjem|TT_DEMO=timer TT_SCREEN=hjem"
  "palet|TT_DEMO=palet TT_SCREEN=hjem"
  "kalender|TT_DEMO=1 TT_SCREEN=kalender"
  "kalender-editor|TT_DEMO=editor TT_SCREEN=kalender"
  "kunder|TT_DEMO=1 TT_SCREEN=kunder"
  "kunder-formular|TT_DEMO=formular TT_SCREEN=kunder"
  "projekter|TT_DEMO=1 TT_SCREEN=projekter"
  "klippekort|TT_DEMO=1 TT_SCREEN=klippekort"
  "opgaver|TT_DEMO=1 TT_SCREEN=opgaver"
  "fakturaer|TT_DEMO=1 TT_SCREEN=fakturaer"
  "fakturaer-kladde|TT_DEMO=1 TT_SCREEN=fakturaer TT_FAKTURA_VIEW=kladde"
  "rapporter|TT_DEMO=1 TT_SCREEN=rapporter"
  "indstillinger-konto|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=konto"
  "indstillinger-sporing|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=sporing"
  "indstillinger-ai|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=ai"
  "onboarding|TT_DEMO=1 TT_SCREEN=onboarding TT_ONBOARDING_STEP=valg"
  "rigtig-foerste-start|TT_DATA_DIR=$tmp/foerste TT_MEMORY_SECRETS=1 TT_NO_TRAY=1 TT_NO_TRACKER=1"
  "rigtig-lokal-hjem|TT_DATA_DIR=$tmp/lokal TT_MEMORY_SECRETS=1 TT_NO_TRAY=1 TT_NO_TRACKER=1 TT_SKIP_ONBOARDING=1 TT_SCREEN=hjem"
  "rigtig-lokal-indstillinger-ai|TT_DATA_DIR=$tmp/lokal TT_MEMORY_SECRETS=1 TT_NO_TRAY=1 TT_NO_TRACKER=1 TT_SKIP_ONBOARDING=1 TT_SCREEN=indstillinger TT_SETTINGS=ai"
)

mkdir -p screenshots/integration
for entry in "${shots[@]}"; do
  name="${entry%%|*}"
  vars="${entry#*|}"
  [[ -n "$filter" && "$name" != "$filter"* ]] && continue
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/integration/$name-$suffix.png"
    # shellcheck disable=SC2086
    env $vars TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
