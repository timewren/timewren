import { useQuery } from "@tanstack/react-query";
import { CreditCard, ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { apiClient } from "../../../api/client";
import { useT } from "../../../i18n";
import { formatHoursShort } from "../../../lib/format-hours";
import {
  formatPrepaidExpiryDate,
  isPrepaidExpiringSoon,
} from "../../../lib/prepaid";
import { useWebAppLink, WEB_PATHS } from "../../../lib/web-links";
import { KlippekortHuller } from "../../../popup/components/KlippekortHuller";
import { QueryErrorState } from "../../../popup/components/QueryErrorState";
import { useAuthStore } from "../../../stores/authStore";
import type { PrepaidPackage } from "../../../types";

const formatHours = formatHoursShort;

export function PrepaidTab() {
  const { t } = useT();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const newPrepaidUrl = useWebAppLink(WEB_PATHS.newPrepaid);
  const {
    data: packages,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["activePackages", selectedOrgId],
    queryFn: () => apiClient.getActivePackages(),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });

  // Group by client
  const grouped = useMemo(() => {
    if (!packages) return [];
    const map = new Map<
      string,
      { clientName: string; packages: PrepaidPackage[] }
    >();
    for (const pkg of packages) {
      const key = pkg.clientId || "unknown";
      let group = map.get(key);
      if (!group) {
        group = { clientName: pkg.clientName, packages: [] };
        map.set(key, group);
      }
      group.packages.push(pkg);
    }
    return Array.from(map.values());
  }, [packages]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <QueryErrorState
        error={error}
        fallback={t("views.prepaid.loadFailed")}
        onRetry={() => refetch()}
        className="py-16"
      />
    );
  }

  if (!packages || packages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CreditCard size={40} className="text-[var(--color-text-muted)] mb-4" />
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">
          {t("views.prepaid.none")}
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          {t("views.prepaid.noneHintNewTab")}
        </p>
        <a
          href={newPrepaidUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline"
        >
          <ExternalLink size={14} />
          {t("views.prepaid.create")}
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-tab-enter">
      {grouped.map((group) => (
        <div key={group.clientName}>
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] mb-3">
            {group.clientName}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.packages.map((pkg, i) => {
              const isLow = pkg.remainingHours <= pkg.totalHours * 0.2;
              const expiringSoon = isPrepaidExpiringSoon(pkg.expiresAt);

              return (
                <div
                  key={pkg.id}
                  className="animate-fade-in-up bg-[var(--color-surface-elevated)] rounded-[14px] p-5 border border-[var(--color-border-subtle)]"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                        {pkg.name}
                      </p>
                    </div>
                    <span
                      className={`text-xl font-bold ${
                        isLow
                          ? "text-[var(--color-warning-text)]"
                          : "text-[var(--color-text-primary)]"
                      }`}
                    >
                      {formatHours(pkg.remainingHours)}
                    </span>
                  </div>

                  {/* Klippekortet som huller (BRAND.md) */}
                  <KlippekortHuller
                    size="sm"
                    className="mb-1.5"
                    totalHours={pkg.totalHours}
                    remainingHours={pkg.remainingHours}
                    tone={isLow ? "lav" : "normal"}
                    showLabel={false}
                  />

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t("views.prepaid.leftOf", {
                        remaining: formatHours(pkg.remainingHours),
                        total: formatHours(pkg.totalHours),
                      })}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isLow && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          {t("prepaid.lowBalance")}
                        </span>
                      )}
                      {expiringSoon && pkg.expiresAt && (
                        <span
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700"
                          title={t("views.prepaid.expires", {
                            date: formatPrepaidExpiryDate(pkg.expiresAt),
                          })}
                        >
                          {t("prepaid.expiresSoon")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expiry date */}
                  {pkg.expiresAt && (
                    <div className="text-xs text-[var(--color-text-muted)] mt-2">
                      {t("views.prepaid.expires", {
                        date: formatPrepaidExpiryDate(pkg.expiresAt),
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
