import { Check, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import {
  formatDate,
  formatDuration,
  formatTime,
  toLocalDateStr,
} from "@/lib/format";
import { usePomodoroStore } from "@/stores/pomodoroStore";

/**
 * Tilbuddet om at registrere en afsluttet pomodoro som tid.
 *
 * **Opt-in, aldrig automatik.** Feature-kø #2 bad om en *valgfri* knap pr.
 * gennemført fase, og det er derfor den ligger her: brugeren vælger kunde og
 * trykker. En automatisk registrering ville skrive tid brugeren aldrig bad om
 * — og missionen siger, at tabt tid er den værste fejl appen kan lave. Tid der
 * opstår uden et menneskes valg er ikke dét modsatte, den er bare skjult: den
 * ligger i rapporten og på en faktura, og brugeren må finde ud af hvor den kom
 * fra.
 *
 * Derfor vises komponenten **kun** når `klarFase` er sat, og den forsvinder
 * i samme øjeblik skrivningen lykkes. Tilbuddet er dermed aldrig liggende fra
 * i går — en gammel pomodoro ville se ud som en aktuel mulighed.
 */
export function PomodoroFaseRegistrering() {
  const { t } = useTranslation();
  const klarFase = usePomodoroStore((s) => s.klarFase);
  const registrerer = usePomodoroStore((s) => s.registrerer);
  const faseFejl = usePomodoroStore((s) => s.faseFejl);
  const registrerFase = usePomodoroStore((s) => s.registrerFase);

  // Listerne hentes kun når tilbuddet er synligt. Ellers ville hver mount af
  // `PomodoroTimer` — dashboardet og ugeblikket — hente alle kunder for en
  // funktion de fleste aldrig bruger.
  const { clients, loadFailed, retry } = useProjectClientPicker({
    projects: false,
    active: klarFase !== null,
  });
  const [valgtKunde, setValgtKunde] = useState<string>("");

  // Tilbuddet forsvinder efter en vellykket skrivning, og en kunde der så var
  // valgt må ikke blive liggende som et skjult valg til næste pomodoro: den
  // nye kunde er ikke nødvendigvis den samme.
  useEffect(() => {
    if (klarFase === null) setValgtKunde("");
  }, [klarFase]);

  if (!klarFase) return null;

  const kanGemme = valgtKunde !== "" && !registrerer;

  /**
   * Hvornår fasen var, så tilbuddet ikke kan forveksles med dagens.
   *
   * Uden denne skeln stod **gårsdags** pomodoro som «Du arbejdede i 25m» og
   * lignede dagens, fordi `klarFase` overlever et døgnskifte — en bruger der
   * kom tilbage næste morgen ville bogføre 25 minutter i dag, der reelt var
   * gårs. Datoen er derfor ikke pynt: `create_time_entry` skriver
   * starttidspunktet videre som det er, så registreringen lander på den dag
   * perioden faktisk lå.
   */
  const erIDag = klarFase.start.slice(0, 10) === toLocalDateStr(new Date());
  const hvornår = erIDag
    ? t("pomodoro.faseTodayAt", { time: formatTime(klarFase.start) })
    : t("pomodoro.faseOnAt", {
        date: formatDate(klarFase.start),
        time: formatTime(klarFase.start),
      });

  return (
    <div
      className="flex w-full flex-col gap-2 rounded-md border border-(--color-border) px-2 py-2"
      data-testid="pomodoro-fase"
    >
      <div className="flex items-center gap-2">
        <Timer size={14} className="shrink-0 text-(--color-text-muted)" />
        <span className="text-xs text-(--color-text-muted)">
          {t("pomodoro.faseLabel", {
            time: formatDuration(klarFase.varighed),
            when: hvornår,
          })}
        </span>
      </div>

      {loadFailed && <PickerLoadError kind={loadFailed} onRetry={retry} />}

      <select
        aria-label={t("form.clientLabel")}
        value={valgtKunde}
        onChange={(e) => setValgtKunde(e.target.value)}
        disabled={registrerer}
        className="h-11 w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/50 disabled:opacity-50"
      >
        {/* «Ingen klienter endnu» er en *påstand* om brugerens data. Når
            indlæsningen fejlede, er den ikke længere sand — så feltet siger det
            neutrale, og fejlen står lige ovenfor. Samme skeln som
            `TimerWidget`, fordi det er samme fejl. */}
        <option value="">
          {clients.length === 0 && !loadFailed
            ? t("projects.noClients")
            : t("form.noClient")}
        </option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.company ? ` (${c.company})` : ""}
          </option>
        ))}
      </select>

      {faseFejl && (
        <p
          role="alert"
          className="text-xs text-(--color-text-muted)"
          data-testid="pomodoro-fase-fejl"
        >
          {t("pomodoro.faseFailed")}
        </p>
      )}

      <Button
        size="lg"
        onClick={() => void registrerFase(valgtKunde)}
        disabled={!kanGemme}
        className="w-full"
      >
        <Check size={16} />
        {t("pomodoro.faseSave")}
      </Button>
    </div>
  );
}
