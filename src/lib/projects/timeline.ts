/**
 * Projektets slutdato og forbrugstempo (#213).
 *
 * Ren TS uden React og uden DB: bruges af projektsiden (bannere) og af
 * deadline-alerts-cronen. Al dato-aritmetik sker på danske kalenderdatoer
 * ("yyyy-MM-dd") via @/lib/time/copenhagen, så prod (UTC) og udvikling
 * (Europe/Copenhagen) giver samme svar.
 */

import { toCopenhagenDateStr } from "@/lib/time/copenhagen";

/** Advar når slutdatoen er højst så mange dage væk. */
export const PROJECT_END_SOON_DAYS = 7;

/**
 * Advar om tempo når budgetforbruget ligger mindst så mange procentpoint
 * foran den forløbne del af projektperioden.
 */
export const PROJECT_PACE_GAP_PERCENT = 20;

export type ProjectEndDateState =
  | { kind: "overdue"; daysOverdue: number }
  | { kind: "soon"; daysLeft: number }
  | null;

function dayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function toDateStr(value: Date | string): string {
  return toCopenhagenDateStr(
    typeof value === "string" ? new Date(value) : value,
  );
}

/**
 * Hvor tæt et aktivt projekt er på sin slutdato. Slutdatoen er projektets
 * sidste dag: projektet er først overskredet dagen efter. Kun aktive
 * projekter advarer — afsluttede/pausede/arkiverede er ude af drift.
 */
export function projectEndDateState(
  project: { status: string | null; endDate: Date | string | null },
  todayStr: string,
): ProjectEndDateState {
  if ((project.status ?? "active") !== "active" || !project.endDate) {
    return null;
  }
  const diff = dayNumber(toDateStr(project.endDate)) - dayNumber(todayStr);
  if (diff < 0) return { kind: "overdue", daysOverdue: -diff };
  if (diff <= PROJECT_END_SOON_DAYS) return { kind: "soon", daysLeft: diff };
  return null;
}

/**
 * Cronen må ikke sende samme projektpåmindelse hver dag: kommende slutdato
 * meldes 7, 3, 1 og 0 dage før; overskredet 1, 7, 14 og 30 dage efter.
 */
const SOON_ALERT_DAYS = new Set([7, 3, 1, 0]);
const OVERDUE_ALERT_DAYS = new Set([1, 7, 14, 30]);

export function shouldNotifyProjectEndDate(
  state: ProjectEndDateState,
): boolean {
  if (!state) return false;
  return state.kind === "soon"
    ? SOON_ALERT_DAYS.has(state.daysLeft)
    : OVERDUE_ALERT_DAYS.has(state.daysOverdue);
}

export interface ProjectPace {
  /** Hele procent af projektperioden der er gået (0–100). */
  elapsedPercent: number;
  /** Budgetforbrug i hele procent (kan overstige 100). */
  budgetPercent: number;
}

/**
 * Budgetforbrug mod tidsforbrug: returnerer tallene når budgettet løber
 * mindst PROJECT_PACE_GAP_PERCENT procentpoint foran perioden — fx 70 %
 * brugt efter 40 % af tiden. Kræver aktivt projekt med start- og slutdato
 * og et budget; et brugt-op budget (≥ 100 %) vises allerede rødt af
 * budget-baren og giver derfor ikke også en tempo-advarsel.
 */
export function projectPaceWarning(
  project: {
    status: string | null;
    startDate: Date | string | null;
    endDate: Date | string | null;
  },
  budgetPercent: number | null | undefined,
  todayStr: string,
): ProjectPace | null {
  if (
    (project.status ?? "active") !== "active" ||
    !project.startDate ||
    !project.endDate ||
    budgetPercent === null ||
    budgetPercent === undefined ||
    budgetPercent >= 100
  ) {
    return null;
  }
  const start = dayNumber(toDateStr(project.startDate));
  // Slutdatoen er inklusiv — perioden slutter ved udgangen af den dag
  const end = dayNumber(toDateStr(project.endDate)) + 1;
  const today = dayNumber(todayStr);
  if (end <= start || today < start) return null;
  const elapsedPercent = Math.min(
    100,
    Math.round(((today - start) / (end - start)) * 100),
  );
  if (budgetPercent - elapsedPercent < PROJECT_PACE_GAP_PERCENT) return null;
  return { elapsedPercent, budgetPercent };
}
