import { Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration, formatTime } from "@/lib/format";
import type { PomodoroFase } from "@/lib/pomodoro";

/** Første ti tegn af et lokalt væg-tidsstempel, altså `YYYY-MM-DD`. */
function dato(lokal: string): string {
  return lokal.slice(0, 10);
}

/**
 * Én gennemført pomodoro som en række i dagens tidslinje.
 *
 * **Hvorfor den ikke ligner en `ActivityBlock`.** En aktivitet er noget
 * auto-trackeren så, og den skal bekræftes, klassificeres eller slettes. En
 * pomodoro er noget brugeren *selv* kørte, og der er intet at bekræfte — den er
 * færdig, fordi den slap. At male den som en aktivitet ville få den til at ligne
 * arbejde, der endnu ikke er godkendt, altså det modsatte af sandheden.
 *
 * **Derfor er den heller ikke klikbar.** `K61` kan allerede gøre en pomodoro
 * til en tidsregistrering, men det sker under timeren, hvor fasen er. En knap
 * her ville skrive en anden registrering end den timeren tilbyder, og to veje
 * til det samme tal er præcis den dobbelt handling, der får en klippekort-
 * fradragning til at glide mellem to indgange. Rækken er en ren visning.
 *
 * **Datoen står kun ved et nattskifte.** `fasePeriode` kan skrive starten på den
 * foregående dag, så en række der siger 23.45–00.10 uden dato ligner en fase fra
 * i går. Alle andre rækker er samme dag, og så er datoen støj — syv tal med syv
 * ens datoer.
 *
 * **Bogførte faser siger det.** En fase brugeren har registreret som tid står
 * stadig i dagens tidslinje, og dens minutter står *også* i ugeoversigten.
 * Uden markeringen læser dagen som om de samme 25 minutter optrådte to gange,
 * og der er ingen anden sted at finde ud af at de ikke gør det — rækken er
 * bevidst ikke klikbar. Markeringen følger `time_entries`: sletter brugeren
 * registreringen, forsvinder den igen, og fasen kan bogføres på ny.
 */
export function PomodoroFaseRække({ fase }: { fase: PomodoroFase }) {
  const { t } = useTranslation();
  const rækkerOverMidnat = dato(fase.started_at) !== dato(fase.ended_at);

  return (
    <div
      data-testid="pomodoro-fase"
      className="flex items-center gap-3 rounded-lg border border-dashed border-(--color-accent)/40 bg-(--color-accent)/5 px-3 py-2"
    >
      <Timer size={14} className="shrink-0 text-(--color-accent)" />
      <span className="shrink-0 font-mono text-xs text-(--color-text-muted)">
        {formatTime(fase.started_at)}
        &ndash;
        {formatTime(fase.ended_at)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--color-text)">
        {t("timeline.pomodoroPhase")}
        {fase.registreret && (
          <span className="ml-2 font-normal text-(--color-accent)">
            {t("timeline.pomodoroPhaseRegistered")}
          </span>
        )}
        {rækkerOverMidnat && (
          <span className="ml-2 font-normal text-(--color-text-muted)">
            {t("timeline.pomodoroPhaseSpansMidnight", {
              date: dato(fase.started_at).split("-").reverse().join("/"),
            })}
          </span>
        )}
      </span>
      {/* Varigheden er skrevet to steder i `PomodoroTimer` (tælleren og den
          afsluttende besked), så den skal også stå her — ellers er rækken det
          eneste sted i tidslinjen uden længde. */}
      <span className="shrink-0 font-mono text-xs text-(--color-text-muted)">
        {formatDuration(fase.minutes * 60)}
      </span>
    </div>
  );
}
