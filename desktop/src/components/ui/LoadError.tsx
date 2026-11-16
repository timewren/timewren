import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";

interface LoadErrorProps {
  /** Hvad der ikke kunne hentes — «registreringer», «kunderne». */
  message: string;
  /** Genindlæser data. Skal sætte `loading` tilbage, så spinderen kommer igen. */
  onRetry: () => void;
  /** Til widgetter, der selv tegner deres egen ramme omkring indholdet. */
  className?: string;
}

/**
 * Den tilstand, en fejlet indlæsning skal vise.
 *
 * Før stod den i hver komponent som en `console.error` og så en *tom-tilstand*:
 * `catch (err) { console.error(...) } finally { setLoading(false) }`. Resultatet
 * var, at en database der ikke kunne læses lignede en konto uden kunder — brugeren
 * fik besked på at oprette sin første kunde, og den besked var **forkert**. Den
 * her komponent gør i stedet forskellen mellem «der er ingen data» og «data kunne
 * ikke hentes» synlig, og giver knappen til at prøve igen.
 *
 * Samme mønster lå allerede i `RecentActivity`, `IdentitySettings` og
 * `ExclusionRulesManager`; de bruger den herfra nu, så en ny liste ikke skal
 * opfinde sin tredje udgave af den.
 *
 * Knappen er mindst 44 px høj, fordi den kan være det eneste, brugeren kan trykke
 * på den skærm.
 */
export function LoadError({
  message,
  onRetry,
  className = "",
}: LoadErrorProps) {
  const { t } = useTranslation();

  return (
    <div
      // Fejlen skal læses højt af en skærmlæser; den erstatter et billede af data,
      // så `role="status"` ville slet ikke blive læst op i en stille browsing.
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 py-10 text-center ${className}`}
    >
      <p className="text-sm text-(--color-text-muted)">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-(--color-border) px-3 text-xs text-(--color-text) transition-colors hover:bg-(--color-border)/40"
      >
        <RotateCw size={13} />
        {t("errors.tryAgain")}
      </button>
    </div>
  );
}
