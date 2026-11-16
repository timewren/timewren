#!/usr/bin/env bash
# Bygger og starter appen i forgrunden.
#   scripts/run.sh            starter appen; luk den selv (Cmd+Q)
#   scripts/run.sh --smoke    lukker efter første frame (røgtest, exit 0 = ok)
# Miljø: TT_SCREEN=<skærm>, TT_APPEARANCE=light|dark, TT_DEMO=1 (demodata i stedet for de rigtige).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/dev/cargo-target/app}"

cargo build --bin timetrack
bin="$CARGO_TARGET_DIR/debug/timetrack"

if [[ "${1:-}" == "--smoke" ]]; then
  # Watchdog uden baggrundsjob: perl's alarm dræber processen efter 60 s.
  TT_EXIT_AFTER_FIRST_FRAME=1 perl -e 'alarm 60; exec @ARGV' "$bin"
  echo "røgtest ok"
else
  exec "$bin"
fi
