#!/usr/bin/env bash
# Test af scripts/bump-version mod en kopi af de filer, det rører.
#   scripts/test-bump-version.sh
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
bump="$here/scripts/bump-version"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fails=0

setup() {
  rm -rf "$work/repo"
  mkdir -p "$work/repo/crates/tt-app"
  # Fast CHANGELOG, så testen ikke afhænger af, hvilke afsnit repoet har.
  printf '# Changelog\n\n## [0.2.23] - 2026-10-27\n' > "$work/repo/CHANGELOG.md"
  # Start fra en kendt version (0.2.23), uanset hvad repoet står på.
  awk '!d && /^version = "/ { print "version = \"0.2.23\""; d = 1; next } { print }' \
    "$here/crates/tt-app/Cargo.toml" > "$work/repo/crates/tt-app/Cargo.toml"
  awk '/^name = "tt-app"$/ { print; h = 1; next } h && /^version = "/ { print "version = \"0.2.23\""; h = 0; next } { h = 0; print }' \
    "$here/Cargo.lock" > "$work/repo/Cargo.lock"
}
version_toml() { sed -n 's/^version = "\(.*\)"$/\1/p' "$work/repo/crates/tt-app/Cargo.toml" | head -1; }
version_lock() { awk '/^name = "tt-app"$/ { getline; print; exit }' "$work/repo/Cargo.lock" | sed -n 's/^version = "\(.*\)"$/\1/p'; }
run() { BUMP_ROOT="$work/repo" "$bump" "$@" >"$work/out" 2>&1; }
ok() { echo "ok   $1"; }
bad() { echo "FEJL $1"; command cat "$work/out" 2>/dev/null || true; fails=$((fails + 1)); }

# 1. Et PATCH-skridt sætter begge filer, og intet andet i dem ændres.
setup
cp "$work/repo/Cargo.lock" "$work/lock.before"
cp "$work/repo/crates/tt-app/Cargo.toml" "$work/toml.before"
if run 0.2.24 && [[ "$(version_toml)" == 0.2.24 && "$(version_lock)" == 0.2.24 ]]; then
  ok "0.2.23 -> 0.2.24 i Cargo.toml og Cargo.lock"
else bad "0.2.23 -> 0.2.24"; fi
n_lock=$(diff "$work/lock.before" "$work/repo/Cargo.lock" | grep -c '^>' || true)
n_toml=$(diff "$work/toml.before" "$work/repo/crates/tt-app/Cargo.toml" | grep -c '^>' || true)
if [[ "$n_lock" == 1 && "$n_toml" == 1 ]]; then ok "kun én linje ændret i hver fil"
else bad "ændrede linjer: lock=$n_lock toml=$n_toml"; fi
# Afhængigheder med version = "..." i Cargo.toml er urørte.
if grep -q 'gpui-kit = { version = "=0.8.1" }' "$work/repo/crates/tt-app/Cargo.toml"; then
  ok "afhængigheder urørte"; else bad "afhængigheder ændret"; fi

# 2. Forudgivelse og derefter den endelige version.
setup
if run 0.2.24-beta.1 && [[ "$(version_toml)" == 0.2.24-beta.1 ]] && run 0.2.24-beta.2 && run 0.2.24 \
  && [[ "$(version_lock)" == 0.2.24 ]]; then
  ok "beta.1 -> beta.2 -> endelig"
else bad "forudgivelser"; fi

# 3. Aldrig baglæns eller samme version.
setup
for v in 0.2.22 0.2.23 0.2.23-beta.1 0.1.99; do
  if run "$v"; then bad "$v blev godtaget"; else ok "afviser $v"; fi
done
[[ "$(version_toml)" == 0.2.23 ]] && ok "uændret efter afvisning" || bad "ændret efter afvisning"

# 4. Ugyldig form.
for v in "" 1.0 v0.2.24 0.2.24.1 0.02.24; do
  if run "$v"; then bad "'$v' blev godtaget"; else ok "afviser '$v'"; fi
done

# 5. Numerisk sammenligning (0.2.100 > 0.2.99, 0.10.0 > 0.9.9).
setup
if run 0.2.100 && run 0.10.0 && [[ "$(version_toml)" == 0.10.0 ]]; then ok "numerisk"; else bad "numerisk"; fi

# 6. Advarsel om manglende CHANGELOG-afsnit.
setup
run 0.2.24 || true
if grep -q "CHANGELOG.md mangler" "$work/out"; then ok "advarer om CHANGELOG"; else bad "ingen CHANGELOG-advarsel"; fi

if [[ $fails -gt 0 ]]; then echo "$fails fejl"; exit 1; fi
echo "Alle bump-version-tests bestået"
