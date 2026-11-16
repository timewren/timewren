/**
 * Idle-stemplet deles mellem fanerne i samme browser over
 * `BroadcastChannel("tt-timer-idle")`. Kun ejer-fanen må lade vagthunden
 * pause timeren (lib/timer/idle.ts, shouldWatchdogAutoPause), men uden
 * IdleDetector registrerer en skjult fane aldrig inaktivitet
 * (useIdleDetection), og ejer-fanen er ofte skjult. Den fane, brugeren gik
 * fra, deler derfor sit stempel, og den deler en rydning, når brugeren er
 * tilbage. Browsere uden BroadcastChannel får `null` fra
 * `openIdleStampChannel`, og så må alle faner pause som før.
 */

export const IDLE_CHANNEL_NAME = "tt-timer-idle";

export interface IdleStampMessage {
  type: "idle_stamp";
  /** Hvornår inaktiviteten begyndte (ms), eller null = brugeren er tilbage. */
  at: number | null;
}

/** Validerer en indkommende besked; alt ukendt ignoreres. */
export function parseIdleStampMessage(raw: unknown): IdleStampMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as { type?: unknown; at?: unknown };
  if (msg.type !== "idle_stamp") return null;
  if (msg.at === null) return { type: "idle_stamp", at: null };
  if (typeof msg.at === "number" && Number.isFinite(msg.at) && msg.at > 0) {
    return { type: "idle_stamp", at: msg.at };
  }
  return null;
}

/**
 * Fanens stempel efter en besked fra en anden fane: det tidligste vinder
 * (som serverens "første detektor"), og en rydning rydder.
 */
export function mergeIdleStamp(
  current: number | null,
  incoming: number | null,
): number | null {
  if (incoming === null) return null;
  return current === null ? incoming : Math.min(current, incoming);
}

export interface IdleStampChannel {
  post: (at: number | null) => void;
  close: () => void;
}

/** Åbn kanalen. `null`, hvor BroadcastChannel ikke findes (SSR, gamle browsere). */
export function openIdleStampChannel(
  onStamp: (at: number | null) => void,
): IdleStampChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(IDLE_CHANNEL_NAME);
  } catch {
    return null;
  }
  channel.onmessage = (event) => {
    const msg = parseIdleStampMessage(event.data);
    if (msg) onStamp(msg.at);
  };
  return {
    post: (at) => {
      try {
        channel.postMessage({
          type: "idle_stamp",
          at,
        } satisfies IdleStampMessage);
      } catch {
        // Lukket kanal: delingen er best effort.
      }
    },
    close: () => channel.close(),
  };
}
