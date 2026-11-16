import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PickerLoadKind } from "@/hooks/useProjectClientPicker";

interface PickerLoadErrorProps {
  /** Hvilken liste der fejlede — beskeden skal være konkret, ikke generel. */
  kind: PickerLoadKind;
  /** Genindlæser listerne. Skal komme fra `useProjectClientPicker`s `retry`. */
  onRetry: () => void;
  className?: string;
}

/**
 * Nøglerne er skrevet ud som strenge, ikke som `t(\`errors.couldNotLoad.${kind}\`)`:
 * `i18n.test.ts` læser nøgler med et mønster der skal se dem i koden, så en
 * nøgle der først opstår ved at sætte variabel ind i en streng ville være
 * usynlig for porten — både når den skal findes i json'en og når den skal
 * findes i koden.
 */
const NØGLE = {
  projekter: "errors.couldNotLoadProjects",
  kunder: "errors.couldNotLoadClients",
  begge: "errors.couldNotLoadProjectsAndClients",
} as const;

/**
 * Den tilstand, en vælger skal vise når listerne ikke kunne hentes.
 *
 * `LoadError` er for en hel visning — den fylder skærmen med en centreret
 * blok og en knap på 44 px. En vælger lever i en dropdown eller på en række
 * felter, hvor den plads ikke findes, så den har brug for den samme *besked*
 * i et format der passer ind. Beskeden og genindlæsningen er dog de samme, så
 * de to dele deler nøgler og knap.
 *
 * Uden denne viste de otte hentninger i de seks komponenter en rulleliste uden
 * valg — altså at brugeren ikke har projekter — når det var databasen der
 * ikke svarede. Det er den falske besked `LoadError` blev lavet til at lukke,
 * i en mindre målestok.
 */
export function PickerLoadError({
  kind,
  onRetry,
  className = "",
}: PickerLoadErrorProps) {
  const { t } = useTranslation();
  if (!kind) return null;

  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-2 rounded-md border border-(--color-border) bg-(--color-surface) px-2 py-1 ${className}`}
    >
      <span className="text-xs text-(--color-text-muted)">
        {t(NØGLE[kind])}
      </span>
      <button
        type="button"
        onClick={onRetry}
        // 44 px er kravet også her: på en dropdown-knap kan den være det eneste,
        // brugeren kan trykke på, så en lille «prøv igen» er umulig at ramme
        // med en tommelfinger — og på en smal skærm står den ofte alene.
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md text-xs text-(--color-text) transition-colors hover:bg-(--color-border)/40"
      >
        <RotateCw size={13} />
        {t("errors.tryAgain")}
      </button>
    </div>
  );
}
