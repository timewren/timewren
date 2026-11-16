/**
 * Rene opsummeringer til /api/health. Ingen hemmeligheder: kun status,
 * aldre i sekunder og jobnavne.
 */

export interface RealtimeStatusLike {
  enabled: boolean;
  configured: boolean;
  subscribed: boolean;
  lastMessageAt: Date | null;
  lastPublishAt: Date | null;
}

export interface RealtimeHealth {
  status: "ok" | "degraded" | "disabled";
  subscribed: boolean;
  lastMessageAgeSeconds: number | null;
  lastPublishAgeSeconds: number | null;
}

function ageSeconds(d: Date | null, now: Date): number | null {
  return d
    ? Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000))
    : null;
}

export function summarizeRealtime(
  s: RealtimeStatusLike,
  now: Date,
): RealtimeHealth {
  const status =
    !s.enabled || !s.configured ? "disabled" : s.subscribed ? "ok" : "degraded";
  return {
    status,
    subscribed: s.subscribed,
    lastMessageAgeSeconds: ageSeconds(s.lastMessageAt, now),
    lastPublishAgeSeconds: ageSeconds(s.lastPublishAt, now),
  };
}

export interface CronHealth {
  status: "ok" | "degraded";
  /** Job der ikke har kørt inden for 2× forventet interval */
  staleJobs: string[];
  /** Sekunder siden seneste kørsel pr. forventet job (null = ikke set) */
  lastRunAgeSeconds: Record<string, number | null>;
}

export function summarizeCron(
  lastRuns: { jobName: string; lastRunAt: Date | null }[],
  expectedIntervalMinutes: Record<string, number>,
  now: Date,
): CronHealth {
  const byJob = new Map(lastRuns.map((r) => [r.jobName, r.lastRunAt]));
  const lastRunAgeSeconds: Record<string, number | null> = {};
  const staleJobs: string[] = [];
  for (const [job, interval] of Object.entries(expectedIntervalMinutes)) {
    const last = byJob.get(job) ?? null;
    const age = ageSeconds(last, now);
    lastRunAgeSeconds[job] = age;
    if (age === null || age > 2 * interval * 60) staleJobs.push(job);
  }
  return {
    status: staleJobs.length > 0 ? "degraded" : "ok",
    staleJobs,
    lastRunAgeSeconds,
  };
}

/**
 * Dead-man's switch for stabilitetsvagten: kører den hvert 15. minut, er
 * 45 min uden kørsel tre tabte kørsler. Bruges af /api/health/watch, som en
 * ekstern uptime-check kan kalde (vagtens egen cron_stale-detektor kan ikke
 * opdage at vagten selv er død).
 */
export const WATCH_STALE_AFTER_MINUTES = 45;

export function isWatchFresh(lastRun: Date | null, now: Date): boolean {
  if (!lastRun) return false;
  return (
    now.getTime() - lastRun.getTime() <= WATCH_STALE_AFTER_MINUTES * 60_000
  );
}
