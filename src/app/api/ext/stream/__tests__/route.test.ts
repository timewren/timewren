import { TRPCError } from "@trpc/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/ext/stream: token i Authorization-headeren, kanaler for brugeren og
 * den verificerede org, kun type/version i hændelserne, ping hvert 25. s og
 * lukning når tokenet tilbagekaldes.
 */

type Listener = (channel: string, message: string) => void;

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authenticateById: vi.fn(),
  listeners: [] as Array<{ channels: string[]; listener: Listener }>,
  unsubscribe: vi.fn(),
  rateCheck: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 0 })),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/trpc/routers/ext/device-procedure", () => ({
  authenticateDeviceToken: mocks.authenticate,
  authenticateDeviceTokenById: mocks.authenticateById,
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  getClientIp: () => "1.2.3.4",
  ipRateLimitKey: (ip: string, key: string) => `${key}:${ip}`,
  rateLimiter: { check: mocks.rateCheck },
}));
vi.mock("@/lib/realtime", () => ({
  addTimerListener: (channels: string[], listener: Listener) => {
    mocks.listeners.push({ channels, listener });
    return mocks.unsubscribe;
  },
  getRealtimeStatus: () => ({ subscribed: true }),
  orgChannel: (orgId: string) => `timer:org:${orgId}`,
  userChannel: (userId: string) => `timer:user:${userId}`,
}));

const { GET } = await import("../route");

function request(token: string | null, query = "") {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return GET(
    new NextRequest(`http://localhost/api/ext/stream${query}`, { headers }),
  );
}

async function readSome(res: Response, chunks: number): Promise<string> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let i = 0; i < chunks; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  reader.releaseLock();
  return text;
}

describe("GET /api/ext/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.length = 0;
    vi.stubEnv("REALTIME_ENABLED", "true");
    const auth = {
      tokenId: "t1",
      userId: "user-1",
      orgId: "org-1",
      user: { id: "user-1", name: "X", email: "x@y.z" },
    };
    mocks.authenticate.mockResolvedValue(auth);
    mocks.authenticateById.mockResolvedValue(auth);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("503 når realtime er slået fra (klienten poller)", async () => {
    vi.stubEnv("REALTIME_ENABLED", "false");
    expect((await request("tok")).status).toBe(503);
  });

  it("401 uden eller med ugyldigt token, 429 når IP'ens budget er brugt", async () => {
    expect((await request(null)).status).toBe(401);
    mocks.authenticate.mockRejectedValueOnce(
      new TRPCError({ code: "UNAUTHORIZED" }),
    );
    expect((await request("forkert")).status).toBe(401);
    mocks.rateCheck.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetIn: 1000,
    });
    mocks.authenticate.mockRejectedValueOnce(
      new TRPCError({ code: "UNAUTHORIZED" }),
    );
    expect((await request("forkert")).status).toBe(429);
  });

  it("403 for en org, brugeren ikke er medlem af", async () => {
    mocks.authenticate.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" }),
    );
    expect((await request("tok", "?organizationId=org-x")).status).toBe(403);
    expect(mocks.authenticate).toHaveBeenCalledWith({}, "tok", "org-x");
  });

  it("abonnerer på brugerens og orgens kanal og sender kun type/version", async () => {
    const res = await request("tok");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(mocks.listeners[0].channels).toEqual([
      "timer:user:user-1",
      "timer:org:org-1",
    ]);

    const { listener } = mocks.listeners[0];
    listener(
      "timer:user:user-1",
      JSON.stringify({
        type: "sync",
        version: 3,
        description: "Hemmelig beskrivelse",
        projectId: "p1",
      }),
    );
    listener(
      "timer:org:org-1",
      JSON.stringify({ type: "data_changed", domains: ["invoices"] }),
    );
    // Kollegaens timer på org-kanalen må ikke komme med.
    listener(
      "timer:org:org-1",
      JSON.stringify({ type: "sync", version: 9, description: "Kollega" }),
    );

    const text = await readSome(res, 4);
    expect(text).toContain(": connected");
    expect(text).toContain("event: ping");
    expect(text).toContain(
      'id: 1\nevent: timer\ndata: {"type":"timer","event":"sync","version":3}',
    );
    expect(text).toContain(
      'id: 2\nevent: data\ndata: {"type":"data","entities":["invoices"]}',
    );
    expect(text).not.toMatch(/Hemmelig|Kollega|p1/);
  });

  it("ping hvert 25. s, og 'revoked' + lukning når tokenet tilbagekaldes", async () => {
    vi.useFakeTimers();
    const res = await request("tok");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    await reader.read(); // connected
    await reader.read(); // første ping

    await vi.advanceTimersByTimeAsync(25_000);
    const ping = decoder.decode((await reader.read()).value);
    expect(ping).toContain("event: ping");
    // Det løbende tjek følger tokenrækken (id), ikke strengen, så en
    // fornyelse af tokenet ikke lukker strømmen.
    expect(mocks.authenticateById).toHaveBeenLastCalledWith({}, "t1", "org-1", {
      recordUse: false,
    });

    mocks.authenticateById.mockRejectedValueOnce(
      new TRPCError({ code: "UNAUTHORIZED" }),
    );
    await vi.advanceTimersByTimeAsync(25_000);
    const revoked = decoder.decode((await reader.read()).value);
    expect(revoked).toContain("event: revoked");
    expect((await reader.read()).done).toBe(true);
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });
});
