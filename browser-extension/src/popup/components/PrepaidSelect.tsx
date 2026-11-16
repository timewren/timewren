import { CreditCard } from "lucide-react";
import { useId } from "react";
import { useT } from "../../i18n";
import { formatHoursShort } from "../../lib/format-hours";
import { type PrepaidChoice, resolvePrepaidPackage } from "../../lib/prepaid";
import type { PrepaidPackage } from "../../types";
import { KlippekortHuller } from "./KlippekortHuller";

interface PrepaidSelectProps {
  /** Kundens aktive kort (med timer tilbage) — uanset auto-træk. */
  packages: PrepaidPackage[];
  clientId: string | null;
  choice: PrepaidChoice;
  onChange: (choice: PrepaidChoice) => void;
}

/**
 * Kompakt klippekort-vælger, delt mellem Timer-fanen og hurtig-registrering.
 *
 * "Automatisk" = nuværende adfærd (kundens auto-kort, hvis der findes et);
 * "Intet klippekort" = træk ikke fra noget kort; derudover kan et konkret
 * kort vælges — også kort uden auto-træk, som ellers aldrig ville blive
 * foreslået. Restsaldoen vises for det kort valget lander på.
 */
export function PrepaidSelect({
  packages,
  clientId,
  choice,
  onChange,
}: PrepaidSelectProps) {
  const { t } = useT();
  const selectId = useId();

  if (packages.length === 0) return null;

  const resolution = resolvePrepaidPackage(choice, packages, clientId);
  const resolved = resolution.pkg;
  const autoResolved = resolvePrepaidPackage(
    { mode: "auto" },
    packages,
    clientId,
  ).pkg;
  const value = choice.mode === "package" ? choice.packageId : choice.mode;

  const handleChange = (raw: string) => {
    if (raw === "auto") {
      onChange({ mode: "auto" });
    } else if (raw === "none") {
      onChange({ mode: "none" });
    } else {
      onChange({ mode: "package", packageId: raw });
    }
  };

  const tone =
    resolved && resolved.remainingHours <= 0
      ? "tom"
      : resolved && resolved.remainingHours <= resolved.totalHours * 0.2
        ? "lav"
        : "normal";

  return (
    <div className="px-3 py-2.5 rounded-lg bg-[var(--color-surface-base)] border border-[var(--color-border-default)]">
      <div className="flex items-center gap-2">
        <CreditCard
          size={14}
          className="text-[var(--color-text-secondary)] flex-shrink-0"
          aria-hidden="true"
        />
        <label
          htmlFor={selectId}
          className="text-xs font-medium text-[var(--color-text-primary)] flex-shrink-0"
        >
          {t("prepaid.title")}
        </label>
        <select
          id={selectId}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="tt-select flex-1 min-w-0 text-xs"
        >
          <option value="auto">
            {autoResolved
              ? t("prepaid.auto", { name: autoResolved.name })
              : t("prepaid.autoPlain")}
          </option>
          <option value="none">{t("prepaid.none")}</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {t("prepaid.optionRemaining", {
                name: p.name,
                hours: formatHoursShort(p.remainingHours),
              })}
            </option>
          ))}
          {/* Pinnet kort der er forsvundet fra listen: vis det synligt i
              stedet for et blankt select. Trækket sker ikke (aldrig tavs
              auto-erstatning af et eksplicit valg) */}
          {resolution.pinnedUnavailable && choice.mode === "package" && (
            <option value={choice.packageId} disabled>
              {t("prepaid.unavailableOption")}
            </option>
          )}
        </select>
      </div>
      {choice.mode === "none" ? (
        <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
          {t("prepaid.noteNone")}
        </p>
      ) : resolution.pinnedUnavailable ? (
        <p className="mt-1.5 text-xs text-amber-700">
          {t("prepaid.notePinned")}
        </p>
      ) : resolved ? (
        // Saldoen for kortet, tiden trækkes fra, som huller (BRAND.md →
        // Klippekortet: regler), ligesom i appen og kundeportalen.
        <KlippekortHuller
          className="mt-2"
          totalHours={resolved.totalHours}
          remainingHours={resolved.remainingHours}
          tone={tone}
          suffix={
            packages.length > 1
              ? t("prepaid.suffixNamed", { name: resolved.name })
              : t("prepaid.suffixSingle")
          }
        />
      ) : (
        <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
          {t("prepaid.noAuto")}
        </p>
      )}
    </div>
  );
}
