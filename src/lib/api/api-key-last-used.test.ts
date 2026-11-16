import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, set, update } = vi.hoisted(() => {
  const where = vi.fn(() => Promise.resolve());
  const set = vi.fn((_values: Record<string, unknown>) => ({ where }));
  return { findFirst: vi.fn(), set, update: vi.fn(() => ({ set })) };
});

vi.mock("@/lib/db", () => ({
  db: { query: { apiKeys: { findFirst } }, update },
}));
vi.mock("@/lib/trpc/routers/index", () => ({
  appRouter: { createCaller: vi.fn(() => ({})) },
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  getClientIp: (h: Headers) => h.get("x-forwarded-for") ?? "unknown",
  ipRateLimitKey: (ip: string) => `ip:${ip}`,
  userRateLimitKey: (id: string) => `user:${id}`,
  RATE_LIMIT_CONFIGS: {
    api: { maxRequests: 100 },
    apiAuth: { maxRequests: 5 },
  },
  rateLimiter: {
    check: vi.fn(async () => ({ allowed: true, remaining: 99, resetIn: 1000 })),
    reset: vi.fn(async () => {}),
  },
}));

import { verifyMcpToken } from "./mcp-auth";
import { authenticateApiKey } from "./middleware";

const MINUTE = 60_000;

function keyRow(lastUsedAt: Date | null, lastUsedIp: string | null) {
  return {
    id: "key-1",
    userId: "u1",
    organizationId: "org-1",
    scopes: [],
    isRevoked: false,
    expiresAt: null,
    lastUsedAt,
    lastUsedIp,
  };
}

function request(ip = "1.2.3.4") {
  return {
    headers: new Headers({
      authorization: "Bearer tk_live_abc",
      "x-forwarded-for": ip,
    }),
  } as unknown as NextRequest;
}

describe("api_keys.last_used_at skrives højst hvert 5. minut", () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockClear();
    set.mockClear();
  });

  it("springer skrivningen over, når nøglen blev brugt for lidt siden fra samme IP", async () => {
    findFirst.mockResolvedValue(
      keyRow(new Date(Date.now() - 2 * MINUTE), "1.2.3.4"),
    );
    const res = await authenticateApiKey(request());
    expect("context" in res).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it("skriver, når seneste brug er ældre end 5 minutter", async () => {
    findFirst.mockResolvedValue(
      keyRow(new Date(Date.now() - 6 * MINUTE), "1.2.3.4"),
    );
    await authenticateApiKey(request());
    expect(update).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0]).toMatchObject({ lastUsedIp: "1.2.3.4" });
  });

  it("skriver med det samme ved ny IP", async () => {
    findFirst.mockResolvedValue(
      keyRow(new Date(Date.now() - 1 * MINUTE), "9.9.9.9"),
    );
    await authenticateApiKey(request("1.2.3.4"));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skriver første gang en nøgle bruges", async () => {
    findFirst.mockResolvedValue(keyRow(null, null));
    await authenticateApiKey(request());
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("MCP: springer over inden for 5 minutter og skriver bagefter", async () => {
    findFirst.mockResolvedValue(keyRow(new Date(Date.now() - MINUTE), null));
    await verifyMcpToken(new Request("http://x"), "tk_live_abc");
    expect(update).not.toHaveBeenCalled();

    findFirst.mockResolvedValue(
      keyRow(new Date(Date.now() - 6 * MINUTE), null),
    );
    await verifyMcpToken(new Request("http://x"), "tk_live_abc");
    expect(update).toHaveBeenCalledTimes(1);
  });
});
