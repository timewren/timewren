import Redis from "ioredis";
import { orgSharedDomains } from "@/lib/query/invalidate-domains";
import { getReadyValkey, getValkey } from "@/lib/valkey";

/**
 * Realtime timer events over Valkey pub/sub.
 *
 * Publishing reuses the shared command client (PUBLISH is a normal command).
 * Subscribing needs a DEDICATED connection (a subscriber connection cannot run
 * normal commands), so this module owns one per process. It `PSUBSCRIBE`s to
 * `timer:*` once and fans each message out to the SSE connections that
 * registered interest in that exact channel.
 *
 * Channels:
 *   timer:user:<userId>  — a user's own timer (their devices/tabs)
 *   timer:org:<orgId>    — team-live ("who is tracking now")
 *
 * Everything degrades to a no-op when Valkey is unavailable; the existing
 * polling sync remains the source of truth.
 */

export interface TimerEvent {
  userId: string;
  type: "sync" | "stopping" | "stopped" | "cleared";
  isRunning: boolean;
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  description: string;
  version: number;
  /** Display name for team-live; optional, only set where cheaply available. */
  userName?: string;
}

/**
 * "Data er ændret — hent igen": publiceres efter skrivninger af tidsposter,
 * klippekort og fakturaer, uanset om de kom fra web, extension, mobil,
 * desktop eller API. SSE-ruten sender den som event-navnet "data", så ældre
 * klienter (der kun lytter på "timer"/"team") ignorerer den.
 * `domains` er tRPC-routernavne — se src/lib/query/invalidate-domains.ts.
 */
export interface DataChangedEvent {
  type: "data_changed";
  userId: string;
  domains: string[];
  /** Fanen der lavede ændringen (`x-tt-tab`), så den kan ignorere sit ekko. */
  origin?: string;
}

export type RealtimeEvent = TimerEvent | DataChangedEvent;

/** SSE-eventnavn for en besked på en kanal. */
export function sseEventName(channel: string, message: string): string {
  if (message.includes('"data_changed"')) {
    try {
      const parsed = JSON.parse(message) as { type?: unknown };
      if (parsed.type === "data_changed") return "data";
    } catch {
      // Ikke JSON — behandles som et timer-event nedenfor.
    }
  }
  return channel.startsWith("timer:org:") ? "team" : "timer";
}

export function userChannel(userId: string): string {
  return `timer:user:${userId}`;
}

export function orgChannel(orgId: string): string {
  return `timer:org:${orgId}`;
}

/** Publish a timer event to the user's channel and (if given) the org channel. */
export async function publishTimerEvent(
  userId: string,
  orgId: string | null,
  event: TimerEvent,
): Promise<void> {
  // Realtime is opt-in (the SSE consumer in /api/realtime is gated on the same
  // flag). When it's off there's nothing subscribed to publish to, so skip the
  // Valkey round-trip entirely — this also silences the noisy "stream isn't
  // writeable" errors that fired on every timer sync while realtime was dark.
  if (process.env.REALTIME_ENABLED !== "true") return;

  const client = getReadyValkey();
  if (!client) return;
  try {
    const msg = JSON.stringify(event);
    await client.publish(userChannel(userId), msg);
    if (orgId) {
      await client.publish(orgChannel(orgId), msg);
    }
    realtimeState.lastPublishAt = new Date();
  } catch (err) {
    // Non-fatal: the DB write already succeeded; polling will catch up.
    console.error("[realtime] publish error:", err);
  }
}

/**
 * Publicér et `data_changed`-event. Brugerens egen kanal får alle domæner;
 * org-kanalen kun de org-delte (klippekort, kunder, projekter, team), så en
 * kollegas tidspost ikke refetcher hele din tidsliste. Fejl er ikke fatale —
 * fokus-refetch og polling er reservekanalerne.
 */
export async function publishDataChanged(
  userId: string,
  orgId: string | null | undefined,
  domains: readonly string[],
  origin?: string | null,
): Promise<void> {
  if (process.env.REALTIME_ENABLED !== "true") return;
  if (domains.length === 0) return;

  const client = getReadyValkey();
  if (!client) return;
  try {
    const own: DataChangedEvent = {
      type: "data_changed",
      userId,
      domains: [...domains],
      ...(origin ? { origin } : {}),
    };
    await client.publish(userChannel(userId), JSON.stringify(own));
    const shared = orgSharedDomains(domains);
    if (orgId && shared.length > 0) {
      const org: DataChangedEvent = { ...own, domains: shared };
      await client.publish(orgChannel(orgId), JSON.stringify(org));
    }
    realtimeState.lastPublishAt = new Date();
  } catch (err) {
    console.error("[realtime] data publish error:", err);
  }
}

// ─── Subscriber (one per process) ──────────────────────────────────────────

type Listener = (channel: string, message: string) => void;

const channelListeners = new Map<string, Set<Listener>>();
let subscriber: Redis | null | undefined;

/**
 * PSUBSCRIBE først når forbindelsen er klar — og igen ved hver genforbindelse.
 * Med `enableOfflineQueue: false` afvises en kommando sendt før "ready"
 * ("Stream isn't writeable"), og ioredis gen-abonnerer kun på kanaler der
 * faktisk lykkedes. Før blev psubscribe kaldt med det samme ved opstart, så
 * efter hvert deploy havde processen 0 abonnementer: realtime var død, og
 * faner opdagede først et stop fra en anden enhed ved næste poll.
 * Gentaget PSUBSCRIBE på samme mønster er idempotent.
 */
export function subscribeWhenReady(
  s: Pick<Redis, "status" | "on" | "psubscribe">,
): void {
  const subscribe = () => {
    s.psubscribe("timer:*")
      .then(() => {
        realtimeState.subscribed = true;
        realtimeState.lastSubscribedAt = new Date();
        realtimeState.lastError = null;
      })
      .catch((err: unknown) => {
        realtimeState.subscribed = false;
        realtimeState.lastError =
          err instanceof Error ? err.message : String(err);
        console.error("[realtime] psubscribe failed:", err);
      });
  };
  s.on("ready", subscribe);
  // Forbindelsen er væk: abonnementet er det også, indtil næste "ready".
  s.on("close", () => {
    realtimeState.subscribed = false;
  });
  if (s.status === "ready") subscribe();
}

// ─── Sundhed (stabilitetsvagten + /api/health) ────────────────────────────

const realtimeState: {
  subscribed: boolean;
  lastSubscribedAt: Date | null;
  lastMessageAt: Date | null;
  lastPublishAt: Date | null;
  lastError: string | null;
} = {
  subscribed: false,
  lastSubscribedAt: null,
  lastMessageAt: null,
  lastPublishAt: null,
  lastError: null,
};

export interface RealtimeStatus {
  /** REALTIME_ENABLED=true */
  enabled: boolean;
  /** VALKEY_URL sat */
  configured: boolean;
  /** Processens PSUBSCRIBE timer:* er aktiv lige nu */
  subscribed: boolean;
  lastSubscribedAt: Date | null;
  /** Seneste besked modtaget på abonnementet (alle kanaler) */
  lastMessageAt: Date | null;
  /** Seneste vellykkede PUBLISH fra denne proces */
  lastPublishAt: Date | null;
  lastError: string | null;
}

/**
 * Processens realtime-tilstand. Starter abonnenten, hvis realtime er slået
 * til (ellers ville en proces uden åbne SSE-forbindelser altid se "ikke
 * abonneret" ud, selvom intet er galt).
 */
export function getRealtimeStatus(): RealtimeStatus {
  const enabled = process.env.REALTIME_ENABLED === "true";
  const configured = !!process.env.VALKEY_URL;
  if (enabled && configured) getSubscriber();
  return {
    enabled,
    configured,
    subscribed: realtimeState.subscribed,
    lastSubscribedAt: realtimeState.lastSubscribedAt,
    lastMessageAt: realtimeState.lastMessageAt,
    lastPublishAt: realtimeState.lastPublishAt,
    lastError: realtimeState.lastError,
  };
}

/**
 * Vent (højst `timeoutMs`) på at processens abonnent er abonneret på
 * `timer:*` OG at kommando-klienten kan PUBLISH'e. Begge oprettes dovent: i
 * en frisk proces (lige efter deploy, ingen åbne faner) findes ingen af dem,
 * før nogen beder om dem — og med `enableOfflineQueue: false` afvises en
 * PUBLISH sendt før "ready" med det samme. `false` = ikke klar i tide (eller
 * ingen Valkey).
 */
export async function waitForRealtimeReady(timeoutMs = 3000): Promise<boolean> {
  const sub = getSubscriber();
  const pub = getValkey();
  if (!sub || !pub) return false;
  const deadline = Date.now() + timeoutMs;
  while (!(realtimeState.subscribed && pub.status === "ready")) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

/**
 * Ende-til-ende-prøve: PUBLISH på en health-kanal og vent på at processens
 * egen abonnent modtager den. Kanalen matcher `timer:*`, men ingen SSE-klient
 * lytter på den, så ingen bruger ser prøven. `null` = kunne ikke prøves
 * (realtime slået fra / ingen Valkey).
 */
export async function probeRealtime(
  timeoutMs = 2000,
  readyTimeoutMs = 3000,
): Promise<{ ok: boolean; ms: number } | null> {
  if (process.env.REALTIME_ENABLED !== "true") return null;
  if (!process.env.VALKEY_URL) return null;
  // Uden denne venten sendte en kold proces prøven før abonnenten/klienten
  // var klar og meldte falsk "realtime nede" efter hvert deploy (3/10-2026).
  await waitForRealtimeReady(readyTimeoutMs);
  const client = getValkey();
  if (!client || !getSubscriber()) return null;

  const channel = `timer:healthcheck:${Math.random().toString(36).slice(2)}`;
  const started = Date.now();
  let unsubscribe: () => void = () => {};
  const received = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    unsubscribe = addTimerListener([channel], () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  try {
    await client.publish(channel, "ping");
  } catch (err) {
    unsubscribe();
    realtimeState.lastError = err instanceof Error ? err.message : String(err);
    return { ok: false, ms: Date.now() - started };
  }
  const ok = await received;
  unsubscribe();
  return { ok, ms: Date.now() - started };
}

function getSubscriber(): Redis | null {
  if (subscriber !== undefined) return subscriber;

  const url = process.env.VALKEY_URL;
  if (!url) {
    subscriber = null;
    return subscriber;
  }
  try {
    const s = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: null, // subscriber must keep retrying to stay live
      retryStrategy: (times) => Math.min(times * 200, 5000),
      // ioredis 6 bruger RESP3 som standard; behold RESP2 som i v5.
      protocol: 2,
    });
    s.on("error", (err: Error) => {
      console.error("[realtime] subscriber error:", err.message);
    });
    s.on("pmessage", (_pattern: string, channel: string, message: string) => {
      realtimeState.lastMessageAt = new Date();
      const set = channelListeners.get(channel);
      if (!set) return;
      for (const listener of set) {
        try {
          listener(channel, message);
        } catch (err) {
          console.error("[realtime] listener error:", err);
        }
      }
    });
    subscribeWhenReady(s);
    subscriber = s;
  } catch (err) {
    console.error("[realtime] subscriber init failed:", err);
    subscriber = null;
  }
  return subscriber;
}

/**
 * Register `listener` for the given channels. Returns an unsubscribe function
 * that removes it. The process-wide `PSUBSCRIBE timer:*` stays active; this
 * only manages in-memory fan-out, so registering/unregistering is cheap.
 */
export function addTimerListener(
  channels: string[],
  listener: Listener,
): () => void {
  getSubscriber(); // ensure the psubscribe is active
  for (const channel of channels) {
    let set = channelListeners.get(channel);
    if (!set) {
      set = new Set();
      channelListeners.set(channel, set);
    }
    set.add(listener);
  }
  return () => {
    for (const channel of channels) {
      const set = channelListeners.get(channel);
      if (set) {
        set.delete(listener);
        if (set.size === 0) channelListeners.delete(channel);
      }
    }
  };
}

/** Test-only: dispatch a message as if it came from Valkey. */
export function __dispatchForTests(channel: string, message: string): void {
  const set = channelListeners.get(channel);
  if (set) for (const l of set) l(channel, message);
}

/** Test-only: reset listener registry + subscriber memoization. */
export function __resetRealtimeForTests(): void {
  channelListeners.clear();
  if (subscriber) void subscriber.quit().catch(() => {});
  subscriber = undefined;
  realtimeState.subscribed = false;
  realtimeState.lastSubscribedAt = null;
  realtimeState.lastMessageAt = null;
  realtimeState.lastPublishAt = null;
  realtimeState.lastError = null;
}
