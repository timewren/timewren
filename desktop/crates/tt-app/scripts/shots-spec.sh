#!/usr/bin/env bash
# Skærmbilleder til spec-auditten (v1/spec-audit): de nye sprog, kontakten for
# browser-adresser, vejen til web i Konto og noten om Automatisering i
# onboarding. render_to_image, så det virker med låst skærm. Lægges i
# screenshots/spec/<navn>-<lys|moerk>.png.
#   scripts/shots-spec.sh          alle
#   scripts/shots-spec.sh sv       kun dem, hvis navn starter med "sv"
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/spec-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
filter="${1:-}"

# navn | miljøvariabler
shots=(
  "da-sporing|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=sporing"
  "da-konto|TT_DEMO=1 TT_SCREEN=indstillinger TT_SETTINGS=konto"
  "da-onboarding-tilladelser|TT_DEMO=1 TT_SCREEN=onboarding TT_ONBOARDING_STEP=tilladelser"
  "de-hjem|TT_DEMO=timer TT_DEMO_LANG=de TT_SCREEN=hjem"
  "de-fakturaer|TT_DEMO=1 TT_DEMO_LANG=de TT_SCREEN=fakturaer"
  "de-sprog|TT_DEMO=1 TT_DEMO_LANG=de TT_SCREEN=indstillinger TT_SETTINGS=sprog"
  "sv-hjem|TT_DEMO=timer TT_DEMO_LANG=sv TT_SCREEN=hjem"
  "sv-kalender|TT_DEMO=1 TT_DEMO_LANG=sv TT_SCREEN=kalender"
  "sv-klippekort|TT_DEMO=1 TT_DEMO_LANG=sv TT_SCREEN=klippekort"
  "nb-hjem|TT_DEMO=timer TT_DEMO_LANG=nb TT_SCREEN=hjem"
  "nb-rapporter|TT_DEMO=1 TT_DEMO_LANG=nb TT_SCREEN=rapporter"
  "nb-sporing|TT_DEMO=1 TT_DEMO_LANG=nb TT_SCREEN=indstillinger TT_SETTINGS=sporing"
)

mkdir -p screenshots/spec
for entry in "${shots[@]}"; do
  name="${entry%%|*}"
  vars="${entry#*|}"
  [[ -n "$filter" && "$name" != "$filter"* ]] && continue
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/spec/$name-$suffix.png"
    # shellcheck disable=SC2086
    env $vars TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
