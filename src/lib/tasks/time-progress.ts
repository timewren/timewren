/**
 * Faktisk tid vs. estimat på opgaver (#212, Everhour-mønsteret).
 *
 * Ren TS uden React og uden DB, så både tRPC-routeren, task-kortet,
 * listevisningen og quick-add-parseren kan dele den.
 *
 * Tærsklerne genbruger projektbudgettets (@/lib/projects/budget): grøn < 80 %,
 * gul 80–99 %, rød ≥ 100 % — så "ved at sprænge estimatet" betyder det samme
 * på opgaver som på projekter.
 */

import {
  type BudgetHealthStatus,
  budgetHealthStatus,
} from "@/lib/projects/budget";

/** Øvre grænse for et parset estimat: 999 timer. */
const MAX_ESTIMATE_MINUTES = 999 * 60;

/**
 * Kort dansk varighed: "45m", "2t", "1,5t". Timer vises med højst én decimal,
 * så kortet kan vise "1,5t / 3t" uden at sprænge rækken.
 */
export function formatTaskMinutes(
  minutes: number,
  options: { locale?: string; minuteUnit?: string; hourUnit?: string } = {},
): string {
  const { locale = "da-DK", minuteUnit = "m", hourUnit = "t" } = options;
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}${minuteUnit}`;
  const hours = Math.round((m / 60) * 10) / 10;
  return `${hours.toLocaleString(locale, { maximumFractionDigits: 1 })}${hourUnit}`;
}

export interface TaskTimeProgress {
  trackedMinutes: number;
  estimatedMinutes: number | null;
  /** Hele procent af estimatet; null uden estimat. Kan overstige 100. */
  percentage: number | null;
  /** null uden estimat. */
  status: BudgetHealthStatus | null;
}

export function getTaskTimeProgress(
  trackedMinutes: number | null | undefined,
  estimatedMinutes: number | null | undefined,
): TaskTimeProgress {
  const tracked = Math.max(0, Math.round(trackedMinutes ?? 0));
  const estimate =
    estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes : null;
  if (estimate === null) {
    return {
      trackedMinutes: tracked,
      estimatedMinutes: null,
      percentage: null,
      status: null,
    };
  }
  const percentage = Math.round((tracked / estimate) * 100);
  return {
    trackedMinutes: tracked,
    estimatedMinutes: estimate,
    percentage,
    status: budgetHealthStatus(percentage),
  };
}

/** Tailwind-klasser pr. status — AA-kontrast på hvid og mørk baggrund. */
export const TASK_PROGRESS_TONES: Record<
  BudgetHealthStatus,
  { bar: string; text: string }
> = {
  green: { bar: "bg-green-500", text: "text-green-700 dark:text-green-400" },
  yellow: { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  red: { bar: "bg-red-500", text: "text-red-700 dark:text-red-400" },
};

// Afgrænsning: tallet skal stå som eget ord (start eller mellemrum foran,
// mellemrum/tegnsætning/slut efter), så "Q4t" eller "v2.1timer" ikke fanges.
const END = String.raw`(?=$|[\s.,;:!?)])`;
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const HOUR_UNIT = "(?:timer|time|t|h)";
// Et nøgent "m" kun i "1t30m" — alene kunne det være meter ("Køb 5m kabel")
const MIN_WORD = String.raw`\s*(?:minutter|minut|min)`;
const MIN_UNIT = `(?:${MIN_WORD}|m)`;

const COMBINED_RE = new RegExp(
  String.raw`(^|\s)~?(\d+)\s*${HOUR_UNIT}\s*(\d+)${MIN_UNIT}${END}`,
  "i",
);
const HOURS_RE = new RegExp(
  String.raw`(^|\s)~?${NUM}\s*${HOUR_UNIT}${END}`,
  "i",
);
const MINUTES_RE = new RegExp(String.raw`(^|\s)~?(\d+)${MIN_WORD}${END}`, "i");

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

/**
 * Find et estimat i fritekst: "~4t", "2 timer", "1,5t", "30 min", "45m",
 * "1t30m". Returnerer minutter og teksten uden estimatet, eller null når der
 * intet (gyldigt) estimat er.
 */
export function parseEstimate(
  text: string,
): { minutes: number; rest: string } | null {
  const attempts: [RegExp, (m: RegExpMatchArray) => number][] = [
    [COMBINED_RE, (m) => toNumber(m[2]) * 60 + toNumber(m[3])],
    [HOURS_RE, (m) => toNumber(m[2]) * 60],
    [MINUTES_RE, (m) => toNumber(m[2])],
  ];
  for (const [re, toMinutes] of attempts) {
    const match = text.match(re);
    if (!match || match.index === undefined) continue;
    const minutes = Math.round(toMinutes(match));
    if (!(minutes > 0) || minutes > MAX_ESTIMATE_MINUTES) return null;
    const start = match.index + match[1].length;
    const rest =
      `${text.slice(0, start)}${text.slice(match.index + match[0].length)}`
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim();
    // Kun et estimat og ingen titel: lad teksten stå som titel
    if (!rest) return null;
    return { minutes, rest };
  }
  return null;
}
