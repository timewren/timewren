#!/usr/bin/env node
/**
 * Tekst-lint for brugertekst (issue #825, fase 9). Håndhæver docs/BRAND.md §3
 * og "Tal, priser og tid", så tankestreger, forbudte ord, "klient", "CRM" og
 * "kr/md" ikke sniger sig tilbage.
 *
 *   node scripts/brand/lint-copy.mjs            # fejler (exit 1) ved fund
 *   node scripts/brand/lint-copy.mjs --stats    # tal pr. regel og område
 *   node scripts/brand/lint-copy.mjs --json     # fund som JSON
 *   node scripts/brand/lint-copy.mjs --alle     # se bort fra undtagelser
 *   node scripts/brand/lint-copy.mjs fil.tsx …  # kun de nævnte filer
 *
 * Scriptet parser .ts/.tsx med oxc-parser og ser kun på tekst, der
 * kan nå en bruger: strengliteraler, template-tekst, JSX-tekst og
 * JSX-attributter. Kommentarer, identifiers, import-stier, typer,
 * objektnøgler, className/href/src m.fl. og console/logger-kald ignoreres.
 * "klient" og "CRM" tjekkes kun i strenge, der ligner tekst (ikke enum-værdier
 * og stier som "klient" eller "/klient-timer-oversigt").
 *
 * Undtagelser står i scripts/brand/lint-copy-undtagelser.json med en grund pr.
 * post: { fil, regel, tekst, grund }. "tekst" er en delstreng af den fundne
 * tekst. En undtagelse, der ikke længere rammer noget, er også en fejl, så
 * listen ikke gror.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";

const HER = dirname(fileURLToPath(import.meta.url));
export const ROD = resolve(HER, "..", "..");
export const UNDTAGELSER_STI = join(HER, "lint-copy-undtagelser.json");

/**
 * Mapper og filer med brugertekst. src/lib/email er mailtekst, da.json er
 * next-intl-beskederne. Driftssider (admin) er med i scanningen og undtaget
 * med en mappe-undtagelse i undtagelsesfilen, så undtagelsen står ét sted.
 */
export const ROOTS = [
  "src/app",
  "src/components",
  "src/lib/marketing",
  "src/lib/email",
  "src/i18n/messages/da",
  "browser-extension/src",
];

const L = "\\p{L}"; // bogstav inkl. æøå, så ordgrænser virker på dansk
const ord = (kerne) => new RegExp(`(?<!${L})(?:${kerne})(?!${L})`, "giu");

const ENTITETER = {
  mdash: "—",
  ndash: "–",
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  aelig: "æ",
  oslash: "ø",
  aring: "å",
  AElig: "Æ",
  Oslash: "Ø",
  Aring: "Å",
  eacute: "é",
};

/** JSX-tekst og JSX-attributter kommer rå fra kilden: afkod HTML-entiteter. */
export function afkodEntiteter(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (hel, navn) => {
    if (navn[0] === "#") {
      const kode =
        navn[1] === "x" || navn[1] === "X"
          ? Number.parseInt(navn.slice(2), 16)
          : Number.parseInt(navn.slice(1), 10);
      return Number.isFinite(kode) ? String.fromCodePoint(kode) : hel;
    }
    return ENTITETER[navn] ?? hel;
  });
}

const antalMatch = (mønster, s) => {
  mønster.lastIndex = 0;
  return [...s.matchAll(mønster)].length;
};

export const REGLER = {
  // Lang tankestreg (U+2014) overalt, og kort tankestreg (U+2013) med
  // mellemrum på begge sider, som er den danske tankestreg. Intervaller som
  // "149–199" uden mellemrum er tilladt.
  tankestreg: {
    beskrivelse:
      "Tankestreg (— eller ' – ') i brugertekst. Brug punktum, komma eller kolon.",
    mønster: /—|(?<=\s)–(?=\s)/gu,
    kunTekst: false,
  },
  "forbudt-ord": {
    beskrivelse: "Forbudt ord fra BRAND.md §3.",
    mønster: ord(
      [
        "revolution[eé]r(?:er|ende|et|e)?",
        "oplev",
        "opdag",
        "fremtidens",
        "kraftful(?:d|de|dt)",
        "intuitiv(?:e|t)?",
        "problemfri(?:t|e)?",
        "ubesvær(?:et|ede)",
        "i\\s+verdensklasse",
        "i\\s+en\\s+travl\\s+hverdag",
        "magien",
        "game[- ]?changer(?:e|s)?",
        "AI-drev(?:et|ne)",
        "lad\\s+AI\\s+gøre\\s+arbejdet",
      ].join("|"),
    ),
    kunTekst: false,
  },
  klient: {
    beskrivelse: 'Skriv "kunde", ikke "klient", i brugertekst.',
    mønster: /klient/giu,
    kunTekst: true,
  },
  crm: {
    beskrivelse: 'TimeTrack er ikke et CRM. Fjern "CRM" fra brugerteksten.',
    mønster: /(?<![\p{L}\d])CRM(?![\p{L}\d])/gu,
    kunTekst: true,
  },
  "kr-md": {
    beskrivelse:
      'Skriv "79 kr./md." og "49 kr. pr. bruger/md.", ikke "kr/md" eller "kr/bruger".',
    mønster: /(?<!\p{L})kr\s?\/\s?(?:md|mdr|måned|år|bruger)(?!\p{L})/giu,
    kunTekst: false,
  },
};

// JSX-attributter, der aldrig er brugertekst.
const KODE_ATTRIBUTTER = new Set([
  "className",
  "class",
  "href",
  "src",
  "id",
  "key",
  "type",
  "name",
  "htmlFor",
  "rel",
  "target",
  "method",
  "action",
  "role",
  "variant",
  "size",
  "as",
  "lang",
  "dir",
  "autoComplete",
  "inputMode",
  "pattern",
  "accept",
  "form",
  "style",
  "fill",
  "stroke",
  "d",
  "viewBox",
  "xmlns",
  "path",
  "icon",
  "color",
  "side",
  "align",
  "testId",
  "data-testid",
]);

// Kald hvis strengargumenter er til udviklere, ikke brugere.
const KODE_KALD =
  /^(console|logger|log|Sentry|captureException|captureMessage|debug|require|import|cn|clsx|twMerge|cva|eq|ne|sql|like|ilike|querySelector|querySelectorAll|getElementById|addEventListener|removeEventListener|setAttribute|getAttribute|startsWith|endsWith|includes|split|replace|replaceAll|match|test|get|has|delete|getItem|setItem|removeItem|fetch|redirect|router\.push|router\.replace)$/;

/** En streng, der ligner kode (enum, sti, nøgle), ikke tekst til en person. */
export function ligner_kode(s) {
  const t = s.trim();
  if (t === "") return true;
  if (/\s/.test(t)) return false;
  // Ét ord med stort begyndelsesbogstav, evt. med bindestreger, er en label
  // ("Klient", "CRM", "Klient-portal"). Et ord, der slutter på "…" eller
  // "...", er en placeholder ("klientnavn…"). Alt andet (klient, client-id,
  // /sti, a.b) er kode.
  if (/^\p{Lu}\p{L}*(?:-\p{L}+)*(?:[.:!?]|…|\.\.\.)?$/u.test(t)) return false;
  if (/^\p{L}+(?:-\p{L}+)*(?:…|\.\.\.)$/u.test(t)) return false;
  return true;
}

function kaldNavn(expr) {
  if (expr.type === "Identifier") return expr.name;
  if (expr.type === "MemberExpression" && !expr.computed) {
    const venstre = kaldNavn(expr.object);
    if (venstre === "console" || venstre === "logger" || venstre === "Sentry")
      return venstre;
    if (venstre === "router") return `router.${expr.property.name}`;
    return expr.property.name;
  }
  return "";
}

// TypeScript-typer i ESTree-træet (TSTypeReference, TSLiteralType,
// TSStringKeyword …). Svarer til ts.isTypeNode.
const TYPE_NODE =
  /^TS(?:\w*Type|\w*Keyword|TypeLiteral|TypeAnnotation|TypeReference|TypeQuery|TypeOperator|TypePredicate|NamedTupleMember|InterfaceHeritage|ClassImplements)$/;

function jsxNavn(navn) {
  return navn.type === "JSXNamespacedName"
    ? `${navn.namespace.name}:${navn.name.name}`
    : navn.name;
}

/** Er noden et sted, hvor en streng ikke er brugertekst? */
function erKodeKontekst(node) {
  let barn = node;
  let p = node.parent;
  while (p) {
    if (
      p.type === "ImportDeclaration" ||
      p.type === "ExportAllDeclaration" ||
      // export { … } (from "…"), ikke export const …
      (p.type === "ExportNamedDeclaration" && !p.declaration) ||
      p.type === "TSExternalModuleReference" ||
      p.type === "TSEnumMember" ||
      TYPE_NODE.test(p.type)
    )
      return true;
    if (
      p.type === "Property" &&
      p.parent?.type === "ObjectExpression" &&
      p.kind === "init" &&
      !p.method &&
      p.key === barn
    )
      return true;
    if (p.type === "MemberExpression" && p.computed && p.property === barn)
      return true;
    if (p.type === "JSXAttribute") {
      const navn = jsxNavn(p.name);
      return KODE_ATTRIBUTTER.has(navn) || navn.startsWith("data-");
    }
    if (p.type === "CallExpression" || p.type === "NewExpression") {
      if (p.callee !== barn && KODE_KALD.test(kaldNavn(p.callee))) return true;
      // Første kald-grænse afgør det: tekst i fx t("…") eller toast("…") er
      // brugertekst.
      return false;
    }
    // import("…") er et kald uden navn.
    if (p.type === "ImportExpression") return false;
    if (
      p.type === "BinaryExpression" &&
      ["===", "!==", "==", "!="].includes(p.operator)
    )
      return true;
    if (p.type === "SwitchCase" && p.test === barn) return true;
    if (
      p.type === "BlockStatement" ||
      p.type === "Program" ||
      p.type === "JSXElement" ||
      p.type === "JSXFragment"
    )
      return false;
    barn = p;
    p = p.parent;
  }
  return false;
}

/** Linjestarter som i TypeScript: \r\n, \r, \n, U+2028 og U+2029. */
function linjeStarter(kilde) {
  const starter = [0];
  for (let i = 0; i < kilde.length; i++) {
    const c = kilde[i];
    if (c === "\r" && kilde[i + 1] === "\n") i++;
    if (c === "\r" || c === "\n" || c === " " || c === " ") starter.push(i + 1);
  }
  return starter;
}

function position(starter, offset) {
  let lav = 0;
  let høj = starter.length - 1;
  while (lav < høj) {
    const midt = (lav + høj + 1) >> 1;
    if (starter[midt] <= offset) lav = midt;
    else høj = midt - 1;
  }
  return { line: lav, character: offset - starter[lav] };
}

/** Børn i kildeorden, med parent sat (oxc-parser giver ingen parent). */
function børn(node) {
  const ud = [];
  for (const [nøgle, værdi] of Object.entries(node)) {
    if (nøgle === "parent") continue;
    for (const v of Array.isArray(værdi) ? værdi : [værdi]) {
      if (v && typeof v === "object" && typeof v.type === "string") {
        v.parent = node;
        ud.push(v);
      }
    }
  }
  return ud.sort((a, b) => a.start - b.start);
}

/**
 * Saml tekst fra én kildefil. Hver post er ét tekststykke (en streng, en
 * template eller en JSX-tekst) med hele teksten og teksten delt pr. kildelinje,
 * så fund får det rigtige linjenummer: [{ hel, linjer: [{ tekst, linje, kol }] }]
 */
export function indsamlTekst(kilde, filnavn = "fil.tsx") {
  if (filnavn.endsWith(".json")) return indsamlJson(kilde);
  // oxc-parser giver UTF-16-offsets som JavaScript-strenge.
  const { program } = parseSync(filnavn, kilde, {
    lang: filnavn.endsWith(".tsx") ? "tsx" : "ts",
    preserveParens: true,
  });
  const starter = linjeStarter(kilde);
  const ud = [];
  // dele: [{ tekst, start }], hvor start er kildepositionen for tekstens
  // første tegn. Teksten deles ved linjeskift og får hver sin linje.
  const læg = (dele) => {
    const linjer = [];
    for (const { tekst, start } of dele) {
      const pos = position(starter, start);
      tekst.split("\n").forEach((stump, i) => {
        if (stump.trim())
          linjer.push({
            tekst: stump.trim(),
            linje: pos.line + 1 + i,
            kol: i === 0 ? pos.character + 1 : 1,
          });
      });
    }
    const hel = dele
      .map((d) => d.tekst)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bogstavelig pladsholder i det udtrukne tekstmønster, ikke en template
      .join("${…}")
      .replace(/\s+/g, " ")
      .trim();
    if (hel) ud.push({ hel, linjer });
  };
  // Template-elementernes span starter ved ` eller }, så teksten starter et
  // tegn senere.
  const skabelon = (q) => ({ tekst: q.value.cooked ?? "", start: q.start + 1 });
  const besøg = (node) => {
    const under = børn(node);
    if (node.type === "JSXText") {
      læg([{ tekst: afkodEntiteter(node.value), start: node.start }]);
    } else if (node.type === "Literal" && typeof node.value === "string") {
      if (!erKodeKontekst(node)) {
        // JSX-attributter er rå kildetekst, så entiteter afkodes dér.
        const tekst =
          node.parent.type === "JSXAttribute"
            ? afkodEntiteter(node.value)
            : node.value;
        læg([{ tekst, start: node.start + 1 }]);
      }
    } else if (node.type === "TemplateLiteral") {
      if (!erKodeKontekst(node)) læg(node.quasis.map(skabelon));
    }
    for (const b of under) besøg(b);
  };
  besøg(program);
  return ud;
}

/** Strengværdier i en JSON-fil (fx next-intl-beskeder). */
function indsamlJson(kilde) {
  const ud = [];
  kilde.split("\n").forEach((linje, i) => {
    const m = linje.match(/^\s*"[^"]*"\s*:\s*"(.*)",?\s*$/);
    if (m) {
      const tekst = JSON.parse(`"${m[1]}"`);
      ud.push({ hel: tekst, linjer: [{ tekst, linje: i + 1, kol: 1 }] });
    }
  });
  return ud;
}

/** Fund i én kildefil: [{ regel, linje, kol, tekst, antal }] */
export function scanKilde(kilde, filnavn = "fil.tsx") {
  const fund = [];
  for (const stykke of indsamlTekst(kilde, filnavn)) {
    const kodeagtig = ligner_kode(stykke.hel);
    for (const [regel, def] of Object.entries(REGLER)) {
      if (def.kunTekst && kodeagtig) continue;
      let fundet = 0;
      for (const l of stykke.linjer) {
        const antal = antalMatch(def.mønster, l.tekst);
        if (antal) {
          fundet += antal;
          fund.push({ regel, ...l, antal });
        }
      }
      // Vendinger over flere linjer ("i en travl\n hverdag").
      if (!fundet && antalMatch(def.mønster, stykke.hel)) {
        const første = stykke.linjer[0] ?? { linje: 1, kol: 1 };
        fund.push({
          regel,
          linje: første.linje,
          kol: første.kol,
          tekst: stykke.hel,
          antal: 1,
        });
      }
    }
  }
  return fund;
}

function* gennemgå(mappe) {
  let poster;
  try {
    poster = readdirSync(mappe);
  } catch {
    return;
  }
  for (const navn of poster) {
    const sti = join(mappe, navn);
    const rel = relative(ROD, sti).split(sep).join("/");
    if (navn === "node_modules" || navn === "__tests__") continue;
    const st = statSync(sti);
    if (st.isDirectory()) yield* gennemgå(sti);
    else if (
      /\.(ts|tsx)$/.test(navn) &&
      !/\.(test|spec|stories|preview)\.tsx?$/.test(navn) &&
      !navn.endsWith(".d.ts")
    )
      yield rel;
  }
}

export function filerIRoots(roots = ROOTS) {
  return roots.flatMap((r) =>
    r.endsWith(".json") ? [r] : [...gennemgå(join(ROD, r))],
  );
}

export function læsUndtagelser(sti = UNDTAGELSER_STI) {
  const liste = JSON.parse(readFileSync(sti, "utf8"));
  const fejl = [];
  liste.forEach((u, i) => {
    for (const felt of ["fil", "regel", "tekst", "grund"])
      if (typeof u[felt] !== "string" || !u[felt].trim())
        fejl.push(`undtagelse #${i + 1}: feltet "${felt}" mangler`);
    if (u.regel && u.regel !== "*" && !REGLER[u.regel])
      fejl.push(`undtagelse #${i + 1}: ukendt regel "${u.regel}"`);
    if (u.grund && u.grund.trim().length < 10)
      fejl.push(`undtagelse #${i + 1}: grunden er for kort`);
  });
  return { liste, fejl };
}

/**
 * En undtagelse rammer et fund, når filen passer ("fil" der ender på "/" er en
 * hel mappe), reglen passer ("*" = alle regler), og "tekst" står i fundet
 * ("*" = al tekst). Mappe- og stjerne-undtagelser er til hele flader, der ikke
 * er brugertekst (fx driftssider), og kræver en grund som alle andre.
 */
function rammer(u, f) {
  const filOk = u.fil.endsWith("/") ? f.fil.startsWith(u.fil) : u.fil === f.fil;
  const regelOk = u.regel === "*" || u.regel === f.regel;
  const tekstOk = u.tekst === "*" || f.tekst.includes(u.tekst);
  return filOk && regelOk && tekstOk;
}

/** Fjern undtagne fund; returnér { tilbage, ubrugte } */
export function anvendUndtagelser(fundMedFil, undtagelser) {
  const brugt = new Set();
  const tilbage = fundMedFil.filter((f) => {
    const i = undtagelser.findIndex((u) => rammer(u, f));
    if (i === -1) return true;
    brugt.add(i);
    return false;
  });
  const ubrugte = undtagelser.filter((_, i) => !brugt.has(i));
  return { tilbage, ubrugte };
}

function område(fil) {
  fil = fil.replace(/^src\/app\/\([^/]+\)\//, "src/app/");
  if (fil.startsWith("browser-extension/")) return "extension";
  if (/^src\/(app|components|app\/api)\/admin\//.test(fil)) return "admin";
  if (
    fil.startsWith("src/app/dashboard") ||
    fil.startsWith("src/components/dashboard")
  )
    return "dashboard";
  if (fil.startsWith("src/app/blog")) return "blog";
  if (fil.startsWith("src/components/email") || fil.startsWith("src/lib/email"))
    return "mail";
  if (fil.startsWith("src/app/api")) return "api";
  if (
    fil.startsWith("src/app/portal") ||
    fil.startsWith("src/components/portal")
  )
    return "portal";
  if (fil.startsWith("src/components")) return "komponenter (øvrige)";
  return "sider (marketing m.fl.)";
}

function main(argv) {
  const json = argv.includes("--json");
  const stats = argv.includes("--stats");
  const navngivne = argv.filter((a) => !a.startsWith("--"));
  const filer = navngivne.length
    ? navngivne.map((f) => relative(ROD, resolve(f)).split(sep).join("/"))
    : filerIRoots();

  const alle = [];
  for (const fil of filer) {
    const kilde = readFileSync(join(ROD, fil), "utf8");
    for (const f of scanKilde(kilde, fil)) alle.push({ fil, ...f });
  }
  const { liste, fejl } = læsUndtagelser();
  // --alle: vis fund uden undtagelser (til før/efter-tal).
  const { tilbage, ubrugte } = argv.includes("--alle")
    ? { tilbage: alle, ubrugte: [] }
    : anvendUndtagelser(alle, liste);
  // Ved en delmængde af filer giver "ubrugt" ingen mening.
  const ubrugteRelevante = navngivne.length ? [] : ubrugte;

  if (json) {
    console.log(
      JSON.stringify(
        { fund: tilbage, ubrugte: ubrugteRelevante, fejl },
        null,
        2,
      ),
    );
  } else if (stats) {
    const pr = {};
    for (const f of tilbage) {
      const o = område(f.fil);
      pr[o] ??= {};
      pr[o][f.regel] = (pr[o][f.regel] ?? 0) + f.antal;
    }
    const regler = Object.keys(REGLER);
    console.log(["område", ...regler, "i alt"].join("\t"));
    const sum = Object.fromEntries(regler.map((r) => [r, 0]));
    for (const [o, tal] of Object.entries(pr).sort()) {
      const række = regler.map((r) => tal[r] ?? 0);
      regler.forEach((r, i) => {
        sum[r] += række[i];
      });
      console.log([o, ...række, række.reduce((a, b) => a + b, 0)].join("\t"));
    }
    const total = regler.reduce((a, r) => a + sum[r], 0);
    console.log(["i alt", ...regler.map((r) => sum[r]), total].join("\t"));
    console.log(`filer med fund: ${new Set(tilbage.map((f) => f.fil)).size}`);
  } else {
    for (const f of tilbage) {
      const uddrag =
        f.tekst.length > 110 ? `${f.tekst.slice(0, 107)}…` : f.tekst;
      console.log(`${f.fil}:${f.linje}:${f.kol}  [${f.regel}]  ${uddrag}`);
    }
    for (const u of ubrugteRelevante)
      console.log(`ubrugt undtagelse: ${u.fil} [${u.regel}] "${u.tekst}"`);
    for (const e of fejl) console.log(e);
    if (tilbage.length || ubrugteRelevante.length || fejl.length) {
      console.log(
        `\nlint:copy: ${tilbage.length} fund, ${ubrugteRelevante.length} ubrugte undtagelser. Regler: docs/BRAND.md §3. Undtagelser: scripts/brand/lint-copy-undtagelser.json`,
      );
    } else {
      console.log(`lint:copy: 0 fund i ${filer.length} filer`);
    }
  }
  const fejlede =
    tilbage.length > 0 || ubrugteRelevante.length > 0 || fejl.length > 0;
  return fejlede ? 1 : 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
