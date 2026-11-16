#!/usr/bin/env node
/**
 * Codemod: Tailwind blue-* → brand-* (granskov) i src/ (issue #825, fase 3.1).
 *
 *   node scripts/brand/codemod-blue.mjs            # dry-run: hvad ville ændres
 *   node scripts/brand/codemod-blue.mjs --write    # skriv ændringerne
 *   node scripts/brand/codemod-blue.mjs --review   # list linjer, der beholdes som data
 *   node scripts/brand/codemod-blue.mjs --count    # grep-rapport: blå tilbage (minus undtagelser)
 *   node scripts/brand/codemod-blue.mjs --dark [--write]
 *                                                  # dark mode-pas (BRAND.md → Dark mode)
 *
 * Trin 1 (blå → brand): `blue-N` → `brand-N` med samme trin for alle utilities
 * (bg, text, border(-x), ring(-offset), outline, divide, from/via/to, fill,
 * stroke, placeholder, accent, caret, decoration, shadow) og alle varianter
 * (hover:, dark:, focus:, md:, group-hover: …). `blue-950` → `brand-900`, fordi
 * brand-skalaen slutter ved 900. `--color-blue-N` → `--color-brand-N`.
 *
 * Trin 2 (--dark): granskov i dark mode er #5FB38F med mørk tekst på fyldte
 * flader. brand-600 på #0A0A0A giver kun 2,5:1, så:
 *   - fyldt flade `bg-brand-500/600/700` + `text-white` → `bg-tt-gran
 *     text-tt-paa-gran` (+ `hover:bg-tt-gran-moerk`); dark:bg-/dark:text-white
 *     -overrides på samme element fjernes, fordi tokens selv skifter.
 *   - `text-brand-500..900` uden dark:text- → + `dark:text-brand-400`.
 *   - `dark:text-brand-500..900` → `dark:text-brand-400` (500 giver 4,2:1).
 *   - `border-/ring-brand-600..900` uden dark-variant → + `dark:…-brand-400`.
 *   - `bg-brand-600/700` (prik, bjælke) uden dark:bg- → + `dark:bg-brand-400`.
 * Kun i filer, der i forvejen har dark:-varianter. Filer uden (marketing) er
 * altid lyse og får ingen dark-klasser.
 *
 * Hex-blå (#3b82f6/#2563eb/#1d4ed8/#60a5fa) er næsten altid data (farvevælgere,
 * DB-defaults, paletter) og rettes ikke automatisk. De få UI-steder er rettet i
 * hånden til BRAND_LIGHT.gran (src/lib/brand/tokens.ts) og er listet i PR'en.
 * --count tæller hex uden for HEX_DATA, og tallet skal være 0.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const argv = new Set(process.argv.slice(2));
const WRITE = argv.has("--write");

// ---------------------------------------------------------------------------
// Undtagelser
// ---------------------------------------------------------------------------

/** Filer og mapper, som andre streams ejer (mail, PDF, OG). Røres ikke. */
const EXCLUDE = [
  [/^src\/components\/email\//, "mail (fase 4)"],
  [/^src\/lib\/email\//, "mail (fase 4)"],
  [/^src\/lib\/notifications\/email\.ts$/, "hånd-HTML-mail (fase 4)"],
  [/^src\/app\/api\/cron\/end-of-day\/route\.ts$/, "hånd-HTML-mail (fase 4)"],
  [/^src\/app\/api\/desktop\/admin\/launch-email\//, "hånd-HTML-mail (fase 4)"],
  [/^src\/app\/api\/unsubscribe\//, "hånd-HTML-mail (fase 4)"],
  [/^src\/app\/api\/webhooks\/resend\//, "HTML i videresendt mail (fase 4)"],
  [/^src\/components\/pdf\//, "PDF (fase 5)"],
  [/^src\/lib\/pdf/, "PDF (fase 5): pdf/, pdf-themes/, pdf-primitives.tsx"],
  [/^src\/lib\/invoice-pdf\.tsx$/, "PDF (fase 5)"],
  [/^src\/lib\/enterprise\/reporting\/pdf\.tsx$/, "PDF (fase 5)"],
  [/^src\/types\/pdf-themes\.ts$/, "PDF (fase 5)"],
  [/^src\/lib\/reports\//, "rapporter/PDF (fase 5)"],
  [/^src\/app\/api\/v1\/reports\//, "rapport-PDF via API (fase 5)"],
  [/^src\/app\/api\/cron\/report-schedules\//, "rapport-PDF (fase 5)"],
  [/^src\/app\/opengraph-image\.tsx$/, "OG-billede (fase 2)"],
  [/^src\/app\/api\/og\//, "OG-billede (fase 2)"],
];

/**
 * Linjer, hvor blå er data og beholdes: codemod-blue-undtagelser.json med
 * { fil, linje (præcis, trimmet), grund }. Statuskort med én farve pr. tilstand
 * (sendt/betalt/forfalden …) beholder blå, så "sendt" ikke ligner "betalt"
 * (grøn); det samme gælder grafpaletter, statusfarven "info" og paletter, der
 * er nøglet på farvenavnet "blue". Listen er håndgennemgået; ret den der.
 */
const KEEP = JSON.parse(
  readFileSync(
    new URL("./codemod-blue-undtagelser.json", import.meta.url),
    "utf8",
  ),
);
const KEEP_MAP = new Map(KEEP.map((k) => [`${k.fil}\n${k.linje}`, k.grund]));

/** Hex-blå, der er data (farvevælgere, DB-defaults, paletter, tests). */
const HEX_DATA = [
  ["src/app/admin/settings/page.tsx", "farvevælger, startværdi"],
  ["src/app/api/cron/import/route.ts", "palet til importerede projekter"],
  [
    "src/app/dashboard/calendar/components/time-block.tsx",
    "kommentar om kundefarve",
  ],
  ["src/app/dashboard/clients/new/page.tsx", "kundefarve: vælger og palet"],
  [
    "src/app/dashboard/clients/[id]/edit/page.tsx",
    "kundefarve: vælger og palet",
  ],
  ["src/app/dashboard/enterprise/settings/page.tsx", "teamfarve (data)"],
  [
    "src/app/dashboard/settings/email-templates/[id]/page.tsx",
    "brugerens blokfarve i mailskabelon",
  ],
  ["src/app/dashboard/settings/tags/page.tsx", "tag-palet"],
  ["src/components/tags/TagPicker.tsx", "tag-palet"],
  ["src/components/tasks/AddLaneModal.tsx", "kolonne-palet"],
  ["src/components/tasks/LaneHeader.tsx", "kolonne-palet"],
  ["src/components/timer/CreateTemplateModal.tsx", "skabelon-palet"],
  [
    "src/components/timer/QuickActionsDropdown.tsx",
    "fallback for skabelonens egen farve",
  ],
  ["src/components/ui/TaskSelect.tsx", "statusprik for Todo"],
  ["src/components/dashboard/WidgetCatalog.tsx", "kategori-palet"],
  ["src/components/dashboard/ActionBar.tsx", "handlingstype-farve (kategori)"],
  ["src/lib/db/schema.ts", "DB-defaults (ingen migration)"],
  ["src/lib/demo/seed-demo-data.ts", "demo-data"],
  ["src/lib/enterprise/absence-defaults.ts", "fraværstype-palet"],
  ["src/lib/enterprise/activity-types.ts", "aktivitetstype-palet"],
  ["src/lib/enterprise/__tests__/absence-registration.test.ts", "test-fixture"],
  ["src/lib/enterprise/__tests__/activity-types.test.ts", "test-fixture"],
  ["src/lib/integrations/notifications.ts", "kanal-farve"],
  ["src/lib/kanban/default-lanes.ts", "kolonne-default"],
  ["src/lib/trpc/routers/admin/support.ts", "default for tag-farve (data)"],
  [
    "src/lib/trpc/routers/enterprise/absence.ts",
    "default for fraværstype (data)",
  ],
  [
    "src/lib/trpc/routers/timerTemplates.ts",
    "default for skabelonfarve (data)",
  ],
];

// ---------------------------------------------------------------------------
// Mønstre
// ---------------------------------------------------------------------------

const UTIL =
  "bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|from|via|to|fill|stroke|placeholder|accent|caret|decoration|shadow|inset-shadow|inset-ring|drop-shadow";
const STEPS = "50|100|200|300|400|500|600|700|800|900|950";
const BLUE_RE = new RegExp(
  `(?<![\\w-])(${UTIL})-blue-(${STEPS})(?![\\w-])`,
  "g",
);
const BLUE_VAR_RE = /--color-blue-(50|[1-9]00|950)\b/g;
const HEX_RE = /#(3b82f6|2563eb|1d4ed8|60a5fa)\b/gi;

const step = (s) => (s === "950" ? "900" : s);

// ---------------------------------------------------------------------------
// Filer
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split("\\").join("/");
const excluded = (f) => EXCLUDE.find(([re]) => re.test(f));
const files = walk(join(ROOT, "src")).map((p) => [p, rel(p)]);

function keepReason(file, lines, i) {
  return KEEP_MAP.get(`${file}\n${lines[i].replace(/\r$/, "").trim()}`) ?? null;
}

// ---------------------------------------------------------------------------
// Trin 1: blå → brand
// ---------------------------------------------------------------------------

function runBlue(mode) {
  const kept = [];
  let changedFiles = 0;
  let changedTokens = 0;
  for (const [abs, file] of files) {
    if (excluded(file) || !file.match(/\.(tsx?|css)$/)) continue;
    const src = readFileSync(abs, "utf8");
    if (!/blue-/.test(src)) continue;
    const lines = src.split("\n");
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      if (!BLUE_RE.test(lines[i]) && !BLUE_VAR_RE.test(lines[i])) continue;
      BLUE_RE.lastIndex = 0;
      BLUE_VAR_RE.lastIndex = 0;
      const why = keepReason(file, lines, i);
      if (why) {
        kept.push(
          `${file}:${i + 1}  [${why}]  ${lines[i].trim().slice(0, 110)}`,
        );
        continue;
      }
      const next = lines[i]
        .replace(BLUE_RE, (_, u, s) => {
          changedTokens++;
          return `${u}-brand-${step(s)}`;
        })
        .replace(BLUE_VAR_RE, (_, s) => {
          changedTokens++;
          return `--color-brand-${step(s)}`;
        });
      if (next !== lines[i]) {
        lines[i] = next;
        touched = true;
      }
    }
    if (touched) {
      changedFiles++;
      if (mode === "write") writeFileSync(abs, lines.join("\n"));
    }
  }
  if (mode === "review") console.log(kept.join("\n"));
  console.log(
    `${mode === "write" ? "Skrev" : "Ville ændre"} ${changedTokens} klasser i ${changedFiles} filer; ${kept.length} linjer beholdt som data.`,
  );
}

// ---------------------------------------------------------------------------
// Trin 2: dark mode
// ---------------------------------------------------------------------------

// Klassestrenge findes pr. linje: linjen deles på " ' ` ${ og }, og hvert
// stykke med brand- behandles for sig. Så rammes også betingede klasser i
// template literals (`${active ? "bg-brand-600 text-white" : "…"}`).
const SPLIT_RE = /(["'`]|\$\{|\})/;

/**
 * @param s   ét stykke af en linje
 * @param ctx linjerne omkring (±3), bruges til at se om elementet allerede
 *            har en dark:-variant for samme egenskab
 * @param near linjerne omkring (±10), bruges til at se om der står hvid
 *             tekst eller et hvidt ikon på fladen
 */
function fixClassString(s, ctx, near = ctx) {
  if (!/brand-/.test(s)) return s;
  let t = ` ${s} `;
  const has = (re) => re.test(t);
  const ctxHas = (re) => re.test(ctx) || re.test(t);
  // Fyldt flade med hvid tekst → tokens, der selv skifter i dark mode
  // (#5FB38F med #0A0A0A-tekst; BRAND.md → Dark mode).
  if (has(/\sbg-brand-(500|600|700)\s/) && has(/\stext-white\s/)) {
    t = t
      .replace(/\sbg-brand-(500|600|700)\s/, " bg-tt-gran ")
      .replace(/\stext-white\s/, " text-tt-paa-gran ")
      .replace(
        /\shover:bg-brand-(500|600|700|800)\s/,
        " hover:bg-tt-gran-moerk ",
      )
      .replace(
        /\sactive:bg-brand-(600|700|800|900)\s/,
        " active:bg-tt-gran-moerk ",
      )
      .replace(/\sdark:(?:hover:|active:)?bg-brand-\d+(?:\/\d+)?(?=\s)/g, "")
      .replace(/\sdark:text-white(?=\s)/g, "");
  }
  // Mørke toninger (valgt tilstand, infobokse): brand-800/900 med opacitet
  // forsvinder næsten på #0A0A0A. Brug brand-lys i mørk (#18291F).
  t = t.replace(
    /(\sdark:(?:[\w-]+:)*)bg-brand-(?:800|900)(?:\/\d+)?(?=\s)/g,
    "$1bg-tt-gran-lys",
  );
  t = t.replace(
    /(\sdark:(?:[\w-]+:)*)border-brand-(?:800|900)(?:\/\d+)?(?=\s)/g,
    "$1border-brand-600",
  );
  // dark:text-brand-500..900 er for mørk på #0A0A0A (500 giver 4,2:1).
  t = t.replace(
    /(\sdark:(?:[\w-]+:)*)text-brand-(?:500|600|700|800|900)(?=[\s/])/g,
    "$1text-brand-400",
  );
  // Tekst uden dark-variant.
  if (
    has(
      /\s(?:hover:|group-hover:)?text-brand-(500|600|700|800|900)(?=[\s/])/,
    ) &&
    !ctxHas(/\sdark:(?:[\w-]+:)*text-/)
  ) {
    t = t.replace(
      /\s(text-brand-(?:500|600|700|800|900)(?:\/\d+)?)(?=\s)/,
      " $1 dark:text-brand-400",
    );
    if (has(/\shover:text-brand-\d+\s/)) {
      t = t.replace(
        /\s(hover:text-brand-\d+)(?=\s)/,
        " $1 dark:hover:text-brand-300",
      );
    }
  }
  // Kanter og ringe (3:1 for ikke-tekst).
  for (const u of ["border", "ring"]) {
    const re = new RegExp(`\\s(${u}-brand-(?:600|700|800|900))(?=\\s)`);
    if (has(re) && !ctxHas(new RegExp(`\\sdark:(?:[\\w-]+:)*${u}-`))) {
      t = t.replace(re, ` $1 dark:${u}-brand-400`);
    }
  }
  // Fyldte prikker og bjælker uden tekst. Står der hvid tekst eller et
  // hvidt ikon i nærheden, beholdes brand-600 (hvid på #5FB38F er 2,5:1).
  if (
    has(/\sbg-brand-(600|700)\s/) &&
    !ctxHas(/\sdark:(?:[\w-]+:)*bg-/) &&
    !/[\s"'`]text-white[\s"'`]/.test(near)
  ) {
    t = t.replace(/\s(bg-brand-(?:600|700))(?=\s)/, " $1 dark:bg-brand-400");
  }
  return t.slice(1, -1);
}

function runDark(mode) {
  let changedFiles = 0;
  const log = [];
  for (const [abs, file] of files) {
    if (excluded(file) || (!file.endsWith(".tsx") && !file.endsWith(".ts")))
      continue;
    const src = readFileSync(abs, "utf8");
    if (!/brand-/.test(src) || !/dark:/.test(src)) continue;
    const lines = src.split("\n");
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("brand-")) continue;
      // Står hele className-attributten på linjen, er linjen konteksten;
      // ellers (cn(...) over flere linjer) kigges ±3 linjer.
      const whole = /className=(["'])[^"']*\1/.test(lines[i]);
      const ctx = whole
        ? ` ${lines[i]} `
        : ` ${lines.slice(Math.max(0, i - 3), i + 4).join(" ")} `;
      const near = ` ${lines.slice(Math.max(0, i - 10), i + 11).join(" ")} `;
      const parts = lines[i].split(SPLIT_RE);
      for (let k = 0; k < parts.length; k += 2)
        parts[k] = fixClassString(parts[k], ctx, near);
      const next = parts.join("");
      if (next !== lines[i]) {
        lines[i] = next;
        touched = true;
      }
    }
    if (touched) {
      changedFiles++;
      log.push(file);
      if (mode === "write") writeFileSync(abs, lines.join("\n"));
    }
  }
  console.log(log.join("\n"));
  console.log(
    `${mode === "write" ? "Skrev" : "Ville ændre"} dark-pas i ${changedFiles} filer.`,
  );
}

// ---------------------------------------------------------------------------
// Trin 3: grep-rapport
// ---------------------------------------------------------------------------

function runCount() {
  let blueAll = 0;
  let blueLeft = 0;
  let hexAll = 0;
  let hexLeft = 0;
  const left = [];
  for (const [abs, file] of files) {
    if (excluded(file)) continue;
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, i) => {
      const b = (line.match(BLUE_RE) || []).length;
      if (b) {
        blueAll += b;
        if (!keepReason(file, lines, i)) {
          blueLeft += b;
          left.push(`${file}:${i + 1}  ${line.trim().slice(0, 110)}`);
        }
      }
      const h = (line.match(HEX_RE) || []).length;
      if (h) {
        hexAll += h;
        if (!HEX_DATA.some(([f]) => f === file)) {
          hexLeft += h;
          left.push(`${file}:${i + 1}  ${line.trim().slice(0, 110)}`);
        }
      }
    });
  }
  if (left.length) console.log(left.join("\n"));
  console.log(
    `blue-* i src (uden ejede mapper): ${blueAll}; uden for undtagelser: ${blueLeft}`,
  );
  console.log(
    `hex-blå i src (uden ejede mapper): ${hexAll}; uden for HEX_DATA: ${hexLeft}`,
  );
}

if (argv.has("--count")) runCount();
else if (argv.has("--dark")) runDark(WRITE ? "write" : "dry");
else runBlue(argv.has("--review") ? "review" : WRITE ? "write" : "dry");
