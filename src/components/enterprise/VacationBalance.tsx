"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useNumberFormat } from "./useNumberFormat";

interface PoolBreakdown {
  earned: number;
  carriedIn: number;
  carriedOut: number;
  adjustments: number;
  paidOut: number;
  forfeited: number;
  used: number;
  total: number;
  remaining: number;
}

interface VacationBalanceData {
  id: string;
  year: number;
  /** "2026" eller "Ferieår 2025/26" (#461) */
  periodLabel?: string;
  periodStart?: string;
  periodEnd?: string;
  rolledOverAt?: Date | string | null;
  accrualMode?: "upfront" | "monthly";
  totalDays: string;
  usedDays: string;
  remainingDays: string;
  remaining: number;
  extraTotalDays?: string;
  extraUsedDays?: string;
  extraRemainingDays?: string;
  extraRemaining?: number;
  /** Org'ens tilladte overtræk i dage (#437) */
  overdraftDays?: number;
  /** Projektion pr. pulje fra ferie-ledgeren (#461) */
  breakdown?: { vacation: PoolBreakdown; extra: PoolBreakdown };
}

interface VacationBalanceProps {
  balance: VacationBalanceData;
}

function PoolRow({
  label,
  total,
  used,
  remaining,
  breakdown,
  earnedLabel,
}: {
  label: string;
  total: number;
  used: number;
  remaining: number;
  breakdown?: PoolBreakdown;
  earnedLabel: string;
}) {
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isNegative = remaining < 0;
  const isLow = !isNegative && remaining < 5 && remaining > 0;

  const t = useTranslations("enterpriseComponents.vacationBalance");
  const fmt = useNumberFormat(1);
  const details: string[] = [];
  if (breakdown) {
    details.push(
      t("detail", { label: earnedLabel, value: fmt(breakdown.earned) }),
    );
    if (breakdown.carriedIn !== 0)
      details.push(t("carriedIn", { value: fmt(breakdown.carriedIn) }));
    if (breakdown.adjustments !== 0)
      details.push(
        t("adjusted", {
          value: `${breakdown.adjustments > 0 ? "+" : "−"}${fmt(Math.abs(breakdown.adjustments))}`,
        }),
      );
    if (breakdown.carriedOut !== 0)
      details.push(t("carriedOut", { value: fmt(breakdown.carriedOut) }));
    if (breakdown.paidOut > 0)
      details.push(t("paidOut", { value: fmt(breakdown.paidOut) }));
    if (breakdown.forfeited > 0)
      details.push(t("forfeited", { value: fmt(breakdown.forfeited) }));
  }
  details.push(t("used", { value: fmt(used) }));

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {label}
        </span>
        <span
          className={`text-sm font-semibold tabular-nums ${
            isNegative
              ? "text-amber-600 dark:text-amber-400"
              : isLow
                ? "text-amber-500"
                : "text-gray-900 dark:text-gray-100"
          }`}
        >
          {t("remainingOf", { remaining: fmt(remaining), total: fmt(total) })}
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-2 rounded-full transition-all ${
            isNegative ? "bg-amber-500" : "bg-brand-500"
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {details.join(" · ")}
      </div>
    </div>
  );
}

/**
 * Feriesaldo pr. ferieår med begge puljer: Ferie (25 dage) og Feriefridage
 * (6. ferieuge, #435). Viser optjent til dato / brugt / rest / overført fra
 * ledgeren (#461). Gul advarsel når en pulje er i overtræk (#437).
 */
export function VacationBalance({ balance }: VacationBalanceProps) {
  const t = useTranslations("enterpriseComponents.vacationBalance");
  const fmt = useNumberFormat(1);
  const total = Number(balance.totalDays ?? 0);
  const used = Number(balance.usedDays ?? 0);
  const remaining = balance.remaining;
  const extraTotal = Number(balance.extraTotalDays ?? 0);
  const extraUsed = Number(balance.extraUsedDays ?? 0);
  const extraRemaining =
    balance.extraRemaining ?? Number(balance.extraRemainingDays ?? 0);
  const overdraft = balance.overdraftDays ?? 0;
  const earnedLabel =
    balance.accrualMode === "monthly" ? t("accrued") : t("granted");

  const negativePools = [
    remaining < 0
      ? t("poolNegative", { label: t("holiday"), value: fmt(remaining) })
      : null,
    extraRemaining < 0
      ? t("poolNegative", { label: t("extra"), value: fmt(extraRemaining) })
      : null,
  ].filter((x): x is string => x !== null);
  // "Inden for tilladt overtræk" kun når HVER negativ pulje er inden for
  // grænsen — ellers neutral tekst (#452).
  const withinOverdraft =
    overdraft > 0 &&
    [remaining, extraRemaining].every((r) => r >= 0 || -r <= overdraft + 1e-9);

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="font-medium text-gray-900 dark:text-gray-100">
          {t("title")}
        </h4>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {balance.periodLabel ?? balance.year}
          {balance.rolledOverAt ? t("closed") : ""}
        </span>
      </div>

      <div className="space-y-4">
        <PoolRow
          label={t("holiday")}
          total={total}
          used={used}
          remaining={remaining}
          breakdown={balance.breakdown?.vacation}
          earnedLabel={earnedLabel}
        />
        {extraTotal > 0 || extraUsed > 0 ? (
          <PoolRow
            label={t("extra")}
            total={extraTotal}
            used={extraUsed}
            remaining={extraRemaining}
            breakdown={balance.breakdown?.extra}
            earnedLabel={t("granted")}
          />
        ) : null}
      </div>

      {negativePools.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {withinOverdraft
              ? t("negativeWithin", {
                  pools: negativePools.join(", "),
                  overdraft: fmt(overdraft),
                })
              : t("negative", { pools: negativePools.join(", ") })}
          </span>
        </div>
      )}
    </div>
  );
}
