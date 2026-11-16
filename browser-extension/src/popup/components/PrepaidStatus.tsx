import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, CreditCard } from "lucide-react";
import { apiClient } from "../../api/client";
import { useT } from "../../i18n";
import { formatHoursShort } from "../../lib/format-hours";
import { isPrepaidExpiringSoon } from "../../lib/prepaid";
import { PREPAID_PACKAGES_KEY } from "../../lib/query-invalidation";
import { useAuthStore } from "../../stores/authStore";
import { KlippekortHuller } from "./KlippekortHuller";

interface PrepaidStatusProps {
  clientId: string | null;
}

export function PrepaidStatus({ clientId }: PrepaidStatusProps) {
  const { t } = useT();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const { data: packages, isLoading } = useQuery({
    // Samme nøgle som klippekort-vælgeren, så et træk opdaterer begge
    queryKey: [PREPAID_PACKAGES_KEY, selectedOrgId],
    queryFn: () => apiClient.getActivePackages(),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });

  if (isLoading) {
    return (
      <div className="p-3 bg-[var(--color-surface-sunken)] rounded-lg animate-pulse">
        <div className="h-4 bg-[var(--color-border-default)] rounded w-1/2 mb-2" />
        <div className="h-3 bg-[var(--color-border-default)] rounded w-3/4" />
      </div>
    );
  }

  if (!packages || packages.length === 0) {
    return null;
  }

  // Filter to show only packages for selected client, or all if no client selected
  const relevantPackages = clientId
    ? packages.filter((p) => p.clientId === clientId)
    : packages;

  if (relevantPackages.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-2 space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-tertiary)]">
        <CreditCard size={13} />
        {t("prepaid.title")}
      </div>

      {relevantPackages.slice(0, 3).map((pkg) => {
        const isLow = pkg.remainingHours <= pkg.totalHours * 0.2;
        const isExpiringSoon = isPrepaidExpiringSoon(pkg.expiresAt);

        return (
          <div
            key={pkg.id}
            className={`p-2 rounded-lg border ${
              isLow
                ? "bg-amber-50 border-amber-200"
                : "bg-[var(--color-surface-elevated)] border-[var(--color-border-default)]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {pkg.name}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                  {pkg.clientName}
                </p>
              </div>

              <div className="text-right">
                <p
                  className={`text-sm font-semibold ${
                    isLow
                      ? "text-amber-700"
                      : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {formatHoursShort(pkg.remainingHours)}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  {t("prepaid.left")}
                </p>
              </div>
            </div>

            {/* Klippekortet som huller (BRAND.md) */}
            <KlippekortHuller
              size="sm"
              className="mt-2"
              totalHours={pkg.totalHours}
              remainingHours={pkg.remainingHours}
              tone={isLow ? "lav" : "normal"}
              showLabel={false}
            />

            {/* Warnings */}
            {(isLow || isExpiringSoon) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {isLow && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                    <AlertTriangle size={10} />
                    {t("prepaid.lowBalance")}
                  </span>
                )}
                {isExpiringSoon && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded">
                    <Clock size={10} />
                    {t("prepaid.expiresSoon")}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {relevantPackages.length > 3 && (
        <p className="text-xs text-[var(--color-text-tertiary)] text-center">
          {t("prepaid.more", { count: relevantPackages.length - 3 })}
        </p>
      )}
    </div>
  );
}
