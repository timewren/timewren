/**
 * Trend line for the report's daily chart.
 *
 * A freelancer wants to know one thing from a period: am I registering more or
 * less time than at the start of it? That is a slope, not an average, so we fit
 * a least-squares line through the daily hours and draw it over the bars.
 *
 * The series is the days the backend actually returned (days with registered
 * time), so the line describes the user's working days, not calendar days —
 * weekend gaps must not be read as a drop in output.
 */

export type TrendDirection = "up" | "down" | "flat";

export interface TrendSummary {
  direction: TrendDirection;
  /** Signed change in hours per working day, from the first to the last day. */
  changeHours: number;
  /** Fitted hours on the first and last day of the series. */
  firstHours: number;
  lastHours: number;
}

/**
 * A total change below this many hours across the whole period is noise, not a
 * trend — two hours over a quarter is not a change in working habits.
 */
export const TREND_FLAT_THRESHOLD_HOURS = 2;

/**
 * Least-squares fit through `values`, returned per index so it can be drawn
 * directly against the series it describes.
 *
 * Fewer than two points carry no slope: a single point is its own line, and an
 * empty series stays empty rather than becoming a dot at zero.
 */
export function linearTrend(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [values[0]];

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - meanX) * (values[i] - meanY);
    denominator += (i - meanX) ** 2;
  }

  // Every point shares the same x, so there is no slope to find.
  if (denominator === 0) return values.map(() => meanY);

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  return values.map((_, i) => intercept + slope * i);
}

/** Round to hundredths — the chart axis shows two decimals, the CSV three. */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function summarizeTrend(
  values: number[],
  flatThresholdHours: number = TREND_FLAT_THRESHOLD_HOURS,
): TrendSummary | null {
  const fit = linearTrend(values);
  if (fit.length === 0) return null;

  const firstHours = fit[0];
  const lastHours = fit[fit.length - 1];
  const changeHours = lastHours - firstHours;

  return {
    direction:
      Math.abs(changeHours) < flatThresholdHours
        ? "flat"
        : changeHours > 0
          ? "up"
          : "down",
    changeHours,
    firstHours,
    lastHours,
  };
}

/**
 * Add a `trend` field to a chart series, so the line and the bars are built
 * from one pass over the same data and can never drift apart.
 */
export function withTrend<T>(
  items: T[],
  hoursOf: (item: T) => number,
): Array<T & { trend: number }> {
  const trend = linearTrend(items.map(hoursOf));
  return items.map((item, i) => ({ ...item, trend: round2(trend[i]) }));
}
