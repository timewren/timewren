import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Falsk ioredis: forbindelser bliver "ready" efter state.readyDelayMs, afviser
// kommandoer før da (som enableOfflineQueue: false), og PUBLISH leverer
// til alle forbindelser der har PSUBSCRIBE'et et matchende mønster.
const fake = vi.hoisted(() => ({
  state: { readyDelayMs: 30, instances: 0 },
  subscribers: new Set<{
    patterns: Set<string>;
    emit: (event: string, ...args: unknown[]) => boolean;
  }>(),
}));

vi.mock("ioredis", async () => {
  const { EventEmitter } = await import("node:events");
  const { state, subscribers } = fake;

  class FakeRedis extends EventEmitter {
    status = "connecting";
    patterns = new Set<string>();
    timer: ReturnType<typeof setTimeout> | null = null;
    constructor() {
      super();
      state.instances++;
      if (Number.isFinite(state.readyDelayMs)) {
        this.timer = setTimeout(() => {
          this.status = "ready";
          this.emit("ready");
        }, state.readyDelayMs);
      }
    }
    private assertReady() {
      if (this.status !== "ready") {
        throw new Error(
          "Stream isn't writeable and enableOfflineQueue options is false",
        );
      }
    }
    async psubscribe(pattern: string) {
      this.assertReady();
      this.patterns.add(pattern);
      subscribers.add(this);
      return 1;
    }
    async publish(channel: string, message: string) {
      this.assertReady();
      let n = 0;
      for (const s of subscribers) {
        for (const p of s.patterns) {
          if (p.endsWith("*") && channel.startsWith(p.slice(0, -1))) {
            s.emit("pmessage", p, channel, message);
            n++;
          }
        }
      }
      return n;
    }
    async quit() {
      if (this.timer) clearTimeout(this.timer);
      subscribers.delete(this);
      this.status = "end";
      return "OK";
    }
  }
  return { default: FakeRedis };
});
vi.mock("@sentry/nextjs", () => ({ captureEvent: vi.fn() }));

import {
  __resetRealtimeForTests,
  getRealtimeStatus,
  probeRealtime,
} from "@/lib/realtime";
import { __resetValkeyForTests } from "@/lib/valkey";

// Regression (3/10-2026): stabilitetsvagtens første kørsel efter et deploy
// meldte "Realtime nede: prøvebesked kom ikke frem". Abonnent og
// kommando-klient oprettes dovent, så i en frisk proces uden åbne faner blev
// prøven sendt, før nogen af dem var klar.
describe("probeRealtime i en kold proces", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.REALTIME_ENABLED = "true";
    process.env.VALKEY_URL = "redis://fake:6379";
    fake.state.readyDelayMs = 30;
    fake.state.instances = 0;
    __resetRealtimeForTests();
    __resetValkeyForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __resetRealtimeForTests();
    __resetValkeyForTests();
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("venter på abonnent og klient og melder ok", async () => {
    const probe = await probeRealtime(500, 1000);
    expect(probe?.ok).toBe(true);
    expect(getRealtimeStatus().subscribed).toBe(true);
  });

  it("uden ventetid fejler prøven (den gamle adfærd)", async () => {
    const probe = await probeRealtime(100, 0);
    expect(probe?.ok).toBe(false);
  });

  it("melder ikke ok hvis forbindelsen aldrig bliver klar", async () => {
    fake.state.readyDelayMs = Number.POSITIVE_INFINITY;
    const probe = await probeRealtime(50, 100);
    expect(probe?.ok).toBe(false);
    expect(getRealtimeStatus().subscribed).toBe(false);
  });

  it("prøver ikke (null) og forbinder ikke når realtime er slået fra", async () => {
    process.env.REALTIME_ENABLED = "false";
    expect(await probeRealtime(50, 100)).toBeNull();
    expect(fake.state.instances).toBe(0);
  });

  it("prøver ikke (null) uden VALKEY_URL", async () => {
    delete process.env.VALKEY_URL;
    expect(await probeRealtime(50, 100)).toBeNull();
    expect(fake.state.instances).toBe(0);
  });
});
