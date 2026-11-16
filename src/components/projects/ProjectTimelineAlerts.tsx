"use client";

import { AlertTriangle, CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  projectEndDateState,
  projectPaceWarning,
} from "@/lib/projects/timeline";
import { copenhagenToday } from "@/lib/time/copenhagen";

interface ProjectTimelineAlertsProps {
  project: {
    status: string | null;
    startDate: Date | string | null;
    endDate: Date | string | null;
  };
  /** Timebudgettets forbrug i procent (projects.getStats); null uden budget. */
  budgetPercent: number | null | undefined;
}

const TONES = {
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
} as const;

/**
 * Advarsler på projektsiden (#213): slutdato tæt på/overskredet, og budget-
 * forbrug der løber foran den forløbne projektperiode. Intet når alt er i
 * orden — ingen tom tilstand.
 */
export function ProjectTimelineAlerts({
  project,
  budgetPercent,
}: ProjectTimelineAlertsProps) {
  const t = useTranslations("projects");
  const today = copenhagenToday();
  const endState = projectEndDateState(project, today);
  const pace = projectPaceWarning(project, budgetPercent, today);

  if (!endState && !pace) return null;

  return (
    <div className="space-y-2">
      {endState && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            endState.kind === "overdue" ? TONES.red : TONES.amber
          }`}
        >
          <CalendarClock
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <p>
            {endState.kind === "overdue" ? (
              t.rich("alerts.overdue", {
                count: endState.daysOverdue,
                b: (chunks) => <span className="font-semibold">{chunks}</span>,
              })
            ) : endState.daysLeft === 0 ? (
              <span className="font-semibold">{t("alerts.endsToday")}</span>
            ) : (
              <span className="font-semibold">
                {t("alerts.endsIn", { count: endState.daysLeft })}
              </span>
            )}
            {budgetPercent !== null &&
              budgetPercent !== undefined &&
              ` ${t("alerts.budgetUsed", { pct: budgetPercent })}`}
          </p>
        </div>
      )}
      {pace && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${TONES.amber}`}
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <p>
            {t.rich("alerts.pace", {
              budget: pace.budgetPercent,
              elapsed: pace.elapsedPercent,
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
          </p>
        </div>
      )}
    </div>
  );
}
