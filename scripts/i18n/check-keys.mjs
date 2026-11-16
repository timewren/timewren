#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// Statisk kontrol: hver nøgle, som koden slår op med t("…"), findes i dansk. Dynamiske nøgler
// (skabelonstrenge, variabler) kan ikke ses og springes over. Fejler (exit 1) ved manglende nøgler.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const catalog = {};
const base = join(root, "src/i18n/messages/da");
for (const f of readdirSync(base).filter((n) => n.endsWith(".json"))) {
  catalog[f.slice(0, -5)] = JSON.parse(readFileSync(join(base, f), "utf8"));
}

function has(path) {
  const parts = path.split(".");
  let cur = catalog;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return false;
  }
  return true;
}

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "node_modules" || f === ".next") continue;
      yield* walk(p);
    } else if (/\.(tsx?|mjs)$/.test(f) && !/\.test\./.test(f)) yield p;
  }
}

const DECL =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations|getT|mailT)\(\s*["']([\w.]+)["']/g;
const missing = [];
let checked = 0;
for (const file of walk(join(root, "src"))) {
  const src = readFileSync(file, "utf8");
  // En variabel som `t` kan erklæres flere gange i samme fil (én pr. komponent): brug nærmeste erklæring før opslaget.
  const decls = [...src.matchAll(DECL)].map((m) => ({
    v: m[1],
    ns: m[2],
    at: m.index,
  }));
  const vars = [...new Set(decls.map((d) => d.v))];
  for (const v of vars) {
    const use = new RegExp(
      `\\b${v}(?:\\.rich|\\.raw|\\.markup|\\.has)?\\(\\s*["']([\\w.]+)["']`,
      "g",
    );
    for (const u of src.matchAll(use)) {
      const d = decls.filter((x) => x.v === v && x.at < u.index).at(-1);
      if (!d) continue;
      checked++;
      if (!has(`${d.ns}.${u[1]}`))
        missing.push(`${relative(root, file)}: ${d.ns}.${u[1]}`);
    }
  }
}
if (missing.length) {
  console.error(`i18n-nøglekontrol: ${missing.length} nøgler mangler i dansk:`);
  for (const x of [...new Set(missing)].slice(0, 300)) console.error(`  ${x}`);
  process.exit(1);
}
console.log(`i18n-nøglekontrol bestået: ${checked} opslag fundet i kataloget.`);
