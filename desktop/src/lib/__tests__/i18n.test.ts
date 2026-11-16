import { describe, expect, it } from "vitest";
import { scanFil } from "@/lib/__tests__/uiTextScanner";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

const LANGS = { da, en, sv, nb, de, es } as const;
type Lang = keyof typeof LANGS;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * Kode der ligner en oversættelsesnøgle: et navn, så et punktum, så navne igen.
 * Både `t("nøgle")` og nøgler i kort (`Record<string, string>`), i nøgle-arrays
 * og i terninger (`t(cond ? "a" : "b")`) har den form. SQL-kolonner
 * (`invoice_prefix`), Tailwind-klasser (`text-red-500`) og model-id'er uden
 * punktum (`gpt-4o-mini`) har ikke — derfor kræver mønstret et punktum.
 */
const KEY_LITERAL = /["'`]([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)["'`]/g;

/**
 * Nøgleformede strenge i koden der *ikke* er oversættelsesnøgler. Holdes her,
 * så porten dømmer hver ny undtagelse eksplicit i stedet for at springe over
 * dem i det stille. Undtagelsen skal fjernes igen, når koden ikke længere har
 * strengen — ellers dækker den en fremtidig nøgle ved et navnekollisions-uheld.
 */
const NOT_KEYS: Record<string, string> = {
  "Ordbogen.ai": "udbyderens navn i en konstant, ikke en nøgle",
  "toast.success": "kaldenavn i uiTextScanner, ikke en nøgle",
  "toast.error": "kaldenavn i uiTextScanner, ikke en nøgle",
  "toast.info": "kaldenavn i uiTextScanner, ikke en nøgle",
  "toast.warning": "kaldenavn i uiTextScanner, ikke en nøgle",
};

/** Alle nøgleformede strenge i koden, også dem i NOT_KEYS. */
const literals = new Set<string>();

function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  // `calendar.monthNames` er et array, der hentes med returnObjects. Arrays skal
  // derfor tælle som én nøgle, ellers taber dækningstjekket dem.
  if (Array.isArray(node)) {
    out.set(prefix, JSON.stringify(node));
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of flatten(value, full)) out.set(k, v);
    } else {
      out.set(full, String(value));
    }
  }
  return out;
}

const TABLES = Object.fromEntries(
  Object.entries(LANGS).map(([lang, json]) => [lang, flatten(json)]),
) as Record<Lang, Map<string, string>>;

/** A key is present when the base key exists, or when every plural form does. */
function has(table: Map<string, string>, key: string): boolean {
  if (table.has(key)) return true;
  return table.has(`${key}_one`) && table.has(`${key}_other`);
}

/**
 * Every source file under src/, as raw text, so the keys can be read off the code.
 * Tests holdt ude: en test-fil kan skrive nøgler der aldrig når en bruger, og
 * glob'en giver egne testfiler som `./navn.test.ts` — ikke under `__tests__/`.
 */
const sourceFiles = Object.entries(
  import.meta.glob("../../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
)
  .filter(([file]) => !/(^|\/)(__tests__\/|[^/]+\.test\.[tj]sx?$)/.test(file))
  .map(
    ([file, source]) => [file.replace(/^.*?src\//, "src/"), source] as const,
  );

/** Kilderne som et objekt, så portene kan slå en enkelt fil op. */
const kilder: Record<string, string> = Object.fromEntries(
  sourceFiles.map(([file, source]) => [rel(file), source]),
);

/** Samme map med navnet porten bruger. */
const relMap = kilder;

/** Every translation key referenced in source, with the options it was called with. */
const used = new Map<
  string,
  { defaultValue: string | null; count: boolean; files: Set<string> }
>();

/**
 * Fjerner kommentarer, så en nøgle der *nævnes* i en kommentar
 * (`i18n.test.ts` læser dem…) ikke tælles som brugt. Kun blokkommentarer og
 * linjer der helt er kommentarer fjernes — en `//` bag på en kodelinje er bevaret,
 * fordi det er den vej kodefejlene ligger på.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(?:\/\/|\*).*$/gm, "");
}

for (const [relative, raw] of sourceFiles) {
  const source = stripComments(raw);
  const record = (key: string, defaultValue: string | null, count: boolean) => {
    const entry = used.get(key) ?? {
      defaultValue: null,
      count: false,
      files: new Set<string>(),
    };
    entry.defaultValue ??= defaultValue;
    entry.count ||= count;
    entry.files.add(relative);
    used.set(key, entry);
  };

  // t("key") and t("key", "literal") — med eller uden sluttende komma, så et
  // kald der er brudt over flere linjer ikke glipper.
  for (const m of source.matchAll(
    /\bt\(\s*["']([a-zA-Z0-9_.]+)["']\s*(?:,\s*"((?:[^"\\]|\\.)*)")?\s*,?\s*\)/g,
  )) {
    record(m[1], m[2] ?? null, false);
  }

  // t("key", { ...options, defaultValue: "..." })
  for (const m of source.matchAll(
    /\bt\(\s*["']([a-zA-Z0-9_.]+)["']\s*,\s*(\{[\s\S]{0,400}?\})\s*,?\s*\)/g,
  )) {
    const fallback =
      /defaultValue\s*:\s*(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/.exec(m[2]);
    record(
      m[1],
      fallback ? (fallback[1] ?? fallback[2]) : null,
      /\bcount\b/.test(m[2]),
    );
  }

  // Nøgler der kun findes som strenge i koden: kort (`Record<string, string>`),
  // nøgle-arrays og begge grene af en terning. `t("nøgle")` ovenfor ser dem
  // ikke, så de kunne mangle i json uden at porten vidste det.
  for (const m of source.matchAll(KEY_LITERAL)) {
    literals.add(m[1]);
    if (m[1] in NOT_KEYS) continue;
    record(m[1], null, false);
  }
}

/** Keys the code calls with a `count`, so the plural forms can be exercised. */
const COUNT_KEYS = [
  "timeline.bulkSelected",
  "timeline.bulkAssigned",
  "timeline.bulkDeleted",
  "timeline.bulkMarkedNonBillable",
  "timeline.bulkAssignDesc",
  "timeline.bulkDeleteConfirmBtn",
  "timeline.bulkDeleteWarning",
];

describe("i18n-dækning", () => {
  it("finder kilder at kontrollere", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
    expect(used.size).toBeGreaterThan(400);
  });

  it("ser også nøgler der kun står i kort, arrays og terninger", () => {
    // Nøgler der hentes dynamisk (`t(TREND_KEYS[retning])`,
    // `t(fraArbejde ? "a" : "b")`) eller gennem et nøgle-array. De er skrevet i
    // koden, så de skal kunne mangle i json som alt andet — ellers er
    // "ingen brugt nøgle mangler" kun sand for de bogstavelige kald.
    const dynamiske = [
      "reports.trendUp",
      "reports.trendDown",
      "reports.trendFlat",
      "pomodoro.phaseDone",
      "pomodoro.breakDone",
      "pomodoro.shortBreakBody",
      "pomodoro.longBreakBody",
      "pomodoro.breakDoneBody",
      "ai.opContains",
      "identity.kindPath",
      // `TIER_LABELS` i LicenseSettings er et kort af nøglenavne, ikke
      // etiketter — de tre niveauer lå som danske værdier i koden.
      "license.lifetime",
      "license.solo",
      "license.team",
    ];
    const usete = dynamiske.filter((key) => !used.has(key));
    expect(usete).toEqual([]);
  });

  it("hver undtagelse fra nøglelisten findes stadig i koden", () => {
    // En `NOT_KEYS`-undtagelse der ikke længere bruges, er en hvidliste der
    // vokser i det stille. Så snart strengen er væk, skal den væk herfra.
    const forældede = Object.keys(NOT_KEYS).filter((key) => !literals.has(key));
    expect(forældede).toEqual([]);
  });

  it("alle 6 locales har præcis samme nøglesæt", () => {
    const reference = TABLES.da;
    for (const lang of ["en", "sv", "nb", "de", "es"] as Lang[]) {
      const table = TABLES[lang];
      const missing = [...reference.keys()].filter((k) => !table.has(k));
      // Sprog med flere flertalskategorier end dansk (fx spansk `many`) må have
      // de ekstra former, men kun som søskende til en `_other`-nøgle i dansk.
      const categories = new Intl.PluralRules(lang).resolvedOptions()
        .pluralCategories as string[];
      const extra = [...table.keys()].filter((k) => {
        if (reference.has(k)) return false;
        const m = k.match(PLURAL_SUFFIX);
        return !(
          m &&
          categories.includes(m[1]) &&
          reference.has(k.replace(PLURAL_SUFFIX, "_other"))
        );
      });
      expect({ lang, missing, extra }).toEqual({
        lang,
        missing: [],
        extra: [],
      });
    }
  });

  it("ingen brugt nøgle mangler i en locale", () => {
    const holes = [...used.entries()]
      .filter(([key]) => !has(TABLES.da, key.replace(PLURAL_SUFFIX, "")))
      .map(([key, { files }]) => `${key} (${[...files].join(", ")})`);
    expect(holes).toEqual([]);
  });

  it("ingen nøgel bærer en dansk inline-fallback", () => {
    // Inline fallbacks er dansk kode, der løber fra json-filerne. De er grunden til
    // at svenske, norske, tyske og engelske brugere har set dansk tekst.
    const inline = [...used.entries()]
      .filter(
        ([key, { defaultValue }]) =>
          defaultValue !== null && has(TABLES.da, key),
      )
      .map(([key, { defaultValue }]) => `${key} => ${defaultValue}`);
    expect(inline).toEqual([]);
  });

  it("ingen værdi er tom eller kun et rå nøglenavn", () => {
    const broken: string[] = [];
    for (const [lang, table] of Object.entries(TABLES)) {
      for (const [key, value] of table) {
        if (value.trim() === "") broken.push(`${lang}:${key} er tom`);
        if (key === value) broken.push(`${lang}:${key} er lig sin egen nøgle`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("hver tælle-nøgle har både en- og flere-form i alle sprog", () => {
    // Nøgler der får `count` indsendt i kaldet skal have begge former i hvert
    // sprog, ellers får en bruger "1 activities". Dansk og tysk kræver
    // "1 aktivitet" mod "2 aktiviteter".
    const countKeys = [...used.entries()]
      .filter(([key, { count }]) => key.startsWith("timeline.bulk") && count)
      .map(([key]) => key);
    expect(countKeys.sort()).toEqual([...COUNT_KEYS].sort());

    const holes: string[] = [];
    for (const [lang, table] of Object.entries(TABLES)) {
      for (const key of countKeys) {
        for (const form of ["_one", "_other"]) {
          if (!table.has(key + form)) holes.push(`${lang}:${key + form}`);
        }
      }
    }
    expect(holes).toEqual([]);
  });

  it("bøjning renderer rigtigt i alle 6 sprog", async () => {
    // Denne test verificerer mekanikken: at i18next vælger mellem _one og _other,
    // og at tallet sættes ind. Den kan IKKE afgøre om en ordform er korrekt
    // dansk, svensk eller tysk — det kræver en sprogkender, så "1 Aktivitaet"
    // ville passere her. Oversættelserne er gennemgået i hånden.
    const original = i18n.language;
    try {
      for (const lang of ["da", "en", "sv", "nb", "de", "es"] as Lang[]) {
        await i18n.changeLanguage(lang);
        for (const key of COUNT_KEYS) {
          for (const n of [0, 1, 2, 3, 11]) {
            const rendered = i18n.t(key, { count: n });
            // Aldrig en rå nøgle, og tallet skal være sat ind.
            expect(rendered).not.toBe(key);
            expect(rendered.includes("_one")).toBe(false);
            expect(rendered.includes("_other")).toBe(false);
            expect(rendered.includes(String(n))).toBe(true);
          }
        }
      }
    } finally {
      await i18n.changeLanguage(original);
    }
  });
});

/**
 * UI-tekst der står i koden i stedet for i en json-fil, malt 30/9 af
 * den maa blive liggende - helt til sidst er det kun ting der ikke er sprog
 * (produktnavnet "TimeTrack", tastenavnet "ESC", en format-pladsholder).
 *
 * Porten dømmer at der ikke kommer flere, og at der ikke bliver liggende
 * undtagelser der ikke længere findes: så snart en tekst er oversat, eller
 * filen er ryddet, skal linjen væk, og testen siger det. Det er den modsatte
 * retning af en hvidliste, der bare vokser.
 */
const UI_TEKST_UNDTAGELSER: Record<string, Record<string, string>> = {
  "components/klippekort/KlippekortCard.tsx": {
    "/t": "timeenhed, se K25d — valutaen skal stå, så «pr. time» kan ikke løses med Intl",
  },
  "components/layout/StatusBar.tsx": {
    v: "versionsbogstav",
  },
  "components/layout/Titlebar.tsx": {
    TimeTrack: "produktnavn",
  },
  "components/onboarding/OnboardingWizard.tsx": {
    OpenAI: "udbyderens navn i en konstant, ikke tekst",
    "sk-...": "format-hint for en API-nøgle, ikke tekst",
    "Claude (Anthropic)": "udbyderens navn i en konstant, ikke tekst",
    "sk-ant-...": "format-hint for en API-nøgle, ikke tekst",
    "Google Gemini": "udbyderens navn i en konstant, ikke tekst",
    "AI...": "format-hint for en API-nøgle, ikke tekst",
    OpenRouter: "udbyderens navn i en konstant, ikke tekst",
    "sk-or-...": "format-hint for en API-nøgle, ikke tekst",
  },
  "components/reports/ReportView.tsx": {
    CSV: "filformatets navn, ens i alle sprog — ikke tekst",
    // `Q{q}` er en etiket på en rapportkvartal-knap. «Q» er den samme
    // abbreviation i alle de fem sprog appen understøtter, og tallene står
    // ved siden af — så at oversætte den ville gøre knappen mindre, ikke
    // mere læselig. Ikke dansk tekst.
    Q: "kvartals-abbreviation, ens i alle sprog — ikke tekst",
  },
  "components/settings/GeneralSettings.tsx": {
    Dansk:
      "sprogets eget navn — en sprogvælger skal kunne genfinde sit eget navn",
    English:
      "sprogets eget navn — en sprogvælger skal kunne genfinde sit eget navn",
    Svenska:
      "sprogets eget navn — en sprogvælger skal kunne genfinde sit eget navn",
    Norsk:
      "sprogets eget navn — en sprogvælger skal kunne genfinde sit eget navn",
    Deutsch:
      "sprogets eget navn — en sprogvælger skal kunne genfinde sit eget navn",
    Español:
      "sprogets eget navn — en sprogvælger skal kunne genfinde sit eget navn",
    "TimeTrack Desktop": "produktnavn",
    v: "versionsbogstav",
  },
  "components/timeline/PomodoroFaseRække.tsx": {
    "&ndash;":
      "HTML-entitet for en tankestrege, ikke tekst — samme som TimelineView",
  },
  "components/timeline/TimelineView.tsx": {
    "&mdash;": "HTML-entitet for en lang tankestrege, ikke tekst",
    "&ndash;": "HTML-entitet for en tankestrege, ikke tekst",
    OpenAI: "udbyderens navn i en konstant, ikke tekst",
    Claude: "udbyderens navn i en konstant, ikke tekst",
    "Google Gemini": "udbyderens navn i en konstant, ikke tekst",
    Ollama: "udbyderens navn i en konstant, ikke tekst",
    OpenRouter: "udbyderens navn i en konstant, ikke tekst",
    "Ordbogen.ai": "udbyderens navn i en konstant, ikke tekst",
  },
  "components/settings/CalendarIntegration.tsx": {
    "Google Calendar": "udbyderens produktnavn, ens i alle sprog",
    "https://calendar.google.com/calendar/ical/...":
      "eksempel-URL i et placeholder-felt, ikke tekst",
  },
  "components/settings/AiSettings.tsx": {
    OpenAI: "udbyderens navn i en konstant, ikke tekst",
    "Claude (Anthropic)": "udbyderens navn i en konstant, ikke tekst",
    "Google Gemini": "udbyderens navn i en konstant, ikke tekst",
    "Ordbogen.ai": "udbyderens navn i en konstant, ikke tekst",
    OpenRouter: "udbyderens navn i en konstant, ikke tekst",
  },
  "components/settings/TrackingSettings.tsx": {
    "teams, zoom, meet, webex, slack call, google meet, ms teams":
      "standardværdi med produktnavne i et fritekstfelt",
  },
  "components/settings/IntegrationSettings.tsx": {
    Billy: "produktnavn",
    Dinero: "produktnavn",
    "e-conomic": "produktnavn",
    Rentemester: "produktnavn",
  },
  "components/settings/LicenseSettings.tsx": {
    "TT-XXXX-XXXX-XXXX-XXXX": "format-pladsholder",
    "timetrack.dk/pricing": "produktnavn",
  },
  "components/settings/UpdateSettings.tsx": {
    "TimeTrack Desktop v": "produktnavn",
  },
  "components/timeline/ActivityBlock.tsx": {
    "&ndash;": "HTML-entitet for en tankestrege, ikke tekst",
  },
  "components/timeline/ConfirmDialog.tsx": {
    "&ndash;": "HTML-entitet for en tankestrege, ikke tekst",
  },
  "components/ui/AboutDialog.tsx": {
    "TimeTrack Desktop": "produktnavn",
    "timetrack.dk": "produktnavn",
    "&copy; 2026 Mahope.": "copyright",
  },
  "components/ui/CommandPalette.tsx": {
    ESC: "tastenavn",
  },
  "components/ui/LicenseGate.tsx": {
    "TT-XXXX-XXXX-XXXX-XXXX": "format-pladsholder",
  },
  "components/ui/SplashScreen.tsx": {
    TimeTrack: "produktnavn",
  },
};

/**
 * Stien som læses i `UI_TEKST_UNDTAGELSER`. Glob'en giver `../../components/x`,
 * fordi testen ligger to niveauer under `src/`; undtagelseslisten skal kunne
 * skrives som `components/x`, ellers er den ulæselig.
 */
function rel(sti: string): string {
  return sti.replace(/^(\.\.\/)+/, "");
}
const jsxFiles = sourceFiles.filter(([file]) => file.endsWith(".tsx"));

/** Alle fund i alle `.tsx`-kilder, undtagen dem i `UI_TEKST_UNDTAGELSER`. */
const uiFund = jsxFiles.flatMap(([file, raw]) =>
  scanFil(rel(file), stripComments(raw)).filter(
    (fund) => !(fund.tekst in (UI_TEKST_UNDTAGELSER[rel(file)] ?? {})),
  ),
);

describe("hardkodet UI-tekst", () => {
  it("finder JSX-kilder nok at kontrollere", () => {
    // Uden denne test passerer porten på en glob, der ingen filer rammer.
    expect(jsxFiles.length).toBeGreaterThan(30);
  });

  it("ingen UI-tekst står i koden uden for en målt undtagelse", () => {
    // Fund 30/9 (LAV): 18 strenge i kommandopaletten lå på egne linjer, og
    // ingen port så dem, fordi de ikke var nøgler. Det her er den port.
    expect(uiFund.map((f) => `${f.file}:${f.linje} ${f.tekst}`)).toEqual([]);
  });

  it("hver undtagelse findes stadig i koden", () => {
    // En undtagelse der ikke længere svarer til noget, er en hvidliste der
    // vokser i det stille. Så snart teksten er væk, skal den væk herfra.
    const gammel: string[] = [];
    for (const [file, tekster] of Object.entries(UI_TEKST_UNDTAGELSER)) {
      const fundet = new Set(
        scanFil(file, stripComments(relMap[file] ?? "")).map((f) => f.tekst),
      );
      for (const tekst of Object.keys(tekster)) {
        if (!fundet.has(tekst)) gammel.push(`${file}: ${tekst}`);
      }
    }
    expect(gammel).toEqual([]);
  });

  it("hver undtagelse har en begrundelse", () => {
    // En tom begrundelse er en undtagelse uden begrundelse.
    const manglerGrund: string[] = [];
    for (const [file, tekster] of Object.entries(UI_TEKST_UNDTAGELSER)) {
      for (const [tekst, grund] of Object.entries(tekster)) {
        if (grund.trim() === "") manglerGrund.push(`${file}: ${tekst}`);
      }
    }
    expect(manglerGrund).toEqual([]);
  });
});
