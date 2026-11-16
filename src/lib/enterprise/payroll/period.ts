/**
 * Lønperioder (E5, #463): måned med skæringsdag (1 = kalendermåned; 16 =
 * 16/x–15/x+1) eller 14 dage forankret i en fast mandag. Ren.
 */
import type { PayrollPeriodType } from "./export";

export type PayrollPeriodSettings = {
  payrollPeriodType: PayrollPeriodType;
  /** 1–28 — dagen perioden starter på (kun måned) */
  payrollPeriodStartDay: number;
};

export type PayrollPeriod = { from: string; to: string; label: string };

/** Mandag 2024-01-01 — alle 14-dages-perioder ligger i faste skridt herfra. */
const BIWEEKLY_ANCHOR = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isoFromUtc(ms: number): string {
  const d = new Date(ms);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MONTHS = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];

/**
 * Lønperioden der indeholder `ref` (YYYY-MM-DD), forskudt `offset`
 * perioder (−1 = forrige). Månedsperioder med skæringsdag S: fra S/m til
 * (S−1)/m+1; hører til den måned perioden SLUTTER i (løn for august =
 * 16/7–15/8), som er praksis i de fleste lønkontorer.
 */
export function resolvePayrollPeriod(
  settings: PayrollPeriodSettings,
  ref: string,
  offset = 0,
): PayrollPeriod {
  if (settings.payrollPeriodType === "biweekly") {
    const { y, m, d } = parse(ref);
    const refMs = Date.UTC(y, m - 1, d);
    const index =
      Math.floor((refMs - BIWEEKLY_ANCHOR) / (14 * DAY_MS)) + offset;
    const fromMs = BIWEEKLY_ANCHOR + index * 14 * DAY_MS;
    const from = isoFromUtc(fromMs);
    const to = isoFromUtc(fromMs + 13 * DAY_MS);
    return { from, to, label: `14 dage ${from} – ${to}` };
  }

  const startDay = Math.min(28, Math.max(1, settings.payrollPeriodStartDay));
  const { y, m, d } = parse(ref);
  // Måneden perioden slutter i (kalendermåned ved startDay = 1)
  let endY = y;
  let endM = m;
  if (startDay > 1 && d >= startDay) {
    endM += 1;
    if (endM > 12) {
      endM = 1;
      endY += 1;
    }
  }
  endM += offset;
  while (endM > 12) {
    endM -= 12;
    endY += 1;
  }
  while (endM < 1) {
    endM += 12;
    endY -= 1;
  }
  if (startDay === 1) {
    return {
      from: iso(endY, endM, 1),
      to: iso(endY, endM, lastDayOfMonth(endY, endM)),
      label: `${MONTHS[endM - 1]} ${endY}`,
    };
  }
  let startY = endY;
  let startM = endM - 1;
  if (startM < 1) {
    startM = 12;
    startY -= 1;
  }
  return {
    from: iso(startY, startM, startDay),
    to: iso(endY, endM, startDay - 1),
    label: `${MONTHS[endM - 1]} ${endY}`,
  };
}
