interface TodayTimer {
  isRunning?: boolean;
  startTime?: string | null;
  baseSeconds?: number | null;
  sessionStartedAt?: string | null;
  elapsedSeconds?: number | null;
  /** Seneste skrivning; for en pauset timer senest pausens tidspunkt */
  lastSyncedAt?: string | null;
}

/**
 * Timerens sekunder der hører til i dag. Kun tid efter midnat tæller, og kun
 * tid hvis dag kan afgøres. Sessioner startet i dag tæller alt akkumuleret
 * arbejde med; ellers tælles for en kørende timer det aktuelle løbende stykke
 * (tiden fra før et genoptag kan være fra i går), for en pauset timer den
 * akkumulerede tid, når pausen er skrevet i dag.
 */
export function timerSecondsToday(
  timer: TodayTimer | null,
  nowMs: number,
): number {
  if (!timer) return 0;
  const midnight = new Date(nowMs);
  midnight.setHours(0, 0, 0, 0);
  const midnightMs = midnight.getTime();
  const sessionMs = timer.sessionStartedAt
    ? new Date(timer.sessionStartedAt).getTime()
    : Number.NaN;
  const startedToday = sessionMs >= midnightMs && sessionMs <= nowMs;
  const accumulated = timer.baseSeconds || timer.elapsedSeconds || 0;

  if (timer.isRunning && timer.startTime) {
    const fromMs = Math.max(new Date(timer.startTime).getTime(), midnightMs);
    return (
      (startedToday ? Math.max(0, timer.baseSeconds ?? 0) : 0) +
      Math.max(0, Math.floor((nowMs - fromMs) / 1000))
    );
  }

  if (startedToday) return Math.max(0, accumulated);
  const pausedAtMs = timer.lastSyncedAt
    ? new Date(timer.lastSyncedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(pausedAtMs) || pausedAtMs < midnightMs) return 0;
  return Math.min(accumulated, Math.floor((pausedAtMs - midnightMs) / 1000));
}

/**
 * Dagens timer inkl. den kørende (eller pausede) timer, som endnu ikke er
 * gemt som registrering. Uden den sagde påmindelsen "Du har registreret 0 t
 * i dag" midt i en timer på tre timer. En række midt i et stop tæller ikke
 * med — dens tid er på vej ind som registrering. Kun tiden efter midnat
 * tæller som i dag.
 */
export function todayHoursWithTimer(
  savedHours: number,
  timer: (TodayTimer & { intent?: string | null }) | null,
  nowMs: number,
): number {
  if (!timer || timer.intent === "stopping") return savedHours;
  return savedHours + timerSecondsToday(timer, nowMs) / 3600;
}
