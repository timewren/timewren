#!/usr/bin/env bash
# Skærmbilleder af screens-b (fakturaer, rapporter, indstillinger, onboarding)
# i lys og mørk. Lægges i screenshots/screens-b/<navn>-<lys|moerk>.png.
#   scripts/shot-b.sh            alle
#   scripts/shot-b.sh fakturaer  kun dem, hvis navn starter med "fakturaer"
# Kører appen i forgrunden med vagthund (alarm 60), som scripts/shot.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/screens-b-shots}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
# Demodata (MockBackend), medmindre TT_DEMO allerede er sat (også tom).
export TT_DEMO="${TT_DEMO-1}"
filter="${1:-}"

# navn | miljøvariabler
shots=(
  "fakturaer-liste|TT_SCREEN=fakturaer"
  "fakturaer-ny|TT_SCREEN=fakturaer TT_FAKTURA_VIEW=ny"
  "fakturaer-kladde|TT_SCREEN=fakturaer TT_FAKTURA_VIEW=kladde"
  "fakturaer-forfalden|TT_SCREEN=fakturaer TT_FAKTURA_VIEW=faktura_1040"
  "rapporter|TT_SCREEN=rapporter"
  "indstillinger-konto|TT_SCREEN=indstillinger TT_SETTINGS=konto"
  "indstillinger-sporing|TT_SCREEN=indstillinger TT_SETTINGS=sporing"
  "indstillinger-ai|TT_SCREEN=indstillinger TT_SETTINGS=ai"
  "indstillinger-genveje|TT_SCREEN=indstillinger TT_SETTINGS=genveje"
  "indstillinger-udseende|TT_SCREEN=indstillinger TT_SETTINGS=udseende"
  "indstillinger-sprog|TT_SCREEN=indstillinger TT_SETTINGS=sprog"
  "indstillinger-opdateringer|TT_SCREEN=indstillinger TT_SETTINGS=opdateringer"
  "indstillinger-om|TT_SCREEN=indstillinger TT_SETTINGS=om"
  "onboarding-valg|TT_SCREEN=onboarding TT_ONBOARDING_STEP=valg"
  "onboarding-login|TT_SCREEN=onboarding TT_ONBOARDING_STEP=login"
  "onboarding-lokal|TT_SCREEN=onboarding TT_ONBOARDING_STEP=lokal"
  "onboarding-tilladelser|TT_SCREEN=onboarding TT_ONBOARDING_STEP=tilladelser"
  "onboarding-demo|TT_SCREEN=onboarding TT_ONBOARDING_STEP=demo"
  "onboarding-import|TT_SCREEN=onboarding TT_ONBOARDING_STEP=import"
)

mkdir -p screenshots/screens-b
for entry in "${shots[@]}"; do
  name="${entry%%|*}"
  vars="${entry#*|}"
  [[ -n "$filter" && "$name" != "$filter"* ]] && continue
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    out="$PWD/screenshots/screens-b/$name-$suffix.png"
    # shellcheck disable=SC2086
    env $vars TT_APPEARANCE="$m" TT_SHOT="$out" perl -e 'alarm 60; exec @ARGV' "$bin"
  done
done
