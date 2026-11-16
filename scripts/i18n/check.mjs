#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// Kontrollerer sprogkatalogerne. Fejler (exit 1) ved afvigelse.
//
//   node scripts/i18n/check.mjs                 kontrol af alle sprog (CI)
//   node scripts/i18n/check.mjs --lang sv       kun sv (flere: --lang sv,nb eller --lang sv --lang nb)
//   node scripts/i18n/check.mjs --report        dækning pr. sprog og katalog (antal nøgler, procent, korrektur)
//
// Regler:
//  - da (kilde) og en skal være fuldstændige: samme nøgler som da, ingen tomme tekster.
//  - Beta-sprog (alt andet) må være delvise. En nøgle, der mangler, læses på engelsk (src/i18n/fallback.ts).
//    Til gengæld fejler kontrollen på: ugyldig JSON, tekst der ikke er en streng, tom tekst, nøgler eller
//    filer der ikke findes i da, ubalancerede klammer, pladsholdere (ICU) der afviger fra da, og
//    flertalsformer (plural/selectordinal) der mangler en af de kategorier, sproget kræver.
//  - Browserudvidelsens _locales (til butikkerne) skal være fuldstændig i alle mapper, der findes, for Chrome falder
//    selv tilbage til manifestets default_locale (dansk), og et beta-sprog må aldrig vise dansk.
//
// Katalog: <dir>/<sprog>/<navneområde>.json. Korrektur: <dir>/review-approved.json har { "de": ["nav.team", ...] }.
// En nøgle i et beta-sprog, der ikke står dér, tæller som "kræver korrektur" (rapporteres, fejler ikke).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// I18N_CHECK_ROOT lader testen køre kontrollen mod et lille prøvekatalog.
const root =
  process.env.I18N_CHECK_ROOT ??
  fileURLToPath(new URL("../..", import.meta.url));
const cfg = JSON.parse(
  readFileSync(join(root, "scripts/i18n/catalogs.json"), "utf8"),
);

const args = process.argv.slice(2);
const report = args.includes("--report");
const only = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--lang") {
    const v = args[++i];
    if (!v) fatal("--lang kræver en sprogkode, fx --lang sv");
    only.push(...v.split(",").filter(Boolean));
  } else if (args[i].startsWith("--lang=")) {
    only.push(...args[i].slice(7).split(",").filter(Boolean));
  }
}
for (const l of only) {
  if (!cfg.locales.includes(l))
    fatal(`Ukendt sprog "${l}". Kendte sprog: ${cfg.locales.join(", ")}`);
}
const locales = only.length ? only : cfg.locales;
const COMPLETE = new Set(cfg.complete);

function fatal(msg) {
  console.error(msg);
  process.exit(2);
}

const errors = [];
const err = (msg) => errors.push(msg);

function flatten(obj, prefix, out, onBad) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v))
      flatten(v, key, out, onBad);
    else onBad(key, v);
  }
}

// Pladsholdere i ICU-tekst: {count}, {name} og navnene i plural/select, også i grene.
function placeholders(text) {
  const names = new Set();
  const re = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g;
  for (const m of String(text).matchAll(re)) names.add(m[1]);
  return [...names].sort().join(",");
}

function balanced(text) {
  let depth = 0;
  for (const ch of String(text)) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

// --- flertalsformer -----------------------------------------------------------------------------
const SAMPLE = [...Array.from({ length: 1001 }, (_, i) => i), 0.5, 1.5, 2.5];
const requiredCache = new Map();

// De kategorier, et sprog faktisk bruger for hele tal og simple decimaltal. `many` i fransk, spansk,
// italiensk og portugisisk gælder kun store tal (millioner) og kræves ikke; i polsk og tjekkisk gælder den
// almindelige tal og kræves. Kinesisk, japansk og koreansk har kun `other`.
function requiredCategories(intlTag, type) {
  const k = `${intlTag}|${type}`;
  if (!requiredCache.has(k)) {
    const rules = new Intl.PluralRules(intlTag, { type });
    const hit = new Set(["other"]);
    for (const n of SAMPLE) hit.add(rules.select(n));
    const all = rules.resolvedOptions().pluralCategories;
    requiredCache.set(
      k,
      all.filter((c) => hit.has(c)),
    );
  }
  return requiredCache.get(k);
}

function closeIndex(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

// Alle plural-/selectordinal-blokke i en tekst: { name, type, selectors[] } (selectors på blokkens øverste niveau).
function pluralBlocks(text) {
  const out = [];
  const re = /\{\s*([A-Za-z_]\w*)\s*,\s*(plural|selectordinal)\s*,/g;
  for (const m of String(text).matchAll(re)) {
    const open = m.index;
    const end = closeIndex(text, open);
    if (end === -1) continue;
    const body = text.slice(open + m[0].length, end);
    const selectors = [];
    let i = 0;
    while (i < body.length) {
      const b = body.indexOf("{", i);
      if (b === -1) break;
      const sel = body.slice(i, b).trim();
      if (sel) selectors.push(sel);
      const c = closeIndex(body, b);
      if (c === -1) break;
      i = c + 1;
    }
    out.push({
      name: m[1],
      type: m[2] === "plural" ? "cardinal" : "ordinal",
      selectors,
    });
  }
  return out;
}

function intlTag(locale) {
  return cfg.intl[locale];
}

// --- indlæsning --------------------------------------------------------------------------------
function loadLocale(dir, label, locale, base) {
  const out = {};
  const ldir = join(dir, locale);
  if (!existsSync(ldir)) return null;
  for (const f of readdirSync(ldir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const ns = f.slice(0, -5);
    const where = `${label}/${locale}/${f}`;
    if (base && !base.namespaces.has(ns)) {
      err(
        `${where}: navneområdet findes ikke i ${cfg.base} (filen skal slettes eller omdøbes)`,
      );
      continue;
    }
    let json;
    try {
      json = JSON.parse(readFileSync(join(ldir, f), "utf8"));
    } catch (e) {
      err(`${where}: ugyldig JSON (${e.message})`);
      continue;
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      err(`${where}: skal være et JSON-objekt`);
      continue;
    }
    flatten(json, ns, out, (key, v) =>
      err(
        `${label}/${locale}: ${key} skal være tekst, ikke ${Array.isArray(v) ? "liste" : typeof v}`,
      ),
    );
  }
  return out;
}

const summary = [];

for (const cat of cfg.catalogs) {
  const dir = join(root, cat.dir);
  const declared = new Set(cfg.locales);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !declared.has(e.name))
      err(
        `${cat.name}: ${e.name}/ er ikke et erklæret sprog (scripts/i18n/catalogs.json)`,
      );
  }
  const baseErrStart = errors.length;
  const baseCat = loadLocale(dir, cat.name, cfg.base, null);
  if (!baseCat) {
    err(`${cat.name}: kildesproget ${cfg.base}/ mangler`);
    continue;
  }
  if (errors.length > baseErrStart) continue;
  const base = {
    namespaces: new Set(
      readdirSync(join(dir, cfg.base))
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.slice(0, -5)),
    ),
  };
  const approvedFile = join(dir, "review-approved.json");
  const approved = existsSync(approvedFile)
    ? JSON.parse(readFileSync(approvedFile, "utf8"))
    : {};
  const baseKeys = Object.keys(baseCat);
  const basePh = Object.fromEntries(
    baseKeys.map((k) => [k, placeholders(baseCat[k])]),
  );

  for (const locale of locales) {
    const cur = loadLocale(dir, cat.name, locale, base);
    if (!cur) {
      if (only.length || COMPLETE.has(locale))
        err(`${cat.name}: mappen ${locale}/ mangler`);
      else
        summary.push({
          cat: cat.name,
          locale,
          have: 0,
          total: baseKeys.length,
          pending: 0,
        });
      continue;
    }
    const complete = COMPLETE.has(locale);
    if (complete) {
      for (const key of baseKeys)
        if (!(key in cur)) err(`${cat.name}/${locale}: mangler nøgle ${key}`);
    }
    for (const [key, text] of Object.entries(cur)) {
      const at = `${cat.name}/${locale}`;
      if (!(key in baseCat)) {
        err(`${at}: ekstra nøgle ${key} (findes ikke i ${cfg.base})`);
        continue;
      }
      if (text.trim() === "") err(`${at}: tom tekst i ${key}`);
      if (!balanced(text)) {
        err(`${at}: ubalancerede klammer i ${key}`);
        continue;
      }
      const ph = placeholders(text);
      if (ph !== basePh[key]) {
        err(
          `${at}: pladsholdere i ${key} afviger (${ph || "ingen"} mod ${basePh[key] || "ingen"})`,
        );
      }
      // Flertal: hvert flertalsled i oversættelsen skal have alle sprogets kategorier (en eksakt =1 dækker one, =0 dækker zero).
      // Der kræves ikke et flertalsled, hvor kilden har et: mange sprog skriver sætningen uden.
      for (const block of pluralBlocks(text)) {
        // Kun exakte værdier og `other` ("=0 {} other {, # fejlede}") bøjer intet og kræver ingen kategorier.
        if (!block.selectors.some((c) => !c.startsWith("=") && c !== "other"))
          continue;
        const need = requiredCategories(intlTag(locale), block.type);
        const covers = (c) =>
          block.selectors.includes(c) ||
          (c === "one" && block.selectors.includes("=1")) ||
          (c === "zero" && block.selectors.includes("=0"));
        const missing = need.filter((c) => !covers(c));
        if (missing.length)
          err(
            `${at}: flertal for {${block.name}} i ${key} mangler ${missing.join(", ")} (${locale} kræver ${need.join("/")})`,
          );
      }
    }
    for (const key of approved[locale] ?? []) {
      if (!(key in cur))
        err(
          `${cat.name}/${locale}: review-approved peger på ukendt nøgle ${key}`,
        );
    }
    if (!complete) {
      const ok = new Set(approved[locale] ?? []);
      const have = Object.keys(cur).length;
      summary.push({
        cat: cat.name,
        locale,
        have,
        total: baseKeys.length,
        pending: Object.keys(cur).filter((k) => !ok.has(k)).length,
      });
    }
  }
}

// --- browserudvidelsens _locales (butikkernes tekster) -------------------------------------------
{
  const dir = join(root, cfg.chromeLocalesDir);
  const byChrome = new Map(cfg.locales.map((l) => [cfg.chrome[l], l]));
  const keysOf = (code, label) => {
    const file = join(dir, code, "messages.json");
    if (!existsSync(file)) {
      err(`chrome-locales: ${code}/messages.json mangler`);
      return null;
    }
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      err(`chrome-locales/${label}: ugyldig JSON (${e.message})`);
      return null;
    }
  };
  const baseMsgs = keysOf(cfg.chrome[cfg.base], cfg.base);
  for (const code of readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)) {
    const locale = byChrome.get(code);
    if (!locale) {
      err(
        `chrome-locales: ${code}/ er ikke Chrome-koden for et erklæret sprog (se "chrome" i scripts/i18n/catalogs.json)`,
      );
      continue;
    }
    if (only.length && !only.includes(locale)) continue;
    const msgs = keysOf(code, locale);
    if (!msgs || !baseMsgs) continue;
    for (const k of Object.keys(baseMsgs))
      if (!(k in msgs))
        err(
          `chrome-locales/${code}: mangler ${k} (Chrome ville vise dansk; mappen skal være fuldstændig)`,
        );
    for (const [k, v] of Object.entries(msgs)) {
      if (!(k in baseMsgs)) err(`chrome-locales/${code}: ekstra nøgle ${k}`);
      else if (typeof v?.message !== "string" || v.message.trim() === "")
        err(`chrome-locales/${code}: ${k} mangler "message"`);
    }
  }
  if (only.length) {
    for (const l of only) {
      if (!COMPLETE.has(l) && !existsSync(join(dir, cfg.chrome[l])))
        err(`chrome-locales: mappen ${cfg.chrome[l]}/ mangler for ${l}`);
    }
  }
}

if (report) {
  console.log("Dækning (nøgler oversat af nøgler i kilden):");
  for (const s of summary) {
    const pct = s.total ? ((s.have / s.total) * 100).toFixed(1) : "0.0";
    console.log(
      `${s.cat}/${s.locale}: ${s.have}/${s.total} nøgler (${pct} %), ${s.pending} kræver menneskelig korrektur`,
    );
  }
}
if (errors.length) {
  console.error(`i18n-kontrol fejlede (${errors.length}):`);
  for (const e of errors.slice(0, 200)) console.error(`  ${e}`);
  if (errors.length > 200) console.error(`  … og ${errors.length - 200} til`);
  process.exit(1);
}
console.log(
  only.length
    ? `i18n-kontrol bestået for ${only.join(", ")}.`
    : "i18n-kontrol bestået: da og en er fuldstændige; øvrige sprog har kendte nøgler, pladsholdere og flertalsformer.",
);
