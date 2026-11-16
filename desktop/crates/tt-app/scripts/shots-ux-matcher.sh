#!/usr/bin/env bash
# Skærmbilleder til UX-runden 0.2.28, matcher: Luk dagen med det spørgsmål,
# der hjælper mest, og kortet "Lær TimeTrack at kende" (samme spørgsmål), lys
# og mørk, dansk og engelsk. render_to_image, så det virker uden
# skærmoptagelse. Lægges i screenshots/ux-matcher/<navn>[-<tillæg>]-<lys|moerk>.png.
#   scripts/shots-ux-matcher.sh            efter-billeder
#   scripts/shots-ux-matcher.sh foer       samme skærme med tillægget "foer"
#                                          (køres i en udtjekning af basen)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_TARGET_DIR="${TT_SHOT_TARGET_DIR:-$HOME/dev/cargo-target/ux-matcher-shots}"
out_dir="${TT_SHOT_OUT:-$PWD/screenshots/ux-matcher}"
tag="${1:-efter}"

cargo build --bin timetrack --features shots
bin="$CARGO_TARGET_DIR/debug/timetrack"
mkdir -p "$out_dir"
# navn:skærm:demo:sprog
for entry in \
  luk-dagen:aktivitet:1,lukdagen:da \
  luk-dagen-en:aktivitet:1,lukdagen:en \
  hjem-laer:hjem:1:da; do
  IFS=: read -r name screen demo lang <<<"$entry"
  for m in light dark; do
    suffix=$([[ $m == dark ]] && echo moerk || echo lys)
    env TT_DEMO="$demo" TT_DEMO_LANG="$lang" TT_SCREEN="$screen" TT_APPEARANCE="$m" TT_SHOT_DELAY_MS=1500 \
      TT_SHOT="$out_dir/$name-$tag-$suffix.png" \
      perl -e 'alarm 90; exec @ARGV' "$bin"
  done
done
