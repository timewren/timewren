/**
 * Mindste timetal `time.previewRate` accepterer (zod på serveren). Klienter
 * skal holde forespørgslen slukket under grænsen i stedet for at sende den
 * og få 400 tilbage (#938).
 */
export const PREVIEW_RATE_MIN_HOURS = 0.01;

export function canPreviewRate(hours: number): boolean {
  return Number.isFinite(hours) && hours >= PREVIEW_RATE_MIN_HOURS;
}
