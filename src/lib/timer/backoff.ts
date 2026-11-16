/**
 * Backoff for timer-pollingen efter gentagne sync-fejl. Tidligere stoppede
 * pollingen for altid efter 5 fejl i træk (indtil sidegenindlæsning), så en
 * kortvarig netværksfejl efterlod web-timeren uden afstemning med de andre
 * enheder. Nu ventes eksponentielt længere — aldrig mere end 5 min — og der
 * prøves altid igen.
 */
export const POLL_FAILURE_THRESHOLD = 5;
export const MAX_POLL_BACKOFF_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 15_000;

export function pollBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures < POLL_FAILURE_THRESHOLD) return 0;
  const exponent = Math.min(consecutiveFailures - POLL_FAILURE_THRESHOLD, 10);
  return Math.min(MAX_POLL_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** exponent);
}
