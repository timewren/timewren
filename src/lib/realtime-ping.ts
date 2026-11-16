/**
 * SSE-ping og klientens vagthund — delt mellem /api/realtime (server) og
 * useTimerRealtime (browser). Ingen server-imports.
 *
 * Før var hjerteslaget en SSE-kommentar (": ping"), som EventSource aldrig
 * viser for siden. Klienten satte `connected` ved "open" og sænkede polling
 * til 60 s — så en stille død strøm blev ikke opdaget. Nu sender serveren et
 * rigtigt `ping`-event; ældre klienter ignorerer ukendte event-navne.
 */

export const REALTIME_PING_INTERVAL_MS = 25_000;
/** Ingen ping/besked i så længe = strømmen regnes for død (2 tabte ping). */
export const REALTIME_STALE_AFTER_MS = 60_000;

export type PingSub = "ok" | "down";

export interface RealtimePing {
  /** Servertid (ms) */
  t: number;
  /** Om serverprocessens PSUBSCRIBE er aktiv */
  sub: PingSub;
}

export function formatPingFrame(nowMs: number, subscribed: boolean): string {
  const data: RealtimePing = { t: nowMs, sub: subscribed ? "ok" : "down" };
  return `event: ping\ndata: ${JSON.stringify(data)}\n\n`;
}

export function parsePing(data: string): RealtimePing | null {
  try {
    const parsed = JSON.parse(data) as Partial<RealtimePing> | null;
    if (
      !parsed ||
      typeof parsed.t !== "number" ||
      (parsed.sub !== "ok" && parsed.sub !== "down")
    ) {
      return null;
    }
    return { t: parsed.t, sub: parsed.sub };
  } catch {
    return null;
  }
}

export interface StreamState {
  /** EventSource har meldt "open" og ikke fejlet siden */
  open: boolean;
  /** Seneste "open", ping eller besked (klientens ur) */
  lastSignalAt: number | null;
  /** Seneste ping's abonnent-status (null = intet ping endnu) */
  lastSub: PingSub | null;
  now: number;
}

/**
 * `connected` styrer om kalderen må sænke polling. `reconnect` = strømmen
 * står åben men er tavs: luk og åbn igen (EventSource opdager det ikke selv).
 * Er serverens abonnent nede, hjælper en genforbindelse til samme proces
 * ikke — så falder vi bare tilbage til hurtig polling.
 */
export function evaluateStream(s: StreamState): {
  connected: boolean;
  reconnect: boolean;
} {
  if (!s.open || s.lastSignalAt === null) {
    return { connected: false, reconnect: false };
  }
  if (s.now - s.lastSignalAt > REALTIME_STALE_AFTER_MS) {
    return { connected: false, reconnect: true };
  }
  return { connected: s.lastSub !== "down", reconnect: false };
}
