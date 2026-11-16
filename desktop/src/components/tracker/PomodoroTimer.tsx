import {
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { toLocalDateStr } from "@/lib/format";
import {
  CONFIG_LIMITS,
  formatPhaseTime,
  type PomodoroConfig,
} from "@/lib/pomodoro";
import { usePomodoroStore, usePomodoroView } from "@/stores/pomodoroStore";
import { PomodoroFaseRegistrering } from "./PomodoroFaseRegistrering";
import { PomodoroUgeStribe } from "./PomodoroUgeStribe";

/** Ringens og knappens farve pr. fase. Brug kun tematokens — en rå
 *  `stroke-red-500` er ikke læsbar i mørk tilstand og kan ikke følge et
 *  fremtidigt temaskift. */
const MODE_TOKENS: Record<string, string> = {
  work: "var(--color-accent)",
  shortBreak: "var(--color-pause)",
  longBreak: "var(--color-long-pause)",
  idle: "var(--color-border)",
};

/** 176 px, så ringen + padding passer i 360 px bredde uden vandret scroll. */
const SIZE = 176;
const STROKE = 6;

export function PomodoroTimer() {
  const { t } = useTranslation();
  const { mode, timeRemaining, isRunning, config, progress, runde } =
    usePomodoroView();
  const {
    start,
    pause,
    skip,
    reset,
    loadConfig,
    saveConfig,
    loadStats,
    stats,
    statsFejl,
    statsDag,
    genindlæsHvisNyDag,
  } = usePomodoroStore();

  const [visIndstillinger, setVisIndstillinger] = useState(false);
  const [udkast, setUdkast] = useState<PomodoroConfig>(config);
  const udkastfelter = useRef<HTMLDivElement>(null);

  /**
   * Dagens kalenderdato, holdt i state — ikke læst ved hver tegning alene.
   *
   * React tegner kun når state ændrer sig, så en dato læst direkte i kroppen
   * bliver stående som gårsdags dato indtil *noget* udløser en tegning. Det er
   * præcis fejlen: over et døgnskifte stod gårsdags tal som «i dag» i op til et
   * minut, fordi intet ændrede sig. State gør dagen til en hændelse, så skærmen
   * holder op med at vise et tal der ikke er fra i dag, så snart klokken siger
   * det — uden at vente på at indlæsningen er færdig.
   */
  const [idag, setIdag] = useState(() => toLocalDateStr(new Date()));

  /** Handler de hentede tal om i dag, som klokken siger? */
  const statsErIdag = statsDag !== null && statsDag === idag;

  useEffect(() => {
    loadConfig();
    loadStats();
  }, [loadConfig, loadStats]);

  // Dagens tal og uge-striben er et billede af klokken da de blev hentet.
  // `get_pomodoro_stats` læser `day <= idag`, så et svar fra i går rummer
  // gårsdags række *og* dagens, og striben ville vise den pomodoro to gange
  // over et døgnskifte. Genindlæsningen sker derfor på to måder:
  //
  //  - **Ved midnat.** Ét `setInterval` der spørger hvert minut, hvilket er
  //    nok til at ramme døgnskiftet inden for et minut. Uret er bevidst ikke
  //    sat til næste midnat: `setTimeout` med et kæmpeligt interval er
  //    unøjagtigt på en maskine der sov, og en bærbar der lå lukket ville
  //    slet ikke vågne af det.
  //  - **Når vinduet bliver synligt igen.** Det dækker bærbaren der stod
  //    lukket over natten, og det er samme hændelse `main.tsx` bruger til at
  //    synke igen — altså et mønster appen allerede har.
  useEffect(() => {
    const genindlæs = () => {
      if (document.visibilityState === "hidden") return;
      // Dagen skifter **før** der hentes, så et gammelt tal forsvinder med det
      // samme og ikke står en indlæsning endnu.
      setIdag(toLocalDateStr(new Date()));
      genindlæsHvisNyDag();
    };
    const id = setInterval(genindlæs, 60_000);
    document.addEventListener("visibilitychange", genindlæs);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", genindlæs);
    };
  }, [genindlæsHvisNyDag]);

  useEffect(() => {
    setUdkast(config);
  }, [config]);

  // `p` starter og slutter pomodoroen — samme skift som knappen ovenfor,
  // læst fra store'en i stedet for fra props, så genvejen ikke kan ramme en
  // `isRunning` fra en tidligere tegning.
  //
  // Værterne er de samme som `?`-genvejen i `CommandPalette`, og de er ikke
  // overflødige: `p` står i et brugerfelt lige så tit som `?`, og en dialog
  // kan ligge åben oven på dashboardet hvor timeren stadig er monteret. Uden
  // tjekket ville `p` i «Ny registrering» starte en pomodoro bagved en dialog
  // brugeren ikke kan se, og Ctrl+P er browserens egen print — den tages derfor
  // ikke.
  useEffect(() => {
    // Indstillingspanelet er en `<section>`, ikke en dialog, så tjekket for
    // åbne dialoger fanger det ikke. Genvejen skal ikke løbe bag panelet.
    if (visIndstillinger) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "p") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;

      e.preventDefault();
      const { isRunning, start, pause } = usePomodoroStore.getState();
      if (isRunning) {
        pause();
      } else {
        start();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visIndstillinger]);

  // Indstillingsvinduet skal have fokus, når det åbner — ellers står fokus
  // på knappen bagved, og tastaturbrugeren taber sig ud af panelet.
  useEffect(() => {
    if (visIndstillinger) udkastfelter.current?.querySelector("input")?.focus();
  }, [visIndstillinger]);

  const radius = (SIZE - STROKE) / 2;
  const omkreds = 2 * Math.PI * radius;
  const ringFarve = MODE_TOKENS[mode] ?? MODE_TOKENS.idle;

  // Nøglerne står udskrevet, ikke bygget med et template literal: så kan
  // `i18n.test.ts` læse dem fra koden og fange en nøgle, der mangler i en
  // af de fem sprogfiler.
  // Defineres inde i komponenten, så skift af sprog gen Tegner etiketten.
  // Nøglerne er bogstavelige, så i18n.test.ts kan se dem.
  const MODE_LABEL: Record<string, string> = {
    idle: t("pomodoro.mode_idle"),
    work: t("pomodoro.mode_work"),
    shortBreak: t("pomodoro.mode_shortBreak"),
    longBreak: t("pomodoro.mode_longBreak"),
  };

  const felter: {
    nøgle: keyof PomodoroConfig;
    id: string;
    label: string;
    min: number;
    max: number;
  }[] = [
    {
      nøgle: "work_minutes",
      id: "pomodoro-work-minutes",
      label: t("pomodoro.work_minutes"),
      min: CONFIG_LIMITS.work_minutes.min,
      max: CONFIG_LIMITS.work_minutes.max,
    },
    {
      nøgle: "short_break_minutes",
      id: "pomodoro-short-break-minutes",
      label: t("pomodoro.short_break_minutes"),
      min: CONFIG_LIMITS.short_break_minutes.min,
      max: CONFIG_LIMITS.short_break_minutes.max,
    },
    {
      nøgle: "long_break_minutes",
      id: "pomodoro-long-break-minutes",
      label: t("pomodoro.long_break_minutes"),
      min: CONFIG_LIMITS.long_break_minutes.min,
      max: CONFIG_LIMITS.long_break_minutes.max,
    },
    {
      nøgle: "sessions_before_long",
      id: "pomodoro-sessions-before-long",
      label: t("pomodoro.sessions_before_long"),
      min: CONFIG_LIMITS.sessions_before_long.min,
      max: CONFIG_LIMITS.sessions_before_long.max,
    },
  ];

  function gem() {
    saveConfig(udkast);
    setVisIndstillinger(false);
  }

  if (visIndstillinger) {
    return (
      <section
        className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 sm:p-6"
        aria-label={t("pomodoro.settingsTitle")}
      >
        <h3 className="mb-4 text-sm font-semibold text-(--color-text)">
          {t("pomodoro.settingsTitle")}
        </h3>
        <div className="space-y-3" ref={udkastfelter}>
          {felter.map(({ id, nøgle, label, min, max }) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <label htmlFor={id} className="text-xs text-(--color-text-muted)">
                {label}
              </label>
              <input
                id={id}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={udkast[nøgle]}
                onChange={(e) =>
                  setUdkast({ ...udkast, [nøgle]: Number(e.target.value) })
                }
                className="h-10 w-24 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-center text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <Button onClick={gem}>{t("common.save")}</Button>
          <Button variant="ghost" onClick={() => setVisIndstillinger(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 sm:p-6"
      aria-label={t("pomodoro.title")}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex w-full items-center justify-between">
          {/* Live-regionen sidder på fasen, ikke på uret: den ændrer sig én
              gang pr. fase, så den læses højt uden at gentage sig hvert
              sekund. */}
          <span
            aria-live="polite"
            className="text-xs font-medium text-(--color-text)"
          >
            {MODE_LABEL[mode]}
          </span>
          <button
            type="button"
            onClick={() => setVisIndstillinger(true)}
            className="-mr-1 flex h-11 w-11 items-center justify-center rounded-md text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
            aria-label={t("pomodoro.settings")}
          >
            <Settings size={16} />
          </button>
        </div>

        <div className="relative">
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={radius}
              fill="none"
              strokeWidth={STROKE}
              style={{ stroke: "var(--color-border)" }}
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={radius}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-1000 ease-linear"
              style={{ stroke: ringFarve }}
              strokeDasharray={omkreds}
              strokeDashoffset={omkreds * (1 - progress)}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {/* `aria-live` er bevidst IKKE "polite" på selve uret: værdien
                ændrer sig hvert sekund, så en skærmlæser ville læse
                "24:59, 24:58, 24:57…" i en uge. Rolen `timer` har
                `aria-live="off"` som standard, så læseren kan hente den
                tid, den vil have. Fasen ved siden af siger derimod højt,
                når den skifter. */}
            <span
              role="timer"
              aria-live="off"
              className="font-mono text-3xl font-bold tabular-nums text-(--color-text)"
            >
              {formatPhaseTime(
                mode === "idle" ? config.work_minutes * 60 : timeRemaining,
              )}
            </span>
            {mode !== "idle" && (
              <span className="mt-1 text-xs text-(--color-text-muted)">
                {t("pomodoro.runde", {
                  current: runde,
                  total: config.sessions_before_long,
                })}
              </span>
            )}
          </div>
        </div>

        {/* Dagens pomodoros. Kun synlig når tallet faktisk er kommet — en
            indlæsning i gang viser ingenting, fordi «0» i en boks der fyldes
            ville sige at brugeren ikke har arbejdet, når det er sandheden at
            vi ikke ved det endnu.
            De to fejl er ikke ens, og derfor heller ikke deres tekst og
            deres knap. «Kunne ikke hente» betyder at tallet er ukendt, og
            «prøv igen» kan hente det. «Pomodoroen blev ikke talt» bevider
            at tallet er *for lavt* — intet genindlæser det, så en knap der
            henter igen ville stå og hente det samme tal og lade som om den
            hjalp. */}
        {statsFejl && (
          <div
            role="alert"
            // Krogen skelner dagens tals fejl fra de andre i kortet. Der kan
            // være to `role="alert"` på skærmen samtidig — denne og
            // `PickerLoadError` i pomodoroens registrering — og en test eller
            // en skærmlæser skal kunne ramme den rigtige.
            data-testid="pomodoro-stats-fejl"
            className="flex w-full items-center justify-between gap-2 rounded-md border border-(--color-border) px-2 py-1"
          >
            <span className="text-xs text-(--color-text-muted)">
              {statsFejl === "hentning"
                ? t("pomodoro.statsFailed")
                : t("pomodoro.statsWriteFailed")}
            </span>
            {statsFejl === "hentning" && (
              <button
                type="button"
                onClick={() => {
                  // Genindlæser uanset dagen: «prøv igen» efter en fejl skal
                  // hente, selv om det er samme kalenderdag — ellers ville
                  // knappen være død i præcis den situation den er der for.
                  void loadStats();
                }}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md text-xs text-(--color-text) transition-colors hover:bg-(--color-border)/40"
              >
                <RotateCw size={13} />
                {t("errors.tryAgain")}
              </button>
            )}
          </div>
        )}

        {/* Dagens tal vises kun når de faktisk handler om i dag.** Et svar fra
            i går rummer gårsdags række *og* dagens (`get_pomodoro_stats`
            læser `day <= idag`), så «2 pomodoros i dag» ovenover ville være
            gårsdagens tal forklædet som dagens. `genindlæsHvisNyDag` henter
            igen ved døgnskiftet og når vinduet bliver synligt, så hullet er
            højst et minut — og i stedet for et forkert tal viser skærmen
            ingenting, hvilket er sandt. */}
        {statsErIdag && stats && (
          <>
            <p className="w-full text-center text-xs text-(--color-text-muted)">
              {stats.i_dag.sessions > 0
                ? t("pomodoro.todayCount", { count: stats.i_dag.sessions })
                : t("pomodoro.todayNone")}
            </p>
            <PomodoroUgeStribe stats={stats} />
          </>
        )}

        {/* Tilbuddet om at registrere den afsluttede pomodoro. Sidder lige
            under dagens tal, for det er der brugeren læser «2 pomodoros i
            dag» og netop undrer sig over, hvor de to gange 25 minutter blev
            af. */}
        <PomodoroFaseRegistrering />

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={reset}
            disabled={mode === "idle"}
            aria-label={t("pomodoro.reset")}
            className="h-11 w-11 px-0"
          >
            <RotateCcw size={16} />
          </Button>

          <Button onClick={isRunning ? pause : start} className="h-11 min-w-32">
            {isRunning ? (
              <>
                <Pause size={16} />
                {t("pomodoro.pause")}
              </>
            ) : (
              <>
                <Play size={16} />
                {t("pomodoro.start")}
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={skip}
            disabled={mode === "idle"}
            aria-label={t("pomodoro.skip")}
            className="h-11 w-11 px-0"
          >
            <SkipForward size={16} />
          </Button>
        </div>

        {/* Samme sted og samme stil som `keyboard.listHint` under listerne:
            en genvej uden en synlig nøgle er en genvej ingen opdager. */}
        <p className="text-center text-[10px] text-(--color-text-muted)/50">
          {t("keyboard.pomodoroHint")}
        </p>
      </div>
    </section>
  );
}
