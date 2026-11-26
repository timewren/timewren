#!/usr/bin/env bash
# Pak Mac App Store-udgaven (cargo-featuren mas) som .app og .pkg til App Store
# Connect. TT_BRAND=timewren pakker TimeWren (brands.json). Den almindelige
# Developer ID-udgave pakkes stadig med scripts/bundle-macos.sh og er uændret.
# Se docs/v1/MAC-APP-STORE.md.
#
#   scripts/bundle-macos-mas.sh [ud-mappe]
#     ud-mappe  standard: dist/macos-mas/<brand>
#
# Laver i ud-mappen:
#   TimeTrack.app                     bundle-id dk.timetrack.app (som iOS-appen)
#   TimeTrack_<version>_mas.pkg       til upload (Transporter / altool)
# (TimeWren: TimeWren.app, com.timewren.app, TimeWren_<version>_mas.pkg.)
#
# Binæren er universal (aarch64 + x86_64, lipo). TT_MAS_ARCHS="aarch64" bygger
# kun den ene (hurtig test i CI); App Store-pakker bygges altid med begge.
#
# Signering (alle tre sat = rigtig pakke, ellers tørkørsel):
#   MAS_APP_IDENTITY        "Apple Distribution: …" eller "3rd Party Mac Developer Application: …"
#   MAS_INSTALLER_IDENTITY  "3rd Party Mac Developer Installer: …" (Mac Installer Distribution)
#   APPLE_TEAM_ID           team-id'et; giver com.apple.application-identifier og
#                           com.apple.developer.team-identifier i entitlements
#   MAS_PROVISIONING_PROFILE  sti til brandets .provisionprofile (Mac App Store),
#                           lægges i Contents/embedded.provisionprofile
# Tørkørsel (ingen certifikater, fx i CI på PR'er): ad hoc-signeret med de samme
# sandbox-entitlements og en usigneret .pkg. Alt andet (plist, entitlements,
# arkitekturer, biblioteker) tjekkes ens. MAS_REQUIRE_SIGNING=1 stopper i
# stedet for at tørkøre.
#
# TT_FEATURES: ekstra features (standard local-llm; "" bygger uden lokal model).
# TT_MAS_BUILD_NUMBER: CFBundleVersion (skal stige ved hver upload; standard
#   versionen fra crates/tt-app/Cargo.toml).
# TT_SKIP_BUILD=1 bruger allerede byggede binærer (target/<target>/release/timetrack,
#   bygget med --features mas).
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"

# --- brand (scripts/brands.json)
brand="${TT_BRAND:-timetrack}"
bj() { jq -r --arg b "$brand" ".[\$b].$1 // empty" "$root/scripts/brands.json"; }
[[ -n "$(bj id)" ]] || { echo "Ukendt brand: $brand (timetrack eller timewren)" >&2; exit 2; }
name="$(bj name)"
mac_exe="$(bj macExe)"
prefix="$(bj artifactPrefix)"
plist_src="$(bj plist)"
icns="$(bj icns)"
bundle_id="$(bj masBundleId)"
brand_features="$(bj cargoFeatures)"
[[ -n "$name" && -n "$mac_exe" && -n "$prefix" && -n "$plist_src" && -n "$icns" && -n "$bundle_id" ]] \
  || { echo "scripts/brands.json mangler felter for $brand (også masBundleId)" >&2; exit 1; }

out="${1:-$root/dist/macos-mas/$brand}"
features="mas"
extra="${TT_FEATURES-local-llm}"
[[ -n "$extra" ]] && features="$features,$extra"
[[ -n "$brand_features" ]] && features="$features,$brand_features"
# SMAppService (autostart.rs) kræver macOS 13.
min_macos=13.0
export MACOSX_DEPLOYMENT_TARGET="$min_macos"

version="$(sed -n 's/^version = "\(.*\)"$/\1/p' crates/tt-app/Cargo.toml | head -1)"
[[ -n "$version" ]] || { echo "Kan ikke læse versionen i crates/tt-app/Cargo.toml" >&2; exit 1; }
build_number="${TT_MAS_BUILD_NUMBER:-$version}"
[[ "$build_number" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || { echo "TT_MAS_BUILD_NUMBER skal være højst tre tal med punktum imellem: $build_number" >&2; exit 1; }
target_dir="${CARGO_TARGET_DIR:-$root/target}"

signed=0
if [[ -n "${MAS_APP_IDENTITY:-}" && -n "${MAS_INSTALLER_IDENTITY:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  signed=1
  [[ -s "${MAS_PROVISIONING_PROFILE:-}" ]] || { echo "MAS_PROVISIONING_PROFILE mangler eller er tom" >&2; exit 1; }
elif [[ -n "${MAS_REQUIRE_SIGNING:-}" ]]; then
  echo "MAS_REQUIRE_SIGNING: MAS_APP_IDENTITY, MAS_INSTALLER_IDENTITY og APPLE_TEAM_ID skal alle være sat" >&2
  exit 1
fi

# --- byg pr. arkitektur og saml med lipo
archs="${TT_MAS_ARCHS:-aarch64 x86_64}"
bins=()
for a in $archs; do
  case "$a" in
    aarch64) target=aarch64-apple-darwin ;;
    x86_64) target=x86_64-apple-darwin ;;
    *) echo "Ukendt arkitektur: $a (aarch64 eller x86_64)" >&2; exit 2 ;;
  esac
  if [[ -z "${TT_SKIP_BUILD:-}" ]]; then
    rustup target add "$target" >/dev/null 2>&1 || true
    if [[ "$features" == *local-llm* ]]; then
      command -v cmake >/dev/null || { echo "cmake mangler (kræves af local-llm): brew install cmake" >&2; exit 1; }
    fi
    # Intel kører modellen på CPU'en (som bundle-macos.sh).
    if [[ $target == x86_64-apple-darwin ]]; then
      GGML_METAL="${GGML_METAL:-OFF}" cargo build --release --locked -p tt-app --bin timetrack --target "$target" --features "$features"
    else
      cargo build --release --locked -p tt-app --bin timetrack --target "$target" --features "$features"
    fi
  fi
  bin="$target_dir/$target/release/timetrack"
  # TT_SKIP_BUILD efter `cargo build --release --features mas` uden --target
  # (værtens arkitektur, som i CI's tørkørsel).
  host=$([[ "$(uname -m)" == arm64 ]] && echo aarch64-apple-darwin || echo x86_64-apple-darwin)
  if [[ ! -x "$bin" && -n "${TT_SKIP_BUILD:-}" && "$target" == "$host" ]]; then
    bin="$target_dir/release/timetrack"
  fi
  [[ -x "$bin" ]] || { echo "Binæren mangler: $bin" >&2; exit 1; }
  bins+=("$bin")
done
[[ ${#bins[@]} -gt 0 ]] || { echo "TT_MAS_ARCHS er tom" >&2; exit 2; }

echo "Pakker $name $version (build $build_number, App Store, $archs) i $out"
rm -rf "$out"
app="$out/$name.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
exe="$app/Contents/MacOS/$mac_exe"
if [[ ${#bins[@]} -gt 1 ]]; then
  lipo -create -output "$exe" "${bins[@]}"
else
  cp "${bins[0]}" "$exe"
fi
for a in $archs; do
  want=$([[ $a == aarch64 ]] && echo arm64 || echo x86_64)
  lipo -archs "$exe" | tr ' ' '\n' | grep -qx "$want" || { echo "Binæren mangler arkitekturen $want" >&2; exit 1; }
done
# Kun systembiblioteker (som bundle-macos.sh). otool skriver en overskrift
# ("sti (architecture x):") pr. arkitektur i en universal-binær; de filtreres fra.
foreign="$(otool -L "$exe" | grep -v ':$' | awk '{print $1}' | grep -v -E '^(/System/Library/|/usr/lib/)' || true)"
[[ -z "$foreign" ]] || { echo "Binæren linker til ikke-system-biblioteker:" >&2; echo "$foreign" >&2; exit 1; }

cp "crates/tt-app/bundle/macos/$icns" "$app/Contents/Resources/$icns"
printf 'APPL????' > "$app/Contents/PkgInfo"

# --- Info.plist: brandets plist med App Store-udgavens ændringer
plist="$app/Contents/Info.plist"
sed "s/@VERSION@/$version/g" "crates/tt-app/bundle/macos/$plist_src" > "$plist"
plutil -replace CFBundleIdentifier -string "$bundle_id" "$plist"
plutil -replace CFBundleVersion -string "$build_number" "$plist"
plutil -replace CFBundleURLTypes.0.CFBundleURLName -string "$bundle_id" "$plist"
plutil -replace LSApplicationCategoryType -string public.app-category.productivity "$plist"
plutil -replace LSMinimumSystemVersion -string "$min_macos" "$plist"
plutil -replace ITSAppUsesNonExemptEncryption -bool false "$plist"
# Ingen Apple Events i App Store-udgaven (ingen browser-adresse).
plutil -remove NSAppleEventsUsageDescription "$plist" 2>/dev/null || true
plutil -lint "$plist" >/dev/null
check_plist() {
  local got
  got="$(plutil -extract "$1" raw "$plist" 2>/dev/null || true)"
  [[ "$got" == "$2" ]] || { echo "Info.plist: $1 er '$got', ikke '$2'" >&2; exit 1; }
}
check_plist CFBundleIdentifier "$bundle_id"
check_plist CFBundleExecutable "$mac_exe"
check_plist CFBundleShortVersionString "$version"
check_plist CFBundleVersion "$build_number"
check_plist LSApplicationCategoryType public.app-category.productivity
check_plist ITSAppUsesNonExemptEncryption false
check_plist LSMinimumSystemVersion "$min_macos"
! plutil -extract NSAppleEventsUsageDescription raw "$plist" >/dev/null 2>&1 \
  || { echo "Info.plist har stadig NSAppleEventsUsageDescription" >&2; exit 1; }

# --- entitlements: sandbox-filen + team og app-id ved rigtig signering.
# PlistBuddy, fordi nøglerne har punktummer (plutil læser dem som stier).
pb() { /usr/libexec/PlistBuddy -c "$1" "$2"; }
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
ent="$stage/entitlements.plist"
cp crates/tt-app/bundle/macos/entitlements-mas.plist "$ent"
if [[ $signed == 1 ]]; then
  pb "Add :com.apple.application-identifier string $APPLE_TEAM_ID.$bundle_id" "$ent"
  pb "Add :com.apple.developer.team-identifier string $APPLE_TEAM_ID" "$ent"
  cp "$MAS_PROVISIONING_PROFILE" "$app/Contents/embedded.provisionprofile"
  # Profilen skal høre til samme app og team.
  security cms -D -i "$app/Contents/embedded.provisionprofile" > "$stage/profile.plist"
  prof_app="$(pb "Print :Entitlements:com.apple.application-identifier" "$stage/profile.plist" 2>/dev/null || true)"
  [[ "$prof_app" == "$APPLE_TEAM_ID.$bundle_id" ]] \
    || { echo "Provisioning profile er til '$prof_app', ikke '$APPLE_TEAM_ID.$bundle_id'" >&2; exit 1; }
fi
plutil -lint "$ent" >/dev/null

# --- kodesignering
if [[ $signed == 1 ]]; then
  codesign --force --timestamp --options runtime --entitlements "$ent" --sign "$MAS_APP_IDENTITY" "$app"
else
  echo "Tørkørsel: ingen MAS-certifikater, ad hoc-signeret og usigneret .pkg (kan ikke uploades)"
  codesign --force --entitlements "$ent" --sign - "$app"
fi
codesign --verify --strict --verbose=1 "$app"

# Signaturen skal have sandkassen og ingen Apple Events eller undtagelser.
codesign -d --entitlements - --xml "$app" 2>/dev/null > "$stage/signed.plist"
plutil -lint "$stage/signed.plist" >/dev/null
[[ "$(pb "Print :com.apple.security.app-sandbox" "$stage/signed.plist" 2>/dev/null || true)" == true ]] \
  || { echo "Signaturen mangler com.apple.security.app-sandbox" >&2; exit 1; }
if grep -q -E 'automation\.apple-events|temporary-exception' "$stage/signed.plist"; then
  echo "Signaturen har Apple Events eller en temporary exception" >&2
  exit 1
fi

# --- .pkg (installeres i /Applications)
pkg="$out/${prefix}_${version}_mas.pkg"
if [[ $signed == 1 ]]; then
  productbuild --component "$app" /Applications --sign "$MAS_INSTALLER_IDENTITY" "$pkg"
  pkgutil --check-signature "$pkg"
else
  productbuild --component "$app" /Applications "$pkg"
fi
[[ -s "$pkg" ]] || { echo ".pkg blev ikke lavet" >&2; exit 1; }

echo "Færdig:"
ls -la "$out"
