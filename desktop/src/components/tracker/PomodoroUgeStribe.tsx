import { useTranslation } from "react-i18next";
import { getDayName } from "@/lib/calendar";
import { toLocalDateStr } from "@/lib/format";
import { søjlePct, type UgeDag, ugeStribe } from "@/lib/pomodoro";
import type { PomodoroStats } from "@/lib/types";

/** Hvor mange dage striben viser. Samme tal som `STATS_DAGE` i store'en — de
 *  to skal følges ad, ellers beder UI'et om færre dage end den får, og de
 *  sidste kolonner står tomme. */
const DAGE = 7;

/**
 * Ugen som syv søjler under pomodoro-tælleren.
 *
 * Dagens tal siger *hvor meget*, og striben siger *mønstret*: en uge med fire
 * pomodoros mandag–torsdag og nul resten er en helt anden uge end fire
 * pomodoros på én tirsdag, og det kan et enkelt tal ikke vise. Det er derfor
 * striben findes — ikke som pynt, men fordi tallet oven over ikke svarer på
 * spørgsmålet « holder jeg gang i det her ».
 *
 * En uge uden en eneste pomodoro tegnes ikke. Syv tomme søjler forteller intet
 * og fylder en boks under timeren med støj; `todayNone` lige over sig siger
 * allerede «Ingen pomodoros i dag endnu». Striben kommer altså, så snart der
 * er noget at se — og så forsvinder den ikke igen, for en pause må kunne ses.
 */
export function PomodoroUgeStribe({ stats }: { stats: PomodoroStats | null }) {
  const { t } = useTranslation();

  if (!stats) return null;

  // Dagens dato kommer **herfra**, ikke fra svaret. `get_pomodoro_stats`
  // svarer med den dag den blev kaldt, og uden denne skelnelse kunne et svar
  // fra i går få markeret i dag til at pege på i gårs kolonne — to kolonner med
  // samme dato og et antal der ikke passer med tælleren lige over striben.
  const stribe = ugeStribe(
    stats.dage,
    stats.i_dag,
    DAGE,
    ugedagsnavn,
    toLocalDateStr(new Date()),
  );
  if (!stribe.some((dag) => dag.sessions > 0)) return null;

  return (
    <ul aria-label={t("pomodoro.weekLabel")} className="flex w-full gap-1">
      {stribe.map((dag) => (
        <PomodoroSøjle key={dag.day} dag={dag} />
      ))}
    </ul>
  );
}

/** Ét navn pr. kalenderdag, i den valgte sprogs kalender. */
function ugedagsnavn(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return getDayName(new Date(y, m - 1, d));
}

function PomodoroSøjle({ dag }: { dag: UgeDag }) {
  const { t } = useTranslation();
  const pct = søjlePct(dag);

  return (
    // `aria-current="date"` ligger på li'en, ikke på det synlige navn: det er
    // dekoreret med `aria-hidden`, så en markering dér ville aldrig blive
    // læst. Skærmlæseren skal kunne høre hvilken af de syv dage der er i dag.
    <li
      aria-current={dag.erIDag ? "date" : undefined}
      className="flex flex-1 flex-col items-center gap-1"
    >
      {/* Søjlens højde er den visuelle information, og en skærmlæser kan ikke
          læse en højde. Uden denne linje hører brugeren syv bokse og intet
          tal — så tallene står her, og det tegnede er skjult. */}
      <span className="sr-only">
        {`${dag.navn}: ${
          dag.sessions > 0
            ? t("pomodoro.dayCount", { count: dag.sessions })
            : t("pomodoro.dayNone")
        }`}
      </span>

      <div
        aria-hidden="true"
        className="flex h-12 w-full items-end justify-center rounded-sm bg-(--color-border)/40"
      >
        <div
          className="w-full rounded-sm bg-(--color-accent)"
          style={{ height: `${pct}%` }}
        />
      </div>

      <span
        aria-hidden="true"
        className={
          dag.erIDag
            ? "text-[10px] font-semibold text-(--color-text)"
            : "text-[10px] text-(--color-text-muted)"
        }
      >
        {dag.navn}
      </span>
    </li>
  );
}
