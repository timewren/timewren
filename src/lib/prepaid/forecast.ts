import { addDaysToDateStr, toCopenhagenDateStr } from "@/lib/time/copenhagen";
import { isPrepaidExpired, prepaidExpiryDateStr } from "./expiry";
import { type UsageLike, usageDisplayDate } from "./usage-view";

type ForecastInput = {
  createdAt: Date | string;
  remainingHours: number;
  usage: (UsageLike & { hoursUsed: string | number })[];
  now: Date;
  isActive?: boolean;
  expiryDate?: Date | string | null;
};

/** Calendar days include idle days; work dates prevent imports inflating today's rate. */
export function forecastPrepaid(input: ForecastInput) {
  const today = toCopenhagenDateStr(input.now);
  const windowStart = addDaysToDateStr(today, -29);
  const created = toCopenhagenDateStr(new Date(input.createdAt));
  const start = [created, windowStart].sort().pop() ?? windowStart;
  const dailyUsage: { date: string; hours: number }[] = [];
  for (let date = start; date <= today; date = addDaysToDateStr(date, 1)) {
    dailyUsage.push({ date, hours: 0 });
  }
  const byDay = new Map(dailyUsage.map((day) => [day.date, day]));
  for (const usage of input.usage) {
    const date = usageDisplayDate(usage);
    if (!Number.isFinite(date.getTime())) continue;
    const day = byDay.get(toCopenhagenDateStr(date));
    const hours = Number(usage.hoursUsed);
    if (day && Number.isFinite(hours)) day.hours += hours;
  }
  const consumedHours = dailyUsage.reduce((sum, day) => sum + day.hours, 0);
  const observedDays = dailyUsage.length;
  const hoursPerDay = observedDays
    ? Math.max(0, consumedHours) / observedDays
    : 0;
  const canForecast =
    observedDays >= 7 &&
    hoursPerDay > 0 &&
    input.remainingHours > 0 &&
    input.isActive !== false &&
    !isPrepaidExpired(input.expiryDate, input.now);
  const days = canForecast
    ? Math.ceil(input.remainingHours / hoursPerDay)
    : null;
  // Avoid invalid dates for near-zero consumption rates.
  const daysRemaining =
    days !== null && Number.isFinite(days) && days <= 365000 ? days : null;
  const exhaustionDate =
    daysRemaining === null ? null : addDaysToDateStr(today, daysRemaining);
  const expiry = prepaidExpiryDateStr(input.expiryDate);
  return {
    dailyUsage,
    observedDays,
    consumedHours,
    hoursPerWeek: hoursPerDay * 7,
    daysRemaining,
    exhaustionDate,
    expiresBeforeExhaustion: !!(
      expiry &&
      exhaustionDate &&
      expiry < exhaustionDate
    ),
  };
}
