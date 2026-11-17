#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// Genererer src/i18n/messages/load.ts (asynkron, hele kataloget) og static.ts (synkron, de små
// navneområder til mails, PDF, delte hjælpere og zod-beskeder; ét modul pr. navneområde i
// src/i18n/catalogs/) ud fra mapperne
// <sprog>/<navneområde>.json, så bundleren ser faste import-stier. Kun filer, der findes, importeres:
// et beta-sprog må mangle navneområder (fald-tilbage til engelsk, se src/i18n/fallback.ts).
// Kør `npm run i18n:build` efter at du har tilføjet eller omdøbt en fil. `--check` fejler, hvis
// de genererede filer er forældede.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const cfg = JSON.parse(
  readFileSync(join(root, "scripts/i18n/catalogs.json"), "utf8"),
);
const web = cfg.catalogs.find((c) => c.name === "web");
const dir = join(root, web.dir);

const filesOf = (locale) =>
  existsSync(join(dir, locale))
    ? new Set(
        readdirSync(join(dir, locale))
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.slice(0, -5)),
      )
    : new Set();

const have = Object.fromEntries(cfg.locales.map((l) => [l, filesOf(l)]));
const namespaces = [...have[cfg.base]].sort();
const ident = (s) => s.replace(/[^A-Za-z0-9]/g, "_");

const HEADER =
  "// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.\n";

// --- load.ts: asynkront, hele kataloget pr. sprog ---------------------------------------------
let load = HEADER;
load += 'import type { Locale } from "../config";\n';
load += 'import { withFallback } from "../fallback";\n\n';
load += "type Messages = Record<string, unknown>;\n\n";
load += "const rawLoaders: Record<Locale, () => Promise<Messages>> = {\n";
for (const l of cfg.locales) {
  load += `  ${JSON.stringify(l)}: async () => ({\n`;
  for (const ns of namespaces.filter((n) => have[l].has(n))) {
    load += `    ${JSON.stringify(ns)}: (await import("./${l}/${ns}.json")).default,\n`;
  }
  load += "  }),\n";
}
load += "};\n\n";
load += `const cache = new Map<Locale, Promise<Messages>>();

/** Hele kataloget for et sprog, lagt oven på engelsk (manglende nøgler og navneområder læses på engelsk). */
export function loadMessages(locale: Locale): Promise<Messages> {
  let hit = cache.get(locale);
  if (!hit) {
    hit = Promise.all([rawLoaders[locale](), rawLoaders.en()]).then(
      ([own, en]) => withFallback(locale, own, en),
    );
    cache.set(locale, hit);
  }
  return hit;
}
`;

// --- ../catalogs/<navneområde>.ts: ét statisk navneområde, alle sprog ----------------------------
// Hver fil for sig, så en hjælper i browseren (syncT, sharedT) kun får sine egne navneområder med
// i klientbundtet og ikke alle sprog af mails og notifikationer (static.ts samler dem til serveren).
// Ved siden af messages/, ikke i den: værktøjerne læser hver mappe i messages/ som et sprog.
const catDir = join(dir, "..", "catalogs");
const msgRel = `../${basename(dir)}`;
const used = [];
const catalogFiles = [];
for (const ns of cfg.staticNamespaces) {
  let cat = HEADER;
  const locales = cfg.locales.filter((l) => have[l].has(ns));
  for (const l of locales) {
    used.push([l, ns]);
    cat += `import ${ident(l)} from "${msgRel}/${l}/${ns}.json";\n`;
  }
  cat += '\nimport type { Locale } from "../config";\n\n';
  cat +=
    "const catalogs: Partial<Record<Locale, Record<string, unknown>>> = {\n";
  for (const l of locales) cat += `  ${JSON.stringify(l)}: ${ident(l)},\n`;
  cat += "};\n\nexport default catalogs;\n";
  catalogFiles.push([join(catDir, `${ns}.ts`), cat]);
}

// --- static.ts: synkront, kun de små navneområder -------------------------------------------------
let stat = HEADER;
for (const ns of cfg.staticNamespaces)
  stat += `import ${ident(ns)} from "../catalogs/${ns}";\n`;
stat += '\nimport type { Locale } from "../config";\n\n';
stat += `export const STATIC_NAMESPACES = ${JSON.stringify(cfg.staticNamespaces)} as const;\n`;
stat += "export type StaticNamespace = (typeof STATIC_NAMESPACES)[number];\n\n";
stat += "type Catalogs = Partial<Record<Locale, Record<string, unknown>>>;\n\n";
stat += "export const STATIC_RAW: Record<StaticNamespace, Catalogs> = {\n";
for (const ns of cfg.staticNamespaces)
  stat += `  ${JSON.stringify(ns)}: ${ident(ns)},\n`;
stat += "};\n";

const targets = [
  [join(dir, "load.ts"), load],
  [join(dir, "static.ts"), stat],
  ...catalogFiles,
];
if (process.argv.includes("--check")) {
  for (const [file, text] of targets) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
      console.error(
        `${file.slice(root.length + 1)} er forældet: kør \`npm run i18n:build\`.`,
      );
      process.exit(1);
    }
  }
} else {
  mkdirSync(catDir, { recursive: true });
  for (const [file, text] of targets) writeFileSync(file, text);
  console.log(
    `Skrev load.ts og static.ts: ${namespaces.length} navneområder, ${used.length} statiske filer.`,
  );
}
