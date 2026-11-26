"use client";

import { Target } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { toIntlLocale } from "@/i18n/format-locale";
import { budgetHealthStatus } from "@/lib/projects/budget";
import { budgetLabel } from "@/lib/projects/budget-label";

// Periodevalgene bor i @/lib/periods (delt med tRPC-routerne) — re-eksporteres
// her, så eksisterende importører af denne komponent ikke skal ændres.
export {
  PERIOD_OPTIONS,
  type PeriodKey,
  periodStart,
} from "@/lib/periods";

export interface ProjectBudget {
  budgetHours: number;
  usedHours: number;
  remainingHours: number;
  percentage: number;
  /** true = sat eksplicit på projektet; false = udledt af fastpris/timepris */
  isExplicit: boolean;
  /** Planlagt fremover i ressourceplanen (#508) — ikke brugt endnu */
  plannedHours?: number;
}

const BUDGET_TONES = {
  green: { bar: "bg-green-500", text: "text-green-700 dark:text-green-300" },
  yellow: { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  red: { bar: "bg-red-500", text: "text-red-700 dark:text-red-300" },
} as const;

function formatHoursValue(h: number, locale: string): string {
  return h.toLocaleString(toIntlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/**
 * Budget-bar "brugt / total" for et projekt (Harvest-stil). Tærsklerne kommer
 * fra @/lib/projects/budget: grøn < 80 %, gul 80–99 %, rød ≥ 100 %.
 * Deterministisk — ingen fremskrivning.
 */
export function ProjectBudgetBar({
  budget,
  editHref,
}: {
  budget: ProjectBudget;
  editHref?: string;
}) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const fmt = (h: number) => formatHoursValue(h, locale);
  const pct = Math.max(0, budget.percentage);
  const width = Math.min(pct, 100);
  const over = budget.remainingHours < 0;
  const health = budgetHealthStatus(pct);
  const tone = BUDGET_TONES[health];
  const label = budgetLabel(t, health, budget.usedHours, budget.budgetHours);
  // Ressourceplan (#508): brugt + planlagt fremover holdt op mod budgettet
  const planned = Math.max(0, budget.plannedHours ?? 0);
  const forecast = budget.usedHours + planned;
  const forecastPct =
    budget.budgetHours > 0 ? (forecast / budget.budgetHours) * 100 : 0;
  const plannedWidth = Math.max(0, Math.min(forecastPct, 100) - width);
  const forecastOver = planned > 0 && forecast > budget.budgetHours;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("budgetBar.title")}
          </h2>
          {!budget.isExplicit && (
            <span
              className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              title={t("budgetBar.derivedTitle")}
            >
              {t("budgetBar.derived")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="tabular-nums text-gray-900 dark:text-white">
            {label}
          </span>
          <span className={`font-medium ${tone.text}`}>
            {over
              ? t("budgetBar.over", { hours: fmt(-budget.remainingHours) })
              : t("budgetBar.remaining", { hours: fmt(budget.remainingHours) })}
          </span>
        </div>
      </div>
      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-label={t("budgetBar.title")}
        aria-valuetext={label}
      >
        <div className="flex h-full">
          <div
            className={`h-full transition-all ${tone.bar}`}
            style={{ width: `${width}%` }}
          />
          {plannedWidth > 0 && (
            <div
              className={`h-full transition-all ${forecastOver ? "bg-red-300 dark:bg-red-800" : "bg-brand-300 dark:bg-brand-700"}`}
              style={{
                width: `${plannedWidth}%`,
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent 0 4px, rgba(255,255,255,0.35) 4px 8px)",
              }}
              title={t("budgetBar.plannedTitle", { hours: fmt(planned) })}
            />
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>
          {t("budgetBar.pctUsed", { pct })}
          {planned > 0 && (
            <>
              {" · "}
              <span
                className={
                  forecastOver
                    ? "font-medium text-red-700 dark:text-red-300"
                    : undefined
                }
              >
                {t("budgetBar.planned", {
                  planned: fmt(planned),
                  forecast: fmt(forecast),
                  pct: Math.round(forecastPct),
                })}
                {forecastOver && ` ${t("budgetBar.planOver")}`}
              </span>
            </>
          )}
        </span>
        {editHref && (
          <Link
            href={editHref}
            className="text-brand-600 hover:underline dark:text-brand-400"
          >
            {budget.isExplicit ? t("budgetBar.adjust") : t("budgetBar.set")}
          </Link>
        )}
      </div>
    </div>
  );
}
