import { create } from "zustand";
import { toLocalDateStr } from "@/lib/format";
// Importerer også siden modulet, der initialiserer i18next — uden det kan
// `i18n.t` i notifikationen svare en rå nøgle, hvis store'en nås fra en test
// eller et tidligt kald, før main.tsx er kørt.
import i18n from "@/lib/i18n";
import {
  type BogførbarFase,
  configChanged,
  currentRunde,
  DEFAULT_POMODORO_CONFIG,
  fasePeriode,
  gyldigDato,
  modeSeconds,
  nextPhase,
  normalizeConfig,
  nyFaseId,
  type PomodoroConfig,
  type PomodoroMode,
  progress,
  remainingSeconds,
} from "@/lib/pomodoro";
import { tauriInvoke } from "@/lib/tauri";
import { createTimeEntry } from "@/lib/timeEntryActions";
import type { PomodoroStats } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface PomodoroState {
  mode: PomodoroMode;
  /** Sekunder tilbage i den kørende fase. */
  timeRemaining: number;
  sessionsCompleted: number;
  isRunning: boolean;
  config: PomodoroConfig;
  /** Kun sand mellem den sidste fase skifter og React har tegnet den nye
   *  fase — bruges til at fortætte én gang, ikke en gang i sekundet. */
  netopSkiftet: boolean;
  /** Dagens pomodoro-tal fra databasen. `null` indtil det er hentet. */
  stats: PomodoroStats | null;
  /** Hvilken del af dagens tal der fejlede — `null` når alt er i orden.
   *
   *  De to fejl er ikke det samme for brugeren. En fejl i **hentningen**
   *  betyder at tallet er ukendt, og «prøv igen» kan hente det igen. En fejl
   *  i **skrivningen** betyder at pomodoroen ikke blev talt: tallet er ikke
   *  ukendt, det er *forkert*, og intet genindlæser det — så en knap der
   *  henter igen ville stå og hente det samme tal og lade som om det hjalp.
   *
   *  Uden skelnen sagde skærmbilledet «Kunne ikke hente dagens pomodoros»
   *  efter en skrivningsfejl, altså at *hentningen* fejlede. Samme slags
   *  fejl som kvalitetslistens punkt 8 beskriver: 202 og en endelig fejl må
   *  ikke se ens ud. */
  statsFejl: "hentning" | "skrivning" | null;
  /** Hvilken kalenderdag de hentede tal beskriver — `stats.i_dag.day`, eller
   *  `null` hvis de ikke er hentet (eller svaret med et ubrugeligt format).
   *
   *  Uden den kunne UI'et ikke vide om tallene over et døgnskifte stadig
   *  handler om i dag. Det er ikke en kosmetisk dato: `get_pomodoro_stats`
   *  læser `day <= idag`, så et svar fra i går rummer gårsdags række, og
   *  uden denne tæller striben den pomodoro to gange over et døgnskifte. */
  statsDag: string | null;
  /** Den seneste **gennemførte** arbejdsfase, brugeren kan registrere som tid.
   *
   *  `null` når der ikke er noget at vælge: ingen fase er afsluttet endnu, den
   *  er springet over, eller den er allerede registreret. **En sprang-over fase
   *  sætter den ikke** — brugeren afbrød den efter ti sekunder, og en
   *  tidsregistrering på ti sekunder er ikke pomodoros tid.
   *
   *  Den *kun* tilbydes. Auto-registrering ville skrive tid brugeren ikke bad
   *  om, og missionen siger at tabt tid er den værste fejl — en tid der
   *  opstår uden et menneskes valg er ikke det modsatte, den er bare skjult. */
  klarFase: BogførbarFase | null;
  /** En registrering af den afsluttede fase er i luften — låser knappen.
   *
   *  Dobbeltklikket dækkes af **to** uafhængige ting, og det er målt at begge
   *  er nødvendige: `createTimeEntry`s egen lås (et tredje klik mens skrivningen
   *  er i luft får `false`), og `klarFase` der forsvinder ved succes (et klik
   *  *efter* at svaret kom). Denne lås dømmer ingen af dem rødt — den låser
   *  UI'et, ikke antallet af skrivninger: uden den holdt feltet og knappen åbne
   *  under en skrivning, så et dobbelttryk så ud til ikke at virke. */
  registrerer: boolean;
  /** Fejlen ved at registrere den afsluttede fase som tid.
   *
   *  Der er kun én slags fejl her, og den er aldrig «ukendt tall»: skriver
   *  `create_time_entry` fejl, er tiden **ikke** bogført, og tilbuddet står
   *  stadig, så «prøv igen» prøver præcis det samme minut igen. */
  faseFejl: boolean;

  start: () => void;
  pause: () => void;
  skip: () => void;
  reset: () => void;
  acknowledgeShift: () => void;
  loadConfig: () => Promise<void>;
  saveConfig: (config: PomodoroConfig) => Promise<void>;
  loadStats: () => Promise<void>;
  /** Genindlæser, men kun hvis de nuværende tal ikke længere er fra i dag.
   *
   *  Uden denne tjek ville kaldet ske på hvert tik og på hvert focus, så
   *  dagens tæller ville stå og skrive til databasen hele aftenen. */
  genindlæsHvisNyDag: () => void;
  /** Registrerer den afsluttede fase som én tidsregistrering for `clientId`.
   *
   *  Kunden er påkrævet: uden en kunde er tiden ikke fakturerbar, og en
   *  stribel af sådanne registreringer er værre end ingen. */
  registrerFase: (clientId: string) => Promise<void>;
}

/**
 * Hvornår den kørende fase slutter, i millisekunder siden epoken.
 *
 * Resttiden regnes herfra ved hvert tik, ikke ved at trække én fra — en skjult
 * fane får `setInterval` til at tikke langsommere, og en pomodoro må ikke blive
 * længere, fordi brugeren har ladet vinduet stå. Se `remainingSeconds`.
 */
let slutterOm = 0;

/** Hvor ofte der tegnes. Én gang i sekundet er nok for et mm:ss-tal. */
const TIK_MS = 1000;

let tickInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Id'et på den igangværende arbejdsfase.
 *
 * Bevar fra det øjeblik brugeren trykker start, til skrivningen er sket — så
 * er den samme række skrevet, uanset om fase-skiftet bliver kaldt en eller to
 * gange. Det er derfor kommandoen tager id'et: en pomodoro-tæller der kan tælle
 * den samme session to gange er værre end ingen tæller, for brugeren stoler på
 * den. Tom streng = der løber ingen arbejdsfase.
 */
let igangværendeFaseId = "";

/** Hvor mange dage bagud der læses. Vist som en uge på dashboardet. */
const STATS_DAGE = 7;

function stopTicking() {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

/**
 * Notificerer fase-skiftet.
 *
 * Kalder Rust-kommandoen, der bruger den notification-plugin resten af appen
 * bruger. `window.Notification` blev brugt før, men i Tauri-vinduet er
 * tilladelsen ofte "default", så notifikationen forsvinder stille. Fejler
 * kaldet, får brugeren en toast i stedet for at vente på noget der ikke kommer.
 */
function notifyFaseSkift(forrige: PomodoroMode, næste: PomodoroMode) {
  // Beskeden følger den fase brugeren forlod. En notifikation der læser
  // "Tid til en kort pause", mens en pause er slut og arbejdet begynder, er
  // værre end ingen notifikation.
  const fraArbejde = forrige === "work";
  tauriInvoke("notify", {
    title: i18n.t(fraArbejde ? "pomodoro.phaseDone" : "pomodoro.breakDone"),
    body: i18n.t(
      fraArbejde
        ? næste === "longBreak"
          ? "pomodoro.longBreakBody"
          : "pomodoro.shortBreakBody"
        : "pomodoro.breakDoneBody",
    ),
  }).catch(() => {
    toast.error(i18n.t("pomodoro.notificationFailed"));
  });
}

/**
 * Tæller én gennemført arbejdsfase i databasen.
 *
 * Kaldt fra `skiftFase`, men kun når den fase der forlod, var en **udløbet**
 * arbejdsfase. En pause er ikke arbejde, og «spring over» er heller ikke
 * arbejde: brugeren afbrød den efter ti sekunder, og en tæller der siger «1
 * pomodoro i dag» for det er ubrugelig — den er præcis det, K25f's formaterings-
 * fejl var, bare værre, fordi tallet ligner en sandfærdighed.
 *
 * `nextPhase` tælder en sprungen fase som gennemført, og det er rigtigt der:
 * ellers kunne man springe over tre korte pauser og få den lange uden at have
 * arbejdet. Det er et spørgsmål om rytmen i cyklussen, ikke om hvor meget
 * brugeren har arbejdet — de to skal ikke blandes.
 *
 * Skrivningen er ikke awaitet — timeren skal ikke stå og vente på en database,
 * mens brugeren ser en pause begynde — men tallet genindlæses bagefter, så en
 * fejl ikke efterlader skærmen med et gammelt tal.
 *
 * Fejlen sætter `statsFejl` til **«skrivning»** og **beholder** det gamle tal.
 * Den forkerte metode — at sætte `stats: null` — er præcis den løgn resten af
 * K48a lukkede: null er «endnu ikke hentet» og «hentet og ingenting» på én
 * gang, så skærmen viser «0 pomodoros i dag» for en database der ikke svarede.
 */
function skrivArbejdsfase(
  set: (partial: Partial<PomodoroState>) => void,
  get: () => PomodoroState,
) {
  const id = igangværendeFaseId;
  const minutes = get().config.work_minutes;
  // Feltet nulstilles FØR kaldet, så en fejl ikke kan få samme fase skrevet igen
  // ved næste fase-skift.
  igangværendeFaseId = "";
  if (!id) return;

  // Tilbuddet til tidsregistrering laves her, uafhængigt af om skrivningen til
  // `pomodoro_sessions` lykkes: de to er forskellige vilkår. Brugeren kan have
  // fået en fejl på tælleren og stadig have arbejdet i 25 minutter, og så
  // skal tiden stadig kunne bogføres — eller omvendt.
  // Id'et er en del af tilbuddet, ikke en bagefter tilføjet ting: uden det kan
  // registreringen ikke pege på den fase den kom fra, og tidslinjens række kan
  // ikke vide at dens minutter allerede står i ugeoversigten.
  const periode = fasePeriode(new Date(), minutes);
  set({ klarFase: periode ? { ...periode, id } : null });

  tauriInvoke("record_pomodoro_session", { id, minutes })
    .then(() => get().loadStats())
    .catch(() => {
      // Tallet er det, brugeren stoler på, så en fejl må ikke tie. **Denne
      // pomodoro blev ikke talt** — id'et er nulstillet, så den kan ikke
      // genforsøges ved næste fase-skift, og brugeren skal derfor få det at
      // vide. Derfor «skrivning» og ikke «hentning»: tallet er ikke ukendt,
      // det er for lavt, og «prøv igen» ville hente det samme tal igen.
      set({ statsFejl: "skrivning" });
    });
}

export const usePomodoroStore = create<PomodoroState>()((set, get) => {
  /** Går til næste fase, og fortæller brugeren om det.
   *
   * `udløb` skiller en fase der **sluttede af sig selv** fra en brugeren sprang
   * over. Uden det ville dagens tæller kunne tælle en fase på ti sekunder. */
  function skiftFase(gs: () => PomodoroState, udløb: boolean) {
    const state = gs();
    const { mode: næste, sessionsCompleted } = nextPhase(
      state.mode,
      state.sessionsCompleted,
      state.config,
    );
    stopTicking();
    slutterOm = 0;
    set({
      mode: næste,
      timeRemaining: modeSeconds(næste, state.config),
      sessionsCompleted,
      isRunning: false,
      netopSkiftet: true,
    });
    if (state.mode !== "idle") notifyFaseSkift(state.mode, næste);
    // Kun en fase der **udløb** tæller. `skip` går også gennem her, og en
    // fase brugeren sprang over efter ti sekunder er ikke en pomodoro.
    if (state.mode === "work") {
      if (udløb) skrivArbejdsfase(set, get);
      // Id'et ryddes ALTID ved en arbejdsfasens afslutning, også når den
      // afbrudtes. Ellers arvede den næste pomodoro det samme id, og
      // `INSERT OR IGNORE` ville afvise den — brugeren ville miste en ægte
      // session i dagens tal for at have trykket «spring over» en gang.
      else igangværendeFaseId = "";
    }
  }

  function startTicking(onTick: () => void) {
    stopTicking();
    tickInterval = setInterval(onTick, TIK_MS);
  }

  return {
    mode: "idle",
    timeRemaining: modeSeconds("idle", DEFAULT_POMODORO_CONFIG),
    sessionsCompleted: 0,
    isRunning: false,
    config: DEFAULT_POMODORO_CONFIG,
    netopSkiftet: false,
    stats: null,
    statsFejl: null,
    statsDag: null,
    klarFase: null,
    registrerer: false,
    faseFejl: false,

    start: () => {
      const state = get();

      // En pause, der ikke kører, starter med sin fulde længde igen — ellers
      // ville "start" på en delvist brugt pause tælle videre fra nul.
      const mode: PomodoroMode = state.mode === "idle" ? "work" : state.mode;
      const timeRemaining =
        state.isRunning || state.timeRemaining > 0
          ? state.timeRemaining
          : modeSeconds(mode, state.config);

      set({ mode, timeRemaining, isRunning: true, netopSkiftet: false });
      slutterOm = Date.now() + timeRemaining * 1000;
      // Id'et dannes her, ikke ved fase-skiftet: en pause der forlader en
      // arbejdsfase skal kunne skrive præcis den fase, der blev arbejdet på.
      // Genstartes en igangværende fase efter en pause beholder den sit id.
      if (!igangværendeFaseId) igangværendeFaseId = nyFaseId();

      startTicking(() => {
        const current = get();
        if (!current.isRunning) return;

        const rest = remainingSeconds(slutterOm, Date.now());

        if (rest <= 0) {
          skiftFase(() => current, true);
          return;
        }
        set({ timeRemaining: rest });
      });
    },

    pause: () => {
      // Resttiden skrives ned, så en pause der kører fortryder præcis det den
      // nåede — ikke et helt tik mere.
      if (get().isRunning) {
        set({ timeRemaining: remainingSeconds(slutterOm, Date.now()) });
      }
      stopTicking();
      slutterOm = 0;
      set({ isRunning: false });
    },

    skip: () => {
      // Knappen er deaktiveret i `idle`, men et tastaturkald eller et
      // fremtidigt genvejskald må ikke tælle en session, brugeren ikke
      // arbejdede på. Uden denne tjek ville tre spring-over give den lange
      // pause med nul gennemførte sessioner.
      if (get().mode === "idle") return;
      skiftFase(get, false);
    },

    reset: () => {
      stopTicking();
      slutterOm = 0;
      // En nulstilling afbryder den igangværende fase. Uden denne nulstilling
      // skrev næste start det gamle id igen, og den afbrudte fase ville blive
      // talt med i dagens sum.
      igangværendeFaseId = "";
      set({
        mode: "idle",
        timeRemaining: 0,
        sessionsCompleted: 0,
        isRunning: false,
        netopSkiftet: false,
      });
    },

    acknowledgeShift: () => set({ netopSkiftet: false }),

    loadConfig: async () => {
      try {
        const rå = await tauriInvoke<Partial<PomodoroConfig>>(
          "get_pomodoro_config",
        );
        set({ config: normalizeConfig(rå) });
      } catch {
        // En kasseret gemt konfiguration må ikke hænge timeren — standarden
        // er brugbar, og brugeren kan rette den i indstillingerne.
        set({ config: DEFAULT_POMODORO_CONFIG });
      }
    },

    saveConfig: async (config: PomodoroConfig) => {
      const gyldig = normalizeConfig(config);

      // Gem kun en reel ændring. Ellers skriver hvert klik i indstillings-
      // vinduet en ny række i settings-tabellen for det samme.
      if (!configChanged(get().config, gyldig)) {
        set({ config: gyldig });
        return;
      }

      set({ config: gyldig });
      try {
        await tauriInvoke("set_pomodoro_config", { config: gyldig });
        toast.success(i18n.t("pomodoro.saved"));
      } catch {
        toast.error(i18n.t("pomodoro.saveFailed"));
      }
    },

    loadStats: async () => {
      try {
        const stats = await tauriInvoke<PomodoroStats>("get_pomodoro_stats", {
          dage: STATS_DAGE,
        });
        set({
          stats,
          statsFejl: null,
          statsDag: gyldigDato(stats?.i_dag?.day),
        });
      } catch {
        // Bevidst IKKE `stats: null` med en fejl til følge: null er det samme
        // som «endnu ikke hentet», og skærmen ville vise «0 pomodoros i dag».
        // `statsDag` beholdes også: et gammelt svar er stadig det bedste vi
        // ved, og nulstilles den, ville et gammelt tal se ud som om det var
        // hentet lige nu — altså som om dagen var skredt. Fejlen i sig selv er
        // brugerens vej til at prøve igen.
        set({ statsFejl: "hentning" });
      }
    },

    genindlæsHvisNyDag: () => {
      const { statsDag } = get();
      // `null` betyder «aldrig hentet» — og «hentet med et ubrugeligt datoformat»,
      // som `gyldigDato` også giver `null` for. Begge skal hentes igen, for i
      // det første ved vi intet, i det andet ved vi ikke hvilken dag vi har.
      if (statsDag !== null && statsDag === toLocalDateStr(new Date())) return;
      void get().loadStats();
    },

    registrerFase: async (clientId: string) => {
      const { klarFase, registrerer } = get();
      if (!klarFase || registrerer) return;
      // Knappen er død uden kunde, så dette kan ikke nås fra UI'et — men en
      // tom streng ville blive skrevet som `client_id = ''`, og den joiner til
      // ingen kunde. Den er ikke NULL, så hverken synken eller rapporten kan
      // skelne den fra en rigtig kunde. Uden kunde er tiden ikke fakturerbar.
      if (clientId === "") return;

      set({ registrerer: true, faseFejl: false });
      try {
        const gemt = await createTimeEntry({
          project_id: null,
          client_id: clientId,
          klippekort_id: null,
          description: i18n.t("pomodoro.faseDescription"),
          start_time: klarFase.start,
          end_time: klarFase.slut,
          duration: klarFase.varighed,
          is_billable: true,
          pomodoro_session_id: klarFase.id,
        });
        if (!gemt) {
          // Låsen i `timeEntryActions` var holdt af en anden skrivning, så
          // **denne** pomodoro er ikke bogført. Tilbuddet bliver stående, så
          // brugeren kan prøve igen i stedet for at mellem tiden have mistet
          // 25 minutter.
          set({ faseFejl: true });
          return;
        }
        // Kun her forsvinder tilbuddet. At tage det væk før kaldet ville
        // slette den eneste spor brugeren har til at prøve igen efter en fejl.
        set({ klarFase: null, faseFejl: false });
        toast.success(i18n.t("pomodoro.faseRegistered"));
      } catch {
        // Skrivefejl: tiden er **ikke** bogført, og tilbuddet står stadig, så
        // «prøv igen» bogfører præcis det samme minut. Skærmen skal sige
        // «ikke bogført» og ikke «nogen fejl» — punkt 8 i kvalitetslisten.
        set({ faseFejl: true });
      } finally {
        set({ registrerer: false });
      }
    },
  };
});

/** Værdier UI'et tegner fra — én kilde, så de ikke kan komme i drift. */
export function usePomodoroView() {
  const mode = usePomodoroStore((s) => s.mode);
  const timeRemaining = usePomodoroStore((s) => s.timeRemaining);
  const sessionsCompleted = usePomodoroStore((s) => s.sessionsCompleted);
  const isRunning = usePomodoroStore((s) => s.isRunning);
  const config = usePomodoroStore((s) => s.config);

  return {
    mode,
    timeRemaining,
    sessionsCompleted,
    isRunning,
    config,
    progress: progress(timeRemaining, mode, config),
    runde: currentRunde(mode, sessionsCompleted, config),
  };
}
