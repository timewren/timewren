import { addDaysToDateStr } from "@/lib/time/copenhagen";
import {
  type ComplianceRuleMode,
  calculate48hWeeklyAverage,
  type DatedTimeEntry,
  LIMIT_WEEKLY_AVERAGE,
} from "./compliance";

export function forecastWindow(
  weekStart: string,
  months: number,
  endOffset = 6,
) {
  const to = addDaysToDateStr(weekStart, endOffset);
  const anchor = new Date(`${to}T12:00:00Z`);
  const start = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - months, 1),
  );
  const lastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  start.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  const from = start.toISOString().slice(0, 10);
  return { from, to };
}

export function forecastCompliance(input: {
  weekStart: string;
  months: number;
  entries: DatedTimeEntry[];
  neutralAbsenceDates?: Iterable<string>;
  exempt?: boolean;
  rule48h?: ComplianceRuleMode;
  dailyRest?: ComplianceRuleMode;
  employmentStart?: string | null;
  employmentEnd?: string | null;
}) {
  const averageAt = (offset: number) => {
    const window = forecastWindow(input.weekStart, input.months, offset);
    const from =
      input.employmentStart && input.employmentStart > window.from
        ? input.employmentStart
        : window.from;
    const to =
      input.employmentEnd && input.employmentEnd < window.to
        ? input.employmentEnd
        : window.to;
    const entries = input.entries.filter((e) => e.date >= from && e.date <= to);
    const neutral = Array.from(input.neutralAbsenceDates ?? []).filter(
      (d) => d >= from && d <= to,
    );
    // Zero-hour boundary markers keep empty weeks in the reference period.
    const average = calculate48hWeeklyAverage(
      [
        ...entries.map((e) => ({
          ...e,
          startTime: new Date(`${e.date}T12:00:00Z`),
          endTime: null,
          hours:
            e.hours ??
            (e.startTime && e.endTime
              ? (e.endTime.getTime() - e.startTime.getTime()) / 3_600_000
              : 0),
        })),
        { startTime: new Date(`${from}T12:00:00Z`), hours: 0 },
        { startTime: new Date(`${to}T12:00:00Z`), hours: 0 },
      ],
      { neutralAbsenceDates: neutral },
    );
    return { ...average, asOf: to };
  };
  const average = Array.from({ length: 7 }, (_, offset) =>
    averageAt(offset),
  ).reduce((worst, day) =>
    day.averageHoursPerWeek >= worst.averageHoursPerWeek ? day : worst,
  );
  const remainingHours =
    Math.round(
      (LIMIT_WEEKLY_AVERAGE * average.weeksInPeriod - average.totalHours) * 100,
    ) / 100;
  // Each working day is one span; breaks and split entries are not daily rest.
  const to = addDaysToDateStr(input.weekStart, 6);
  const entries = input.entries.filter(
    (e) =>
      e.date <= to &&
      (!input.employmentStart || e.date >= input.employmentStart) &&
      (!input.employmentEnd || e.date <= input.employmentEnd),
  );
  const spans = new Map<string, { start: Date; end: Date }>();
  for (const e of entries) {
    if (!e.startTime || !e.endTime) continue;
    const old = spans.get(e.date);
    spans.set(e.date, {
      start: old && old.start < e.startTime ? old.start : e.startTime,
      end: old && old.end > e.endTime ? old.end : e.endTime,
    });
  }
  const days = [...spans.entries()].sort(([a], [b]) => a.localeCompare(b));
  const restWarnings: Array<{ date: string; restHours: number }> = [];
  for (let i = 1; i < days.length; i++) {
    const [date, next] = days[i];
    const restHours =
      (next.start.getTime() - days[i - 1][1].end.getTime()) / 3_600_000;
    if (date >= input.weekStart && restHours < 12)
      restWarnings.push({ date, restHours });
  }
  const findings: string[] = [];
  if (!input.exempt) {
    if (input.rule48h !== "off" && average.status !== "ok") {
      findings.push(
        `Planen giver ${average.averageHoursPerWeek.toFixed(1).replace(".", ",")} t/uge over ${input.months} måneder pr. ${average.asOf}. Råderum til 48 t: ${remainingHours.toFixed(1).replace(".", ",")} timer.`,
      );
    }
    if (input.dailyRest !== "off") {
      for (const r of restWarnings)
        findings.push(
          `${r.date}: planen giver ${r.restHours.toFixed(1).replace(".", ",")} timers hvile (krav: 11 timer).`,
        );
    }
  }
  return { ...average, remainingHours, restWarnings, findings };
}
