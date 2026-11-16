import { describe, expect, it } from "vitest";

/**
 * Den fælles tilstand for en vælger skal bruges *hele vejen*.
 *
 * Otte hentninger i seks komponenter fyldte en projekt- eller kundevælger, og
 * ingen af dem havde en fælles del at låne fra. Sådan endte hver af dem:
 * `.then(setProjects)` uden `catch`, `.catch(() => setProjects([]))`,
 * `.catch(() => {})`, `.catch((err) => console.error(...))`. Alle fire er den
 * samme løgn i DOM'en — en vælger uden valg, altså at brugeren *ikke har*
 * projekter, når det var databasen der ikke svarede.
 *
 * `useProjectClientPicker` + `PickerLoadError` er den ene vej ind. Porten er
 * bevidst snæver: den dømmer at hooken *bruges til sin fejltilstand*, for det
 * er den egenskab der kan gå tabt igen. Den dømmer ikke hele klassen af
 * vælgere i appen — syv komponenter mere har samme fejl (målt i
 * `IMPLEMENTATION_PLAN.md`, opgaven under K48b-3), og de bliver røde, når de
 * bliver føjet over. En port der dømmer halvdelen af en klasse er bedre end
 * ingen, fordi den låser den del der er rettet i stedet for at være rød hele
 * tiden.
 *
 * Samme form som `LoadFejlPort` (indlæsning) og `i18n.test.ts` (nøgler):
 * kilderne læses med `import.meta.glob`, så porten ikke trænger på Node's `fs`.
 */
function stier(relativ: string): string {
  const dele = "src/hooks/__tests__".split("/");
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

/**
 * Viser komponenten fejlen? Matcher kun den rigtige brug: `kind={loadFailed}`
 * lige efter `<PickerLoadError`. Et `<PickerLoadError>` uden `kind` ville vise
 * ingenting, fordi komponenten returnerer `null` på `null`.
 *
 * Den anden form er `projectsLoadFailed={loadFailed}`: `AiSettings` har ingen
 * egen dropdown, den *giver* tilstanden videre til `RuleDialog`, fordi projekterne
 * kun bruges der. Det er den samme egenskab — kravet om at vise fejlen — bare
 * ét led væk, og derfor dømmer porten begge. Beviset på at vejen ikke er断 brudt
 * ligger i testen nedenfor, der kræver at `RuleDialog` faktisk renderer den.
 */
function VISER_FEJL(s: string): boolean {
  return (
    /<PickerLoadError[\s\S]{0,160}?kind=\{loadFailed\}/.test(s) ||
    /projectsLoadFailed=\{loadFailed\}/.test(s)
  );
}

/**
 * Komponenter der *bruger* hooken — altså kalder den for at hente lister.
 * Hookens egen definition (`export function useProjectClientPicker(`) er også
 * et kaldesite i mønstret, så `src/hooks/` og fejlkomponenten er taget fra.
 */
const brugerHooken = FILER.filter(
  (f) =>
    !f.startsWith("src/hooks/") &&
    !f.includes("/ui/PickerLoadError.tsx") &&
    /useProjectClientPicker\(/.test(kilder[f]),
);

const udenFejl = brugerHooken.filter((f) => !VISER_FEJL(kilder[f]));

describe("vælgere har én fælles fejltilstand", () => {
  it("ingen komponent bruger hooken uden at vise dens fejl", () => {
    // Beviset på den del der er rettet: hooken henter begge lister i én
    // kørsel og giver ÉN fejltilstand, så en komponent der henter gennem den
    // og så viser sin egen tom-tilstand, ville skjule præcis den fejl
    // hooken blev lavet til at vise.
    //
    // Listen må ikke være tom: *vacuously* sand, som den ville være hvis alle
    // seks var faldet tilbage til egne `tauriInvoke`-kald. Uden denne linje
    // er porten grøn fordi den ingenting har set — den farligste af de falske
    // grønne, fordi den ligner den korrekte kode.
    expect(brugerHooken.length).toBeGreaterThan(0);
    expect(
      udenFejl,
      `Disse bruger useProjectClientPicker uden at vise dens fejl:\n${udenFejl.join("\n")}\n\nRender <PickerLoadError kind={loadFailed} onRetry={retry} /> fra "@/components/ui/PickerLoadError".`,
    ).toEqual([]);
  });

  it("porten ser de komponenter den skal se", () => {
    // Uden dette ville porten være grøn ved at slå alt fra: en `glob` der
    // ingen filer fandt, eller et mønster der aldrig matcher, ser præcis
    // lige så rød ud som den korrekte kode.
    expect(FILER.length).toBeGreaterThan(100);
    // Målt 1/10: de tretten komponenter der henter gennem hooken —
    // GhostBlock, CalendarSuggestionBlock, TimerWidget, IdleReturnPrompt,
    // AddMatcherForm, TimeEntryForm (K48b-2) plus ProjectMatcherWizard,
    // EntrySelector, KlippekortForm, ProjectForm, AiSettings og
    // CommandPalette (K48b-3), samt PomodoroFaseRegistrering, der henter
    // kunderne kun når en pomodoro er afsluttet og den tilbyder at registrere
    // tiden.
    expect(brugerHooken.length).toBe(13);
    // Bevis på at listen ikke bare er vokset med navne: de seks fra K48b-2
    // skal stadig være der.
    for (const f of [
      "src/components/calendar/GhostBlock.tsx",
      "src/components/calendar/CalendarSuggestionBlock.tsx",
      "src/components/tracker/TimerWidget.tsx",
      "src/components/tracker/IdleReturnPrompt.tsx",
      "src/components/identity/AddMatcherForm.tsx",
      "src/components/tracker/TimeEntryForm.tsx",
      // K48b-3: de fem der deler rækken med en lister, de to formularer,
      // matcher-guden og kommandopaletten — samt `AiSettings`, som *giver*
      // tilstanden videre til `RuleDialog` (jf. nedenfor).
      "src/components/identity/ProjectMatcherWizard.tsx",
      "src/components/invoices/EntrySelector.tsx",
      "src/components/klippekort/KlippekortForm.tsx",
      "src/components/projects/ProjectForm.tsx",
      "src/components/ui/CommandPalette.tsx",
      "src/components/settings/AiSettings.tsx",
      // K61: pomodoroens registrering af en afsluttet fase. Den har sin egen
      // «indlæser kunder kun når tilbuddet vises», så den er den første der
      // bruger hooken dovent — og derfor også den der lettest afslører at
      // fejltilstanden hænger på `active` og ikke på mount.
      "src/components/tracker/PomodoroFaseRegistrering.tsx",
    ]) {
      expect(brugerHooken, f).toContain(f);
    }
    // Bevis på at stierne er løst rigtigt: portens egne filer skal kunne findes,
    // ellers så ovenstående seks bare være tilfældige.
    expect(kilder["src/hooks/useProjectClientPicker.ts"]).toBeTypeOf("string");
    expect(kilder["src/components/ui/PickerLoadError.tsx"]).toBeTypeOf(
      "string",
    );
    // Og mønsteret skal kunne fejle: hooken uden sin fejltilstand.
    // Bevis på at mønsteret kan fejle: hooken og dens fejlkomponent er blandt
    // de filer porten laster, men ingen af dem renderer en `PickerLoadError`.
    expect(VISER_FEJL(kilder["src/hooks/useProjectClientPicker.ts"])).toBe(
      false,
    );
    expect(VISER_FEJL(kilder["src/components/ui/PickerLoadError.tsx"])).toBe(
      false,
    );
    expect(VISER_FEJL(kilder["src/components/tracker/TimerWidget.tsx"])).toBe(
      true,
    );
    // Bevis på at den anden form ikke bare er et hul: `RuleDialog` skal
    // modtage den og renderer den, ellers fanger mønstret intet.
    expect(kilder["src/components/settings/RuleDialog.tsx"]).toMatch(
      /projectsLoadFailed && onRetryProjects/,
    );
  });

  it("hooken henter begge lister i samme kørsel og dømmer dem som én tilstand", () => {
    const s = kilder["src/hooks/useProjectClientPicker.ts"];
    // Ét kald for hver, ikke to rækker state der kan modsige hinanden.
    expect(s).toMatch(/tauriInvoke<Project\[\]>\("list_projects"/);
    expect(s).toMatch(/tauriInvoke<Client\[\]>\("list_clients"/);
    // `loadFailed` udledes af de to, så den kan ikke blive en tredje tilstand.
    expect(s).toMatch(/loadFailed: fejl\.projekter/);
    // Og der er prøv-igen, ellers «løsningen» er at bede brugeren starte appen.
    expect(s).toMatch(/const retry = useCallback/);
    // Hentningen er doven: de fire dialoger må ikke hente ved mount.
    expect(s).toMatch(/if \(!active\)/);
  });

  it("ingen komponent henter listerne selv, uden at være undtagelsen", () => {
    // Hooken er det *ene* sted. En komponent der henter for sig selv kan ikke
    // vise fejlen gennem den fælles tilstand, så dens `catch` bliver en ny
    // udgave af præcis det, porten ovenfor dømmer.
    //
    // `VISTE_IKKE_EN_VAELGER` er de fire der henter lister for at *vise* dem.
    // De skal hver især have en fejltilstand — det er deres egen, fordi de ikke
    // har en vælger — ellers hører de til samme fejl som de syv.
    const egne = FILER.filter(
      (f) =>
        f.endsWith(".tsx") &&
        !VISTE_IKKE_EN_VAELGER.includes(f) &&
        !ENGANGS_KOER.some((e) => e.fil === f) &&
        /tauriInvoke<[^>]*>\(\s*["'](list_projects|list_clients)["']/.test(
          kilder[f],
        ),
    );
    expect(
      egne,
      `Disse henter listerne selv uden at vise fejlen.\nBrug useProjectClientPicker + PickerLoadError, eller — hvis listen hentes for at vise den og ikke for at vælge fra — en LoadError, og føj filen til VISTE_IKKE_EN_VAELGER.`,
    ).toEqual([]);
  });

  it("de fire lister der viser lister har hver sin egen fejlskærm", () => {
    // Beviset på at undtagelseslisten er nødvendig og ikke en flugtvej: hver af
    // dem skal kunne *sige* at listerne ikke kom. Uden denne linje kunne en af
    // dem falde tilbage til en stille `catch` og porten stadig være grøn.
    for (const f of VISTE_IKKE_EN_VAELGER) {
      const s = kilder[f];
      expect(s, f).toBeTypeOf("string");
      expect(s, f).toMatch(/setLoadFailed\(true\)|LoadError/);
    }
    // Og listen må ikke svæmme: kun en fil ad gangen kan få undtagelsen.
    expect(VISTE_IKKE_EN_VAELGER.length).toBe(4);
  });

  it("onboardingens engangstjek siger det, når det mislykkedes", () => {
    // Undtagelsen ovenfor må ikke blive «filen henter lister, og det er fint».
    // Den er kun rimelig, fordi wizarden siger *hvad* der skete — ellers står
    // brugeren med «opret din første kunde» og opretter en, han måske har.
    expect(ENGANGS_KOER.length).toBe(1);
    for (const { fil, bevis } of ENGANGS_KOER) {
      expect(kilder[fil], fil).toMatch(bevis);
    }
  });
});

/**
 * Komponenter der henter `list_projects`/`list_clients` for at vise listerne, og
 * derfor har ingen vælger. Målt 1/10 — fire filer, hver med sin egen
 * `LoadError` over hele visningen.
 *
 * `OnboardingWizard` er bevidst *ikke* på listen, selv om den henter begge:
 * der er tjekket «har synken allerede bragt kunder med» en del af en
 * engangskørsel, hvor en fejl ikke må blokere oprettelsen. Den siger fejlen
 * med sin egen linje i stedet (`onboarding.couldNotCheckExisting*`), og en
 * komponenttest dømmer den.
 */
const VISTE_IKKE_EN_VAELGER = [
  "src/components/projects/ProjectList.tsx",
  "src/components/projects/ClientList.tsx",
  "src/components/timeline/TimelineView.tsx",
  "src/components/dashboard/RecentActivity.tsx",
];

/**
 * `OnboardingWizard` henter også begge lister, og har alligevel ingen vælger:
 * tjekket «har synken allerede bragt kunder med» er en del af en engangskørsel,
 * hvor en fejl ikke må blokere oprettelsen — brugeren skal kunne oprette sin
 * første kunde uanset hvad databasen svarer. Derfor siger den fejlen med sin egen
 * linje i stedet for en fejlskærm, og derfor skal den være her med sit eget
 * bevis, ikke i listen ovenfor.
 */
const ENGANGS_KOER = [
  {
    fil: "src/components/onboarding/OnboardingWizard.tsx",
    bevis: /couldNotCheckExistingClients/,
  },
];
