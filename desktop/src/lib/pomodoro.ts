// Pomodoro-fasernes rene logik, uden React og uden timeren.
//
// Alt, der kan testes, ligger her, så store'en kun skal holde state og
// kalde `setInterval`. Det er derfor, der er en testfil: en pomodoro, der
// springer en pause over eller tæller en forkert, kan ikke læses ud fra
// UI'et, og en bruger der mister 25 minutter på en fejl har mistet tid —
// præcis den slags fejl missionen siger aldrig må ske.

import type { ActivityBlock } from "./activityBlocks";
import { toLocalDateStr, toLocalDateTimeStr } from "./format";
import type { PomodoroDag } from "./types";

/** En fase i cyklussen. `idle` er ikke en fase, den er "ikke startet". */
export type PomodoroMode = "work" | "shortBreak" | "longBreak" | "idle";

export interface PomodoroConfig {
  work_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  sessions_before_long: number;
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  work_minutes: 25,
  short_break_minutes: 5,
  long_break_minutes: 15,
  sessions_before_long: 4,
};

/** Grænserne fra indstillingsvinduet. De bruges også som hård stop, fordi
 *  et tomt eller negativt tal fra et `<input type="number">` ellers ville
 *  give en fase på nul sekunder og en division ved nul i fremdriftsringen. */
export const CONFIG_LIMITS = {
  work_minutes: { min: 1, max: 120 },
  short_break_minutes: { min: 1, max: 60 },
  long_break_minutes: { min: 1, max: 60 },
  sessions_before_long: { min: 1, max: 10 },
} as const;

/** Sekunder i en fase. `idle` er 0 — der er ingen fase at tælle ned. */
export function modeSeconds(
  mode: PomodoroMode,
  config: PomodoroConfig,
): number {
  switch (mode) {
    case "work":
      return config.work_minutes * 60;
    case "shortBreak":
      return config.short_break_minutes * 60;
    case "longBreak":
      return config.long_break_minutes * 60;
    default:
      return 0;
  }
}

/**
 * Den fase der følger efter `mode` er slut, og hvor mange arbejdssessioner der
 * så er gennemført i alt.
 *
 * Springer brugeren en fase over med "spring over", tælles den som gennemført
 * — ellers kunne man springe over tre korte pauser og få den lange uden at have
 * arbejdet. Det er den eneste forskel til den normale udløbning, og den er
 * bevidst: en knap der springer over uden at tælle ville gøre tælleren til
 * en ljuster.
 */
export function nextPhase(
  mode: PomodoroMode,
  sessionsCompleted: number,
  config: PomodoroConfig,
): { mode: PomodoroMode; sessionsCompleted: number } {
  if (mode === "work" || mode === "idle") {
    const fulde = sessionsCompleted + 1;
    const lang =
      config.sessions_before_long > 0 &&
      fulde % config.sessions_before_long === 0;
    return {
      mode: lang ? "longBreak" : "shortBreak",
      sessionsCompleted: fulde,
    };
  }

  return { mode: "work", sessionsCompleted };
}

/**
 * Sekunder tilbage indtil `slutterOm` regnes ud fra et klokkeslæt, ikke ved
 * at trække én fra hvert tik.
 *
 * `setInterval` tikker ikke én gang i sekundet: en skjult fane eller en
 * søvende maskine får browseren til at sænke frekvensen, og en pomodoro må
 * ikke blive længere, fordi brugeren har ladet vinduet stå. Derfor regnes
 * resttiden altid fra `Date.now()`, så en senere tik springer præcist det
 * forsinkede interval frem.
 */
export function remainingSeconds(slutterOm: number, nu: number): number {
  return Math.max(0, Math.ceil((slutterOm - nu) / 1000));
}

/** Fremdrift i den kørende fase, 0–1. Tæller ned, så fuld ring er 1. */
export function progress(
  timeRemaining: number,
  mode: PomodoroMode,
  config: PomodoroConfig,
): number {
  const total = modeSeconds(mode, config);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, timeRemaining / total));
}

/** Hvilken runde i cyklussen brugeren er ved, 1-baseret. */
export function currentRunde(
  mode: PomodoroMode,
  sessionsCompleted: number,
  config: PomodoroConfig,
): number {
  const cyklus = Math.max(1, config.sessions_before_long);
  if (mode === "idle") return 0;
  // I en arbejdsfase er den igangværende runde den næste i rækken, så runde 1
  // nås både første gang og igen lige efter den lange pause. I en pause er den
  // netop afsluttede runde den, der tælles — og efter den lange pause er alle
  // `cyklus` fulde, ikke nul.
  const fulde = sessionsCompleted % cyklus;
  if (mode === "work") return fulde + 1;
  return fulde || cyklus;
}

/**
 * Gør en værdi fra indstillingsvinduet (eller en gammel gemt konfiguration)
 * til gyldige tal. Ugyldige tal bliver standardværdien, ikke 0 og ikke NaN.
 */
export function normalizeConfig(rå: unknown): PomodoroConfig {
  const kilde = (rå ?? {}) as Record<string, unknown>;
  const ud = { ...DEFAULT_POMODORO_CONFIG };

  for (const nøgle of Object.keys(CONFIG_LIMITS) as (keyof PomodoroConfig)[]) {
    const { min, max } = CONFIG_LIMITS[nøgle];
    const værdi = Number(kilde[nøgle]);
    ud[nøgle] =
      Number.isFinite(værdi) && værdi > 0
        ? Math.min(max, Math.max(min, Math.round(værdi)))
        : DEFAULT_POMODORO_CONFIG[nøgle];
  }

  return ud;
}

/**
 * Tid som `mm:ss`, altså "25:00" og ikke "00:25:00".
 *
 * Ringen er 176 px bred, og `formatElapsed`s timeentry-format har altid to
 * timers før kolonnen — otte tegn i mono på 30 px fyldte ringen og løb ud over
 * kanten. En pomodorofase er højst 120 minutter, så to tal er nok.
 */
export function formatPhaseTime(totalSeconds: number): string {
  const hel = Math.floor(totalSeconds / 60);
  const sek = Math.floor(totalSeconds % 60);
  return `${hel.toString().padStart(2, "0")}:${sek.toString().padStart(2, "0")}`;
}

/** Skal ændringen gemmes, eller er den bare den værdi, der allerede er? */
export function configChanged(
  nuværende: PomodoroConfig,
  ny: PomodoroConfig,
): boolean {
  return (Object.keys(CONFIG_LIMITS) as (keyof PomodoroConfig)[]).some(
    (nøgle) => nuværende[nøgle] !== ny[nøgle],
  );
}

/** Én kolonne i uge-striben. */
export interface UgeDag {
  /** Kalenderdagen i lokal `YYYY-MM-DD` — samme form backendens rækker har. */
  day: string;
  /** Dagens sessioner, summeret over alle de rækker der faldt på den. */
  sessions: number;
  /** Sand for dagens kolonne — den er fremhævet, resten er ikke. */
  erIDag: boolean;
  /** Dagens korte navn, hentet fra den valgte sprogs kalender. */
  navn: string;
  /** 0–1, hvor høj søjlen tegnes. En dag uden pomodoros er 0 og ikke en
   *  undtagelse — en tom søjle er netop det, der gør rytmen synlig. */
  højde: number;
}

/**
 * De felter striben bruger fra en række i `get_pomodoro_stats`'s svar.
 *
 * Et `Pick` frem for en egen grænseflade: `PomodoroDag` er den eneste
 * beskrivelse af backendens svar, så en kopi her ville kunne komme i drift fra
 * den — fx hvis `day` engang fik et andet format. `minutes` er bevidst ikke
 * med: striben skal regne på *sessioner*, ikke på minutter, for en pomodoro på
 * 5 og en på 50 minutter begge er én gennemført session. At tælle minutter
 * ville få en uge med én lang tirsdag til at se travl ud.
 */
type UgeRække = Pick<PomodoroDag, "day" | "sessions">;

/**
 * De `antal` seneste kalenderdage frem til i dag, som en uge-stribe.
 *
 * `get_pomodoro_stats` grupperer på `day` og returnerer **kun de dage der har
 * data** — en dag uden pomodoros har ingen række og kommer derfor ikke med i
 * svaret. Uden at fylde hullerne ud viser striben mandag, tirsdag og så
 * springer den til torsdag, så brugeren ikke kan se om han holdt en pause eller
 * bare ikke arbejdede den dag. Derfor fanges hver dato op og nul-stribes den,
 * så alle `antal` kolonner findes — en tom søjle er data, ikke en mangel.
 *
 * `iDag` er dagens række og er altid med i svaret (`stats_core`), så dagens
 * kolonne behøver ikke gættes. Den bruges dog kun hvis `dage` ikke allerede
 * indeholder den: ellers ville dagens sessioner tælles to gange, fordi
 * `GROUP BY day` og `i_dag` er det samme tal to steder.
 *
 * **Ugen regnes fra `idag`, som er kallerens egen dato — ikke fra svaret.**
 * `get_pomodoro_stats` svarer med den dag *den* kommando læste, og det er et
 * billede af virkeligheden klokken da den blev kaldt. Låner man dagens dato
 * derfra, hænger striben fast i de syv dage den blev hentet: brugeren
 * gennemfører en pomodoro kl. 23.59, svaret rummer både gårsdags række og
 * dagens, og striben markerer dagens række som om **den** var i dag — to
 * kolonner med samme dato, og et antal der ikke passer med tælleren lige over
 * striben. Derfor er dagens dato et argument: `PomodoroUgeStribe` giver den
 * fra `toLocalDateStr(new Date())`, så et forældet svar ikke kan flytte
 * markeringen — det kan kun vise forældede *tal*, hvilket
 * `genindlæsHvisNyDag` i store'en rydder op med.
 *
 * `højde` er relativ til ugeens bedste dag, så en uge med 2 og 20 pomodoros er
 * lige så læsbar som en med 3 og 4. Uden det fylder den største søjle hele
 * boksen, og de små forsvinder i et par pixel.
 */
export function ugeStribe(
  dage: readonly UgeRække[],
  iDag: UgeRække | null,
  antal: number,
  navnFor: (day: string) => string,
  idagIUr: string,
): UgeDag[] {
  const dageAntal = Math.max(1, Math.trunc(antal));

  // Samme dato kan komme flere gange, hvis en backup har skrevet den samme
  // pomodoro to gange med forskelligt id. Summerer man ikke, tæller striben
  // færre end dagens linje lige over den gør.
  const sum = new Map<string, number>();
  for (const række of dage) {
    sum.set(række.day, (sum.get(række.day) ?? 0) + række.sessions);
  }
  if (iDag && !sum.has(iDag.day)) sum.set(iDag.day, iDag.sessions);

  // **Ankret fra ét sted.** `sidsteDatoer` kan falde tilbage på klokken, hvis
  // kallerens dato er i et format vi ikke kan læse — og så ville `erIDag`
  // stadig sammenligne mod den ubrugelige streng, så ingen af de syv kolonner
  // ville være markeret som i dag. Det er dagens *dato* der skal markeres, så
  // den hentes herfra og bruges både til at regne fra og til at sammenligne.
  const idag = gyldigDato(idagIUr) ?? toLocalDateStr(new Date());
  const datoer = sidsteDatoer(idag, dageAntal);
  const højst = Math.max(1, ...datoer.map((d) => sum.get(d) ?? 0));

  return datoer.map((day) => ({
    day,
    sessions: sum.get(day) ?? 0,
    erIDag: day === idag,
    navn: navnFor(day),
    højde: (sum.get(day) ?? 0) / højst,
  }));
}

/**
 * Datoen i sig selv, hvis den er `ÅÅÅÅ-MM-DD`, ellers `null`.
 *
 * Tricket er at **formatere den tilbage og sammenligne**. En tjek som blot
 * spørger «er alle tre tal positive heltal» fanger ikke `30-09-2026`, for det
 * er tre positive heltal — og `new Date(2026, 8, 30)` giver den 30. august
 * 2026, som er en fuldt gyldig dato. Runde-turen fanger også den umiddelbart
 * åbenlyse `2026-02-30`: den formatteres til `2026-03-02` og afvises.
 *
 * Uden tjekket skrev `toLocalDateStr` «NaN-NaN-NaN» i alle syv kolonner — eller
 * med en sådan streng en stribe sluttende i 2032 — uden at nogle kastede. En
 * backup med et andet datoformat må ikke slå hele stribens rytme ihjel, men
 * må heller ikke *lade som om* den ved noget: den ubrugelige dag tages ikke med
 * i opgøret, og `day` forbliver den den række har — så den ses som den dag uden
 * pomodoros den er.
 */
export function gyldigDato(dagIso: string | undefined): string | null {
  if (!dagIso) return null;
  const [y, m, d] = dagIso.split("-").map(Number);
  if (![y, m, d].every((n) => Number.isInteger(n) && n > 0)) return null;
  return toLocalDateStr(new Date(y, m - 1, d)) === dagIso ? dagIso : null;
}

/**
 * De `antal` kalenderdage der ender på `dagIso`, ældst først.
 *
 * Datoen bygges med det eksplicitte `Date(y, m, d)`-kald, **ikke** ved at læse
 * en ISO-streng: `new Date("2026-09-30")` tolkes som UTC-midnat og er derfor
 * dagen *før* i alle tidszoner vest for Greenwich — præcis den forskydning
 * `toLocalDateStr` findes for at undgå. Tæller man så bagud, får man de
 * rigtige kalenderdage, også over en måneds- eller årsskifte hvor «30 minus 7»
 * slet ikke er en dato.
 *
 * `dagIso` kommer fra `gyldigDato`, så den er her allerede læsbar — derfor
 * behøver denne funktion ingen egen tjek, og må ikke have en: en `Invalid Date`
 * her ville give «NaN-NaN-NaN», som hverken er en dato eller en fejl.
 */
function sidsteDatoer(dagIso: string, antal: number): string[] {
  const [y, m, d] = dagIso.split("-").map(Number);
  const ud: string[] = [];
  for (let n = antal - 1; n >= 0; n--) {
    ud.push(toLocalDateStr(new Date(y, m - 1, d - n)));
  }
  return ud;
}

/**
 * Højden af én søjle i procent af boksen.
 *
 * En dag med pomodoros får aldrig under `MIN_SØJLE` procent. Uden bunden
 * forsvinder den dags søjle i en brøkdel af en pixel: en uge med 1 pomodoro
 * om dagen og en enkelt lang tirsdag ville vise seks tomme dage og ét
 * næsten-usynligt glimt, altså modsat af det striben skal formidle. **Nul
 * forbliver nul** — en tom søjle skal kunne *ligne* en tom søjle, ellers er
 * dagen uden pomodoros og dagen med én ikke til at skelne fra.
 */
const MIN_SØJLE = 8;

/** `UgeDag` → procent af stribens højde, 0–100. */
export function søjlePct(dag: UgeDag): number {
  if (dag.sessions <= 0) return 0;
  // NaN fanges her, ikke af `Math.max`/`Math.min`: begge returnerer NaN for
  // NaN, så klemmen alene ville gennemlade en højde, der ikke er et tal. I en
  // inline-style ligner NaN slet ikke en søjle — den forsvinder uden fejl.
  if (!Number.isFinite(dag.højde)) return MIN_SØJLE;
  const pct = Math.round(dag.højde * 100);
  return Math.max(MIN_SØJLE, Math.min(100, pct));
}

/** Tæller kun bruges i reservesagen. */
let fallbackTæller = 0;

/**
 * Et id til den igangværende arbejdsfase.
 *
 * `crypto.randomUUID` er det normale og bruges når det findes. **Fallback'en
 * er ikke kosmetik:** `randomUUID` kræver en webview fra ca. 2022 (Safari
 * 15.4, Chromium 92), og Tauri 2 kører på systemets egen webview. Kaster den,
 * og kaldet sker *efter* at timeren er sat til at køre, så `setInterval` aldrig
 * sættes op: uret står på sit fulde tal, knappen siger «Pause», og ingen
 * tikker. Brugeren arbejder i 25 minutter på et ur der ikke kører — præcis
 * det tab af registreret tid, missionen siger aldrig må ske, her i en viste
 * der *ser* ud til at virke.
 */
export function nyFaseId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  fallbackTæller += 1;
  return `pomo-${Date.now().toString(36)}-${fallbackTæller.toString(36)}`;
}

/** Én gennemført arbejdsfase, som `list_pomodoro_sessions` svarer med. */
export interface PomodoroFase {
  id: string;
  day: string;
  minutes: number;
  /** Lokal væg-tid, `YYYY-MM-DDTHH:MM:SS` — samme form som `Activity.started_at`. */
  started_at: string;
  ended_at: string;
  /**
   * Er fasens minutter allerede bogført som tid?
   *
   * Rust spørger `time_entries`, ikke fasedata, så sandheden er den
   * registrering brugeren lavede. Uden markeringen så en registreret fase og
   * den tid den blev til som to rækker for de samme 25 minutter, og ingen af
   * dem sagde at det var det samme arbejde. En slettet registrering gør
   * markeringen væk igen, så fasen kan registreres på ny.
   */
  registreret: boolean;
}

/**
 * Én række i dagens tidslinje: enten en pomodoro-fase eller et aktivitetsblok.
 *
 * Faserne **ligger i deres egen liste**, ikke blandet ind i blokkene: en fase
 * er ikke en aktivitet, den har ingen app, intet projekt og intet at bekræfte,
 * så at flette den ind i `ActivityBlock`-formen ville få den til at arve
 * `projectId: null` og `key: "a: "` og dermed se ud som en tom aktivitet i
 * dagens overskrift.
 */
export type TidslinjeRække =
  | { slags: "fase"; fase: PomodoroFase }
  | { slags: "blok"; blok: ActivityBlock };

/**
 * Faserne placeret mellem aktivitetsblokkene i dagens række.
 *
 * Rækkefølgen regnes på **starttidspunktet**, ikke på sluttidspunktet: en fase
 * der startede kl. 09.00 og sluttede 09.25 skal stå før et blok der begyndte
 * 09.10, ellers læser dagen som om brugeren først arbejdede i blokket. Blokkene
 * kommer ind i den række, de har — de er allerede sorteret af
 * `mergeActivitiesIntoBlocks`, og de skal ikke flyttes: en fase der starter
 * midt i en samlet blok skal ikke splitte den i to.
 *
 * Bloker sluttende kl. 08.00 og en fase kl. 09.00–09.25 giver to rækker, fordi
 * de ikke overlapper. Overlapper de — brugeren kørte en pomodoro mens han
 * skrev i sit projekt — står fasen **før** blokket, så dagen læses som
 * «jeg startede med pomodoroen og fortsatte i det samme». Det er den rækkefølge
 * `K61`'s registrering skriver i, så linjen og den gemte tid siger det samme.
 *
 * Faser uden læsbart starttidspunkt taber denne funktion **ikke**: de bliver i
 * listen og havner sidst. Rust springer dem over ved læsningen
 * (`sessioner_for_dag_core`), så vejen er lukket to steder — men en dags
 * overskrift skal ikke tie om en fase den ikke kan placere, og at tegne den
 * med `NaN`-start ville sende den til `Invalid Date`.
 */
export function fletPomodoroInd(
  blokke: readonly ActivityBlock[],
  faser: readonly PomodoroFase[],
): TidslinjeRække[] {
  const rækker: TidslinjeRække[] = blokke.map((blok) => ({
    slags: "blok" as const,
    blok,
  }));
  for (const fase of faser) {
    rækker.push({ slags: "fase", fase });
  }

  const start = (række: TidslinjeRække): number => {
    const rå =
      række.slags === "fase" ? række.fase.started_at : række.blok.startedAt;
    const ms = new Date(rå).getTime();
    // NaN i en sortering er ikke «behald rækkefølgen» — `Array.sort` med en
    // comparator der giver NaN afgiver implementationsdefineret adfærd, og i
    // V8 lander påkræftelige rækker i praksis forrest til sidst. Sættes
    // utydeligt højt i stedet, er rækkefølgen deterministisk.
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
  };

  // `sort` er stabil i alle browsere appen kører på, så to blokke med samme
  // starttidspunkt beholder den rækkefølge `mergeActivitiesIntoBlocks` gav dem.
  // En fase der starter i samme minut som et blok kommer **efter** det, fordi
  // blokkene skubbes ind først: det er vilkårligt, men *fast* vilkårligt — en
  // fase der hoppede rundt mellem renders ville få dagens linje til at tegne sig
  // om ved hver genindlæsning.
  return rækker.sort((a, b) => start(a) - start(b));
}

/** En afsluttet arbejdsfase, som brugeren kan vælge at registrere som tid. */
export interface FeerdigFase {
  /** Hvornår perioden begynder — et lokalt væg-tidsstempel, klar til `create_time_entry`. */
  start: string;
  /** Hvornår perioden slutter. Altid senere end `start`. */
  slut: string;
  /** Sekunder. Afledt fra perioden, så den ikke kan modsige de to tidsstempler. */
  varighed: number;
}

/**
 * En afsluttet fase **med sit id** — altså den samme nøgle `pomodoro_sessions`
 * har rækken under.
 *
 * Uden id'et kan registreringen ikke pege på den fase den kom fra, og så kan
 * tidslinjen ikke vide at dens minutter allerede er bogført: rækken ville stå
 * der som en pomodoro uden at sige, at dens tid også står i ugeoversigten.
 */
export interface BogførbarFase extends FeerdigFase {
  /** Samme id som den skrevne `pomodoro_sessions`-række. */
  id: string;
}

/**
 * Gør en afsluttet arbejdsfase til den periode, `create_time_entry` gemmer.
 *
 * **Perioden bygges baglæns fra `slut`.** Fasen *sluttede* klokkeslaget, så
 * det er det ene tidspunkt brugeren kan genkende; starttidspunktet følger af
 * fasens lengde. Gik det den anden vej — start fra et klokkeslæt og slut `nu`
 * — så fik en pause i en fase lavet en omvendt registrering, fordi uret stod
 * stille mens brugeren var væk, og `duration` ville have sagt 25 minutter for
 * et interval på nul.
 *
 * Varigheden er fasens **konfigurerede** længde, ikke den målte: en pomodoro er
 * 25 minutter arbejde uanset hvornår uret tikkede. En bruger der gik til kaffe
 * i pausefasen har ikke arbejdet i 27 minutter, og en der lagde vinduet
 * ubemærket i timevis har ikke arbejdet i 85.
 */
export function fasePeriode(slut: Date, minutter: number): FeerdigFase | null {
  const varighed = Math.round(minutter) * 60;
  if (varighed <= 0) return null;
  return {
    start: toLocalDateTimeStr(new Date(slut.getTime() - varighed * 1000)),
    slut: toLocalDateTimeStr(slut),
    varighed,
  };
}
