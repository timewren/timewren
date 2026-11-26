#!/usr/bin/env node
// Tjekker, at de to udgaver (TimeTrack og TimeWren) holder sig adskilt i alt,
// der ikke er Rust-kode: sprogfiler, pakkefiler og udgivelses-workflowet.
//
//   node scripts/check-brand.mjs
//
// Rust-siden (bundle-id, datamappe, opdateringskanal, tekster pr. udgave)
// testes af `cargo test -p tt-core` og `brand_`-testene i tt-app. Denne fil
// dækker resten, og at `scripts/brands.json` stemmer med bundle-filerne.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const brands = JSON.parse(read("scripts/brands.json"));
const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
};

// ---- 1. Sprogfiler: intet fast brand, ingen fast valuta eller pris.
// Brandet, adressen, valutaen og prisen står som variabler (crates/tt-core/src/edition.rs,
// Edition::localise), så TimeWren aldrig siger "TimeTrack".
const localeRoot = path.join(root, "crates/tt-app/locales");
let strings = 0;
for (const lang of fs.readdirSync(localeRoot)) {
  for (const file of fs.readdirSync(path.join(localeRoot, lang))) {
    const rel = `crates/tt-app/locales/${lang}/${file}`;
    const data = JSON.parse(read(rel));
    for (const [key, value] of Object.entries(data)) {
      strings++;
      const lower = String(value).toLowerCase();
      for (const word of ["timetrack", "timewren", "dkk"]) {
        check(!lower.includes(word), `${rel}: ${key} nævner "${word}" (brug en pladsholder)`);
      }
      check(!/\b499\b/.test(String(value)), `${rel}: ${key} har en fast pris (brug {price})`);
    }
  }
}
// {brand} skal findes: ellers er tjekket ovenfor tomt.
check(read("crates/tt-app/locales/en/nav.json").includes("{brand}"), "en/nav.json mangler {brand}");

// ---- 2. Pakkefiler: TimeWrens filer nævner ikke TimeTrack, og id'erne passer.
const tw = brands.timewren;
const tt = brands.timetrack;
const plistTw = read(`crates/tt-app/bundle/macos/${tw.plist}`);
const plistTt = read(`crates/tt-app/bundle/macos/${tt.plist}`);
const rcTw = read(`crates/tt-app/bundle/windows/${tw.rc}`);
const svgTw = read("crates/tt-app/assets/icons/tt-maerke-timewren.svg");
for (const [name, text] of [
  [tw.plist, plistTw],
  [tw.rc, rcTw],
  ["tt-maerke-timewren.svg", svgTw],
]) {
  check(!/timetrack/i.test(text), `${name} nævner TimeTrack`);
}
const plistValue = (text, key) => {
  const m = text.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return m ? m[1] : null;
};
for (const [b, text] of [
  [tt, plistTt],
  [tw, plistTw],
]) {
  check(plistValue(text, "CFBundleIdentifier") === b.bundleId, `${b.plist}: CFBundleIdentifier != ${b.bundleId}`);
  check(plistValue(text, "CFBundleName") === b.name, `${b.plist}: CFBundleName != ${b.name}`);
  check(plistValue(text, "CFBundleDisplayName") === b.name, `${b.plist}: CFBundleDisplayName != ${b.name}`);
  check(plistValue(text, "CFBundleExecutable") === b.macExe, `${b.plist}: CFBundleExecutable != ${b.macExe}`);
  check(plistValue(text, "CFBundleIconFile") === b.icns.replace(/\.icns$/, ""), `${b.plist}: CFBundleIconFile`);
  check(text.includes(`<string>${b.urlScheme}</string>`), `${b.plist}: URL-skemaet ${b.urlScheme} mangler`);
  check(text.includes("@VERSION@"), `${b.plist}: @VERSION@ mangler`);
}
for (const b of [tt, tw]) {
  for (const f of [`bundle/macos/${b.icns}`, `bundle/windows/${b.ico}`, `bundle/windows/${b.rc}`]) {
    check(fs.existsSync(path.join(root, "crates/tt-app", f)), `crates/tt-app/${f} findes ikke`);
  }
}
check(rcTw.includes('"timewren.exe"') && rcTw.includes("TimeWren.ico"), "timewren.rc: exe eller ikon");

// ---- 3. Windows-installeren: samme værdier som brands.json, og kun TimeTrack afløser 0.2.x.
const nsi = read("crates/tt-app/bundle/windows/installer.nsi");
const block = (id) => {
  const m = nsi.match(new RegExp(`(?:!if|!else if) "\\$\\{BRAND\\}" == "${id}"([\\s\\S]*?)(?:!else|!endif)`));
  return m ? m[1] : "";
};
for (const b of [tt, tw]) {
  const text = block(b.id);
  check(text !== "", `installer.nsi: blokken for ${b.id} mangler`);
  const def = (name) => (text.match(new RegExp(`!define ${name} "([^"]*)"`)) || [])[1];
  check(def("PRODUCTNAME") === b.name, `installer.nsi ${b.id}: PRODUCTNAME`);
  check(def("BUNDLEID") === b.bundleId, `installer.nsi ${b.id}: BUNDLEID`);
  check(def("MAINBINARYNAME") === b.exeName, `installer.nsi ${b.id}: MAINBINARYNAME`);
  check(def("ICONFILE") === b.ico, `installer.nsi ${b.id}: ICONFILE`);
  check(def("URLSCHEME") === b.urlScheme, `installer.nsi ${b.id}: URLSCHEME`);
}
check(!/LEGACY_TAURI/.test(block("timewren")), "installer.nsi: TimeWren må ikke afløse 0.2.x");
check(/LEGACY_TAURI/.test(block("timetrack")), "installer.nsi: TimeTrack skal afløse 0.2.x");
check(!/OLDBINARYNAME/.test(block("timewren")), "installer.nsi: TimeWren må ikke kende den gamle exe");

// ---- 3b. TimeWrens farver og mærke: kun brandkittets fem farver, og ikonerne kommer fra webmærket.
const FIVE = { ink: "#1C2119", mark: "#8A5A2B", deep: "#3F5A3A", light: "#E8EDE3", accent: "#E8B04B" };
for (const [key, hex] of Object.entries(FIVE)) {
  check(tw.colors?.[key]?.toUpperCase() === hex, `brands.json: timewren.colors.${key} er ikke ${hex}`);
}
check(Object.keys(tw.colors ?? {}).length === 5, "brands.json: timewren.colors skal have præcis fem farver");
const brandDir = "crates/tt-app/assets/brand/timewren";
for (const [file, hex] of [["mark.svg", FIVE.mark], ["mark-light.svg", FIVE.light], ["mark-mono.svg", FIVE.ink]]) {
  const svg = read(`${brandDir}/${file}`).toUpperCase();
  const used = new Set(svg.match(/#[0-9A-F]{6}\b/g));
  check(used.size === 1 && used.has(hex), `${brandDir}/${file}: forventer kun ${hex}, fandt ${[...used].join(", ")}`);
}
const uiMark = read("crates/tt-app/assets/icons/tt-maerke-timewren.svg");
check(uiMark.includes("currentColor") && !/#8A5A2B/i.test(uiMark), "tt-maerke-timewren.svg: skal være i currentColor");
check(
  !/2563EB/i.test(read("scripts/make-timewren-icons.py")),
  "make-timewren-icons.py: det blå TW-monogram (#2563EB) er afløst af webmærket",
);

// ---- 4. Cargo-featuren findes begge steder.
for (const rel of ["crates/tt-app/Cargo.toml", "crates/tt-core/Cargo.toml"]) {
  check(/^brand-timewren\s*=/m.test(read(rel)), `${rel}: featuren brand-timewren mangler`);
}

// ---- 4b. Mac App Store-udgaven (featuren mas, docs/v1/MAC-APP-STORE.md): egen
// bundle-id pr. brand (som iOS-appen), sandkasse uden Apple Events og undtagelser,
// og Developer ID-udgavens entitlements er urørte.
check(/^mas\s*=/m.test(read("crates/tt-app/Cargo.toml")), "crates/tt-app/Cargo.toml: featuren mas mangler");
check(tt.masBundleId === "dk.timetrack.app", "brands.json: timetrack.masBundleId skal være dk.timetrack.app (iOS)");
check(tw.masBundleId === "com.timewren.app", "brands.json: timewren.masBundleId skal være com.timewren.app (iOS)");
for (const b of [tt, tw]) check(b.masBundleId !== b.bundleId, `brands.json: ${b.id}.masBundleId = bundleId`);
// Erhvervslicensen (in-app-køb): produkt-id'et hører til App Store-recordet, og
// StoreKit-testkonfigurationen til lokal test har samme produkt som non-consumable.
for (const b of [tt, tw]) {
  check(b.masBusinessProductId === `${b.masBundleId}.desktop.business`, `brands.json: ${b.id}.masBusinessProductId`);
  const rel = `crates/tt-app/bundle/macos/${b.name}.storekit`;
  let sk = null;
  try {
    sk = JSON.parse(read(rel));
  } catch (e) {
    check(false, `${rel}: mangler eller er ikke gyldig JSON (${e.message})`);
  }
  if (sk) {
    const products = sk.products ?? [];
    const p = products.find((x) => x.productID === b.masBusinessProductId);
    check(p && p.type === "NonConsumable", `${rel}: non-consumable ${b.masBusinessProductId} mangler`);
    check(products.length === 1 && (sk.subscriptionGroups ?? []).length === 0, `${rel}: kun erhvervslicensen`);
  }
}
const entMas = read("crates/tt-app/bundle/macos/entitlements-mas.plist");
const entTrue = (text, key) => new RegExp(`<key>${key.replace(/\./g, "\\.")}</key>\\s*<true/>`).test(text);
check(entTrue(entMas, "com.apple.security.app-sandbox"), "entitlements-mas.plist: app-sandbox mangler");
check(entTrue(entMas, "com.apple.security.network.client"), "entitlements-mas.plist: network.client mangler");
const entMasKeys = entMas.replace(/<!--[\s\S]*?-->/g, "");
check(!/apple-events|temporary-exception/.test(entMasKeys), "entitlements-mas.plist: Apple Events eller temporary exception");
const entDevId = read("crates/tt-app/bundle/macos/entitlements.plist").replace(/<!--[\s\S]*?-->/g, "");
check(!/app-sandbox/.test(entDevId), "entitlements.plist (Developer ID) må ikke have sandkassen");
check(entTrue(entDevId, "com.apple.security.automation.apple-events"), "entitlements.plist (Developer ID) mangler apple-events");

// ---- 5. Udgivelses-workflowet bygger og udgiver begge, uden at røre TimeTracks navne.
const wf = read(".github/workflows/release-desktop.yml");
check(wf.includes("scripts/brands.json") || wf.includes("brand:"), "release-desktop.yml: ingen brand-matrix");
check(wf.includes("TT_BRAND"), "release-desktop.yml: TT_BRAND bruges ikke");
check(wf.includes("timewren-stable"), "release-desktop.yml: kanalen timewren-stable mangler");
check(wf.includes("timewren-v"), "release-desktop.yml: tagget timewren-v<version> mangler");
check(wf.includes("name: TimeTrack v"), "release-desktop.yml: TimeTracks release-navn er ændret");
check(wf.includes("tag_name: v${{ needs.version.outputs.version }}"), "release-desktop.yml: TimeTracks release-tag er ændret");

if (failures.length) {
  console.error(`Brand-tjekket fandt ${failures.length} fejl:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`Brand-tjekket er grønt (${strings} tekster i sprogfilerne, 2 udgaver).`);
