import { DatabaseBackup, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriInvoke } from "@/lib/tauri";

interface DatabaseRecovery {
  backup_sti: string;
}

/**
 * Viser hvor brugerens gamle database ligger, når appen måtte starte på en ny.
 *
 * Uden denne besked var recovery-vejen i `db/mod.rs` en halv løsning: appen
 * startede, så alt så normalt ud, og brugeren ville opdage en måned efter at
 * hans registrerede tid var væk. Det værste udfald — han har ingen mistanke om
 * hvorfor de er væk, og ingen chance for at få dem tilbage.
 *
 * Derfor er beskeden ikke valgfri for denne ene situation, og den **ikke**
 * kan lukkes for godt: den følger med hver start indtil brugeren har hentet
 * filen. Det er Rust der holder staven — `database_recovery`-rækken i
 * `db/mod.rs` overlever appen, så også næste genstart viser den. Før 1/10 lå
 * tilstanden i processens hukommelse, og beskeden forsvandt altså præcis når
 * den betød mest. Der er ingen nøgle at gemme i `localStorage` — den ville
 * overleve en ny database og skjule beskeden for en bruger der netop har
 * mistet alt andet. Luk-knappen gælder kun denne session, og det er
 * med vilje: brugeren skal se den igen, indtil filen er væk.
 */
export function DatabaseRecoveryBanner() {
  const { t } = useTranslation();
  const [recovery, setRecovery] = useState<DatabaseRecovery | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let aktiv = true;
    tauriInvoke<DatabaseRecovery | null>("get_database_recovery")
      .then((r) => {
        if (aktiv) setRecovery(r);
      })
      .catch(() => {
        // Kommandoen svarer altid Ok, så det her er kun "Tauri er ikke klar
        // endnu". En besked vi ikke kan hente er ikke en besked om tab.
      });
    return () => {
      aktiv = false;
    };
  }, []);

  if (!recovery || dismissed) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        <DatabaseBackup
          size={16}
          className="mt-0.5 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <div className="flex-1 text-sm text-(--color-text)">
          <p className="font-medium">{t("databaseRecovery.title")}</p>
          <p className="mt-0.5 text-(--color-text-muted)">
            {t("databaseRecovery.explanation")}
          </p>
          {/* Stien er hele beskedens pointe — brugeren skal kunne åbne mappen
              og hente filen til en specialist. Derfor ord-brydes den og ikke
              kun skaleres ned: en sti der løber ud af skærmen kan ikke bruges. */}
          <p className="mt-1 break-all font-mono text-xs text-(--color-text-muted)">
            {recovery.backup_sti}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md p-1 text-(--color-text-muted) transition-colors hover:bg-(--color-surface) hover:text-(--color-text)"
          aria-label={t("databaseRecovery.dismiss")}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/** Kun til testens brug — se `DatabaseRecoveryBanner.i18n.test.tsx`. */
export type { DatabaseRecovery };
