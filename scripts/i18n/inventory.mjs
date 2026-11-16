#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// Tæller filer med hardcodet dansk brugertekst pr. område og viser, hvor mange der
// allerede bruger next-intl. Heuristik: æøå eller almindelige danske ord i tekst.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const DANISH =
  /[æøåÆØÅ]|\b(og|ikke|til|der|det|er|for|som|med|din|dit|dine|vælg|opret|gem|slet|fejl)\b/;
const skip =
  /(\.test\.|\.spec\.|node_modules|\/\.next\/|\.d\.ts$|\/db\/schema|\/drizzle\/)/;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (f === "node_modules" || f === ".next") continue;
      walk(p, out);
    } else if (/\.(tsx?|mjs)$/.test(f) && !skip.test(p)) out.push(p);
  }
  return out;
}

function hasUiText(src) {
  // Tekst mellem JSX-tags eller i strenge med mindst to ord og dansk præg.
  const jsx = src.match(/>\s*[^<>{}\n]*[A-Za-zæøåÆØÅ]{3,}[^<>{}\n]*</g) ?? [];
  const str = src.match(/["'`][^"'`\n]{8,}["'`]/g) ?? [];
  return [...jsx, ...str].filter(
    (t) => DANISH.test(t) && /\s/.test(t.trim().slice(1, -1)),
  ).length;
}

const areas = {};
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ["src"];
for (const d of dirs) {
  for (const file of walk(join(root, d))) {
    const rel = relative(root, file);
    const parts = rel.split("/");
    const area =
      parts[0] === "src"
        ? parts
            .slice(
              0,
              parts[1] === "app" && parts[2] === "dashboard"
                ? 4
                : parts[1] === "app"
                  ? 3
                  : 3,
            )
            .join("/")
        : parts.slice(0, 2).join("/");
    const src = readFileSync(file, "utf8");
    areas[area] ??= { files: 0, danish: 0, strings: 0, intl: 0 };
    const a = areas[area];
    a.files++;
    const n = hasUiText(src);
    if (n) {
      a.danish++;
      a.strings += n;
    }
    if (/useTranslations|getTranslations/.test(src)) a.intl++;
  }
}
const rows = Object.entries(areas)
  .filter(([, a]) => a.danish)
  .sort((x, y) => y[1].strings - x[1].strings);
console.log(
  "område | filer med dansk tekst | tekststrenge (grov) | bruger next-intl",
);
let tf = 0,
  ts = 0;
for (const [k, a] of rows) {
  console.log(`${k} | ${a.danish}/${a.files} | ${a.strings} | ${a.intl}`);
  tf += a.danish;
  ts += a.strings;
}
console.log(`I ALT | ${tf} | ${ts}`);
