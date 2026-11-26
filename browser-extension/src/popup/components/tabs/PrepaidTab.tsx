import { useQuery } from "@tanstack/react-query";
import { CreditCard, ExternalLink, Play } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../../api/client";
import { useT } from "../../../i18n";
import { formatHoursShort } from "../../../lib/format-hours";
import {
  canTakePrepaidHours,
  formatPrepaidExpiryDate,
  isPrepaidExpiringSoon,
  resolvePrepaidPackage,
} from "../../../lib/prepaid";
import { useWebAppLink, WEB_PATHS } from "../../../lib/web-links";
import { useAuthStore } from "../../../stores/authStore";
import { useTimerStore } from "../../../stores/timerStore";
import { KlippekortHuller } from "../KlippekortHuller";
import { QueryErrorState } from "../QueryErrorState";

const formatHours = formatHoursShort;

interface PrepaidTabProps {
  /** Kaldes når en timer er startet fra et kort — App skifter til Timer-fanen. */
  onTimerStarted?: () => void;
}

export function PrepaidTab({ onTimerStarted }: PrepaidTabProps = {}) {
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

  // Start direkte på et kort (kundeønske): timeren startes på kortets
  // kunde og klippekortvalget låses til netop dette kort, så trækket ikke
  // afhænger af auto-valg-reglen.
  const timer = useTimerStore((s) => s.timer);
  const hasTime = useTimerStore((s) => s.displayTime > 0);
  const isSyncing = useTimerStore((s) => s.isSyncing);
  const prepaidChoice = useTimerStore((s) => s.prepaidChoice);
  const startTimer = useTimerStore((s) => s.startTimer);
  const setPrepaidChoice = useTimerStore((s) => s.setPrepaidChoice);
  const [startingId, setStartingId] = useState<string | null>(null);

  const runningPackageId =
    timer?.isRunning && packages
      ? (resolvePrepaidPackage(prepaidChoice, packages, timer.clientId ?? null)
          .pkg?.id ?? null)
      : null;

  const handleStart = async (pkg: { id: string; clientId: string }) => {
    if (isSyncing || startingId) return;
    setStartingId(pkg.id);
    try {
      await startTimer(null, pkg.clientId, "");
      // Kun hvis starten lykkedes (fejl lander i timer-storens error-banner)
      if (useTimerStore.getState().timer?.isRunning) {
        setPrepaidChoice({ mode: "package", packageId: pkg.id });
        onTimerStarted?.();
      }
    } finally {
      setStartingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <QueryErrorState
        error={error}
        fallback={t("views.prepaid.loadFailed")}
        onRetry={() => refetch()}
        className="flex-1 p-8"
      />
    );
  }

  if (!packages || packages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <CreditCard size={32} className="text-[var(--color-text-muted)] mb-3" />
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">
          {t("views.prepaid.none")}
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          {t("views.prepaid.noneHintPopup")}
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
    <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
      {packages.map((pkg, i) => {
        const isLow = pkg.remainingHours <= pkg.totalHours * 0.2;
        const expiringSoon = isPrepaidExpiringSoon(pkg.expiresAt);
        const isRunningHere = runningPackageId === pkg.id;
        // Kun når der hverken kører eller ligger en pauset timer — en fresh
        // start ville ellers overskrive den pausede tid.
        const canStart =
          !timer?.isRunning &&
          !hasTime &&
          canTakePrepaidHours(pkg) &&
          !isSyncing;

        return (
          <div
            key={pkg.id}
            className="animate-fade-in-up bg-[var(--color-surface-elevated)] rounded-lg p-3 border border-[var(--color-border-subtle)]"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                  {pkg.name}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                  {pkg.clientName}
                </p>
              </div>
              <span
                className={`text-lg font-bold ${
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

            {/* Footer: usage label + badges */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-muted)]">
                {t("views.prepaid.leftOf", {
                  remaining: formatHours(pkg.remainingHours),
                  total: formatHours(pkg.totalHours),
                })}
              </span>
              <div className="flex items-center gap-1">
                {isRunningHere && (
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700 inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary-600 animate-pulse" />
                    {t("views.prepaid.running")}
                  </span>
                )}
                {isLow && (
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    {t("prepaid.lowBalance")}
                  </span>
                )}
                {expiringSoon && pkg.expiresAt && (
                  <span
                    className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700"
                    title={t("views.prepaid.expires", {
                      date: formatPrepaidExpiryDate(pkg.expiresAt),
                    })}
                  >
                    {t("prepaid.expiresSoon")}
                  </span>
                )}
              </div>
            </div>

            {canStart && (
              <button
                type="button"
                onClick={() => void handleStart(pkg)}
                disabled={startingId !== null}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-[var(--color-on-primary)] text-xs font-medium py-1.5 transition-colors"
              >
                <Play size={12} />
                {startingId === pkg.id
                  ? t("views.prepaid.starting")
                  : t("views.prepaid.startTimer", { client: pkg.clientName })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
