import { describe, expect, it } from "vitest";

/**
 * Registreret tid må aldrig forsvinde fra skærmen, fordi databasen svarede
 * med en fejl.
 *
 * Mønsteret `.catch(() => setEntries([]))` lå i kalenderens tre visninger.
 * Det er den samme løgn som K48a fandt i klient- og projektlisterne — bare
 * værre, fordi den tomme tilstand her *betyder noget*: en dag uden
 * registreringer er beskeden «du arbejdede ikke», og en låst database eller en
 * afbrudt synk fik brugeren til at tro præcis det. En bruger der re-registrerer
 * en arbejdsdag, fordi appen sagde den var tom, får dobbelt registreret tid.
 *
 * Porten dømmer **hvert `catch` for sig**, ikke filen. Det er målt, ikke
 * antaget: en port, der bare spurgte om filen overhovedet nogensinde satte en
 * fejltilstand, var grøn mod den gamle kode — MonthView havde stadig
 * `setLoadFailed` og `<LoadError` i sig, da dens `catch` var lagt tilbage til
 * `.catch(() => setEntries([]))`. En undtagelse skal derfor stå i det samme
 * `catch` som tømningen.
 */

/** Gør en glob-sti til en sti fra repo-roden. */
function stier(relativ: string): string {
  const dele = "src/components/__tests__".split("/");
  for (const del of relativ.split("/")) {
    if (del === "." || del === "") continue;
    if (del === "..") dele.pop();
    else dele.push(del);
  }
  return dele.join("/");
}

const kilder = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  )
    .filter(([fil]) => !/(^|\/)(__tests__\/|[^/]+\.test\.[tj]sx?$)/.test(fil))
    .map(([fil, tekst]) => [stier(fil), tekst]),
);

const FILER = Object.keys(kilder);

/** Kalenderkommandoerne — de læser *registreret tid*, ikke valg. */
const TIDS_KALDE = [
  "list_time_entries",
  "list_activities",
  "list_activities_range",
];

function laeserTid(fil: string): boolean {
  const s = kilder[fil];
  return TIDS_KALDE.some((cmd) => s.includes(`"${cmd}"`));
}

/** Teksten inde i et `.catch( … )` — parenteser tælles, så nestede kalds klammer ikke forstyrrer. */
function catchTekst(s: string, fra: number): string {
  let dybde = 0;
  for (let i = fra; i < s.length; i++) {
    const c = s[i];
    if (c === "(") dybde++;
    else if (c === ")") {
      dybde--;
      if (dybde === 0) return s.slice(fra, i);
    }
  }
  return "";
}

interface Fund {
  fil: string;
  linje: number;
  tømmer: string;
}

/**
 * `catch`-blokke, der tømmer en liste uden at sige fra i samme blok.
 *
 * Begge skrivformer dømmes — `.catch(() => setX([]))` *og* den blokkede
 * `.catch(() => { setX([]); })`. Det er målt, ikke antaget: en mutation, der
 * gjorde kalenderens `catch` til en blok med tre tømninger og uden
 * `setLoadFailed`, slap igennem en port, der kun kendte pileformen.
 *
 * `catchTekst` tæller klammer, så en klamme i en tekst kan forskyde
 * blokken. Det er testet og fundet ufarligt her: en mutation med både en
 * ubalanceret klamme i strengen og den gammel kode-fælde blev stadig
 * dømt, fordi den optællede blok rakte hele `catch`-kaldet med.
 */
function tømmerUdenAtSigeFra(fil: string): Fund[] {
  const s = kilder[fil];
  const fund: Fund[] = [];
  for (const match of s.matchAll(/\.catch\s*\(/g)) {
    const åben = match.index + match[0].length - 1;
    const blok = catchTekst(s, åben);
    if (!/\[\]/.test(blok)) continue;
    // Kun tømning af en *liste*, ikke af en vilkårlig værdi.
    const tømmer = /\bset[A-Za-z0-9_]*\(\s*\[\]\s*\)/.exec(blok);
    if (!tømmer) continue;
    const sigerFra =
      /set[A-Za-z0-9_]*Failed|LoadError|toast\.|set[A-Za-z0-9_]*Error/.test(
        blok,
      );
    if (sigerFra) continue;
    fund.push({
      fil,
      linje: s.slice(0, åben).split("\n").length,
      tømmer: tømmer[0],
    });
  }
  return fund;
}

const funnene = FILER.filter((f) => f.endsWith(".tsx") && laeserTid(f)).flatMap(
  tømmerUdenAtSigeFra,
);

describe("registreret tid tømmes ikke ved en fejl", () => {
  it("intet `catch` gør en fejl til en tom dag", () => {
    expect(
      funnene.map((f) => `${f.fil}:${f.linje} (${f.tømmer}([]))`),
      `Disse tømmer registreret tid i stedet for at sige fra:\n${funnene
        .map((f) => `${f.fil}:${f.linje}`)
        .join(
          "\n",
        )}\n\nBrug <LoadError message={...} onRetry={...} /> fra "@/components/ui/LoadError", som de andre lister gør.`,
    ).toEqual([]);
  });

  it("porten ser de filer den skal se", () => {
    // Uden dette ville porten være grøn ved at slå alt fra: en `glob` der
    // ingen filer fandt, eller et kommando-navn der aldrig matcher, ser præcis
    // lige så rød ud som den korrekte kode. Målt 1/10 med de samme mønstre.
    expect(FILER.length).toBeGreaterThan(100);
    const laesende = FILER.filter((f) => f.endsWith(".tsx") && laeserTid(f));
    // Målt: 6 — DayView, WeekView, MonthView, TimeEntryList, WeekSummary og
    // TimelineView.
    expect(laesende.length).toBeGreaterThanOrEqual(6);
    // Og porten skal kunne kende et `catch` der tømmer en liste overhovedet,
    // ellers dømmer den intet. Beviset er de to kalendervisninger, der havde
    // netop det.
    const medTomtCatch = FILER.filter((f) =>
      /\.catch\s*\([\s\S]{0,400}?\[\]/.test(kilder[f]),
    );
    // Målt 1/10 *efter* rettelsen: 3 — CalendarSuggestionBlock,
    // AddMatcherForm og IdleReturnPrompt, hvor listen er valg i en
    // rulleliste og ikke dagens arbejde. Før rettelsen var den 6.
    expect(medTomtCatch.length).toBeGreaterThanOrEqual(3);
  });

  it("kalenderens tre visninger bruger den fælles fejltilstand", () => {
    // Locken på den fælles del: en ny kalendovisning skal finde LoadError
    // frem for at finde på en ny måde at vise en fejl på.
    for (const fil of [
      "src/components/calendar/DayView.tsx",
      "src/components/calendar/WeekView.tsx",
      "src/components/calendar/MonthView.tsx",
    ]) {
      const s = kilder[fil];
      expect(s, `${fil} skal bruge LoadError`).toMatch(/<LoadError/);
      // `onRetry` skal føre til et nyt kald, ikke blot tegne fejlen igen.
      expect(s, `${fil} skal give LoadError et kald at prøve igen med`).toMatch(
        /onRetry=\{fetchData\}/,
      );
    }
  });
});
