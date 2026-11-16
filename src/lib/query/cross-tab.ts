/**
 * Krydsfane-friskhed: når en fane har ændret data, får de andre faner i
 * samme browser besked over `BroadcastChannel("tt-data")` og invaliderer de
 * samme domæner. Uden det viste fane A gamle tal efter en rettelse i fane B,
 * indtil 5 min staleTime var gået og man navigerede.
 *
 * En BroadcastChannel-instans modtager ikke sine egne beskeder, så én delt
 * instans pr. fane til både afsendelse og modtagelse giver ingen ekko.
 * Browsere uden BroadcastChannel (og serveren) får en tavs no-op.
 */

export const DATA_CHANNEL_NAME = "tt-data";

export interface DataChangeMessage {
  type: "data_changed";
  domains: string[] | "all";
  /** Fanen der lavede ændringen (kun på SSE-events) — se tab-id.ts. */
  origin?: string;
}

/** Validerer en indkommende besked; alt ukendt ignoreres. */
export function parseDataChangeMessage(raw: unknown): DataChangeMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as { type?: unknown; domains?: unknown; origin?: unknown };
  if (msg.type !== "data_changed") return null;
  const origin = typeof msg.origin === "string" ? { origin: msg.origin } : {};
  if (msg.domains === "all") {
    return { type: "data_changed", domains: "all", ...origin };
  }
  if (
    Array.isArray(msg.domains) &&
    msg.domains.every((d) => typeof d === "string")
  ) {
    return {
      type: "data_changed",
      domains: msg.domains as string[],
      ...origin,
    };
  }
  return null;
}

type ChannelLike = Pick<
  BroadcastChannel,
  "postMessage" | "addEventListener" | "removeEventListener"
>;

let channel: ChannelLike | null | undefined;

function getChannel(): ChannelLike | null {
  if (channel !== undefined) return channel;
  if (typeof BroadcastChannel === "undefined") {
    channel = null;
    return channel;
  }
  try {
    channel = new BroadcastChannel(DATA_CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/** Fortæl de andre faner at disse domæner er ændret. */
export function broadcastDataChange(domains: readonly string[] | "all"): void {
  const ch = getChannel();
  if (!ch) return;
  const msg: DataChangeMessage = {
    type: "data_changed",
    domains: domains === "all" ? "all" : [...domains],
  };
  try {
    ch.postMessage(msg);
  } catch {
    // Lukket kanal eller serialiseringsfejl — friskhed er best effort.
  }
}

/** Lyt efter ændringer fra andre faner. Returnerer en afmeldingsfunktion. */
export function subscribeDataChanges(
  handler: (msg: DataChangeMessage) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (event: Event) => {
    const msg = parseDataChangeMessage((event as MessageEvent).data);
    if (msg) handler(msg);
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}

/** Test-only: nulstil den memoiserede kanal. */
export function __resetDataChannelForTests(): void {
  const ch = channel as { close?: () => void } | null | undefined;
  ch?.close?.();
  channel = undefined;
}
