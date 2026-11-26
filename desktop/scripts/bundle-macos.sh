#!/usr/bin/env bash
# Pak TimeTrack (crates/tt-app) som macOS-app. TT_BRAND=timewren pakker i stedet
# TimeWren-udgaven (cargo-featuren brand-timewren; navn, bundle-id, exe, ikon og
# filnavne fra scripts/brands.json). Uden TT_BRAND er alt som før.
#
#   scripts/bundle-macos.sh [target] [ud-mappe]
#     target    aarch64-apple-darwin (standard på Apple silicon) eller x86_64-apple-darwin
#     ud-mappe  standard: dist/macos/<target>
#
# Laver i ud-mappen:
#   TimeTrack.app                                  bundle-id dk.timetrack.desktop, som Tauri-appen
#   TimeTrack_<version>_<aarch64|x64>.dmg          til download (samme navn som 0.2.x)
#   darwin-<aarch64|x86_64>-TimeTrack.app.tar.gz   til updateren (Tauri-format: .app i roden)
# (TimeWren: TimeWren.app, com.timewren.desktop, TimeWren_<version>_….dmg og
#  darwin-…-TimeWren.app.tar.gz.)
#   ….app.tar.gz.sig                               kun med TAURI_SIGNING_PRIVATE_KEY
#
# Signering:
#   APPLE_SIGNING_IDENTITY sat: Developer ID med Hardened Runtime og
#     crates/tt-app/bundle/macos/entitlements.plist (notarisering sker i
#     release-workflowen bagefter, på .dmg'en).
#   Ellers ad hoc (`codesign -s -`): kører lokalt, men Gatekeeper advarer.
#   TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD): minisign-signatur til updateren
#     med Tauri-CLI'en (`npx @tauri-apps/cli signer sign`), samme nøgle som 0.2.x.
#
# Indbygget lokal AI: bygges med cargo-featuren local-llm (llama.cpp, statisk
#   linket; Metal på Apple silicon, CPU på Intel). Kræver cmake.
#   TT_FEATURES="" bygger uden (fx til en hurtig pakketest).
#
# TT_SKIP_BUILD=1 bruger en allerede bygget binær.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"

host_arch="$(uname -m)"
default_target=$([[ $host_arch == arm64 ]] && echo aarch64-apple-darwin || echo x86_64-apple-darwin)
target="${1:-$default_target}"
out="${2:-$root/dist/macos/$target}"
case "$target" in
  aarch64-apple-darwin) plat=aarch64; dmg_arch=aarch64; min_macos=11.0 ;;
  x86_64-apple-darwin) plat=x86_64; dmg_arch=x64; min_macos=10.15 ;;
  *) echo "Ukendt target: $target" >&2; exit 2 ;;
esac
features="${TT_FEATURES-local-llm}"

# --- brand (scripts/brands.json)
brand="${TT_BRAND:-timetrack}"
bj() { jq -r --arg b "$brand" ".[\$b].$1 // empty" "$root/scripts/brands.json"; }
[[ -n "$(bj id)" ]] || { echo "Ukendt brand: $brand (timetrack eller timewren)" >&2; exit 2; }
name="$(bj name)"
mac_exe="$(bj macExe)"
prefix="$(bj artifactPrefix)"
plist="$(bj plist)"
icns="$(bj icns)"
brand_features="$(bj cargoFeatures)"
[[ -n "$name" && -n "$mac_exe" && -n "$prefix" && -n "$plist" && -n "$icns" ]] || { echo "scripts/brands.json mangler felter for $brand" >&2; exit 1; }
if [[ -n "$brand_features" ]]; then features="${features:+$features,}$brand_features"; fi
# llama.cpp bygges med cmake, som ellers sigter efter værtens macOS-version.
# Samme minimum som Rust-koden og Info.plist, så appen starter på ældre macOS.
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-$min_macos}"
# Intel-Macs kører modellen på CPU'en (AVX2, se .cargo/config.toml).
# llama.cpp bygger altid Metal på macOS, uanset llama-cpp-2's metal-feature,
# og Metal på Intel-Macs' AMD/Intel-GPU'er er langsom eller ustabil.
if [[ $target == x86_64-apple-darwin ]]; then export GGML_METAL="${GGML_METAL:-OFF}"; fi

version="$(sed -n 's/^version = "\(.*\)"$/\1/p' crates/tt-app/Cargo.toml | head -1)"
[[ -n "$version" ]] || { echo "Kan ikke læse versionen i crates/tt-app/Cargo.toml" >&2; exit 1; }
target_dir="${CARGO_TARGET_DIR:-$root/target}"

if [[ -z "${TT_SKIP_BUILD:-}" ]]; then
  rustup target add "$target" >/dev/null 2>&1 || true
  if [[ -n "$features" ]]; then
    command -v cmake >/dev/null || { echo "cmake mangler (kræves af $features): brew install cmake" >&2; exit 1; }
  fi
  cargo build --release --locked -p tt-app --bin timetrack --target "$target" --features "$features"
fi
bin="$target_dir/$target/release/timetrack"
# TT_SKIP_BUILD efter en almindelig `cargo build --release` (uden --target) på værtens arkitektur.
if [[ ! -x "$bin" && -n "${TT_SKIP_BUILD:-}" && "$target" == "$default_target" ]]; then
  bin="$target_dir/release/timetrack"
fi
[[ -x "$bin" ]] || { echo "Binæren mangler: $bin" >&2; exit 1; }
# Kun systembiblioteker: en indlejret dylib (fx en dynamisk llama.cpp) skulle
# signeres for sig og lægges i Frameworks, ellers afviser notariseringen pakken.
foreign="$(otool -L "$bin" | grep -v ':$' | awk '{print $1}' | grep -v -E '^(/System/Library/|/usr/lib/)' || true)"
[[ -z "$foreign" ]] || { echo "Binæren linker til ikke-system-biblioteker:" >&2; echo "$foreign" >&2; exit 1; }

echo "Pakker $name $version ($target) i $out"
rm -rf "$out"
app="$out/$name.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
# TimeTrack: samme exe-navn som Tauri-appen (se Info.plist).
cp "$bin" "$app/Contents/MacOS/$mac_exe"
cp "crates/tt-app/bundle/macos/$icns" "$app/Contents/Resources/$icns"
sed "s/@VERSION@/$version/g" "crates/tt-app/bundle/macos/$plist" > "$app/Contents/Info.plist"
printf 'APPL????' > "$app/Contents/PkgInfo"
plutil -lint "$app/Contents/Info.plist" >/dev/null

# --- kodesignering
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  codesign --force --timestamp --options runtime \
    --entitlements crates/tt-app/bundle/macos/entitlements.plist \
    --sign "$APPLE_SIGNING_IDENTITY" "$app"
else
  codesign --force --sign - "$app"
fi
codesign --verify --strict --verbose=1 "$app"

# --- updater: .app.tar.gz med <navn>.app i roden (som Tauri)
tarball="$out/darwin-$plat-$prefix.app.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$tarball" -C "$out" "$name.app"
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  npx --yes @tauri-apps/cli@2.11.2 signer sign "$tarball" >/dev/null
  [[ -s "$tarball.sig" ]] || { echo "Updater-signaturen blev ikke lavet" >&2; exit 1; }
else
  echo "TAURI_SIGNING_PRIVATE_KEY mangler: ingen .sig (updateren vil afvise pakken)"
fi

# --- .dmg uden at montere noget (virker på runnere uden GUI-session)
dmg="$out/${prefix}_${version}_${dmg_arch}.dmg"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"
hdiutil makehybrid -quiet -hfs -hfs-volume-name "$name" -o "$stage/rå.dmg" "$stage"
hdiutil convert -quiet "$stage/rå.dmg" -format UDZO -o "$dmg"
codesign --force --sign "${APPLE_SIGNING_IDENTITY:--}" "$dmg"

echo "Færdig:"
ls -la "$out"
