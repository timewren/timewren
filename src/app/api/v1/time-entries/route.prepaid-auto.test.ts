import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

// Kun API-nøgle-opslaget byttes ud; resten af middleware er den rigtige.
const caller = vi.hoisted(() => ({
  time: { create: vi.fn(), getById: vi.fn() },
  projects: { list: vi.fn() },
  prepaid: { getActiveForClient: vi.fn() },
}));
vi.mock("@/lib/api/middleware", async () => {
  const http =
    await vi.importActual<typeof import("@/lib/api/http")>("@/lib/api/http");
  return {
    ...http,
    authenticateApiKey: async () => ({
      context: {
        userId: "user-1",
        scopes: ["*"],
        apiKeyId: "key-1",
        caller,
        rateLimit: { limit: 100, remaining: 99, reset: 0 },
      },
    }),
    requireScope: () => null,
  };
});

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new Request("https://timetrack.test/api/v1/time-entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const base = { description: "Support", hours: 1.5, date: "2026-09-15" };

beforeEach(() => {
  vi.clearAllMocks();
  caller.time.create.mockResolvedValue({
    id: "e1",
    prepaidDeduction: null,
    complianceWarnings: [],
  });
  caller.time.getById.mockResolvedValue({ id: "e1" });
  caller.projects.list.mockResolvedValue([{ id: "p1", clientId: "c-proj" }]);
  caller.prepaid.getActiveForClient.mockResolvedValue([
    {
      id: "pkg-senere",
      autoDeduct: true,
      remainingHours: 10,
      expiryDate: new Date("2099-12-31T00:00:00Z"),
    },
    {
      id: "pkg-først",
      autoDeduct: true,
      remainingHours: 10,
      expiryDate: new Date("2099-06-30T00:00:00Z"),
    },
  ]);
});

describe('POST /api/v1/time-entries — prepaid: "auto" (#422)', () => {
  it("trækker fra kundens kort der udløber først", async () => {
    const res = await POST(
      request({ ...base, clientId: "c1", prepaid: "auto" }),
    );
    expect(res.status).toBe(201);
    expect(caller.prepaid.getActiveForClient).toHaveBeenCalledWith({
      clientId: "c1",
    });
    expect(caller.time.create.mock.calls[0][0].prepaidPackageId).toBe(
      "pkg-først",
    );
  });

  it("finder kunden via projektet", async () => {
    await POST(request({ ...base, projectId: "p1", prepaid: "auto" }));
    expect(caller.prepaid.getActiveForClient).toHaveBeenCalledWith({
      clientId: "c-proj",
    });
  });

  it("opretter uden træk når kunden intet auto-kort har", async () => {
    caller.prepaid.getActiveForClient.mockResolvedValue([]);
    const res = await POST(
      request({ ...base, clientId: "c1", prepaid: "auto" }),
    );
    expect(res.status).toBe(201);
    expect(
      caller.time.create.mock.calls[0][0].prepaidPackageId,
    ).toBeUndefined();
  });

  it("afviser ukendte værdier og auto kombineret med et kort", async () => {
    const bad = await POST(request({ ...base, clientId: "c1", prepaid: "ja" }));
    expect(bad.status).toBe(400);
    const both = await POST(
      request({
        ...base,
        clientId: "c1",
        prepaid: "auto",
        prepaidPackageId: "pkg-x",
      }),
    );
    expect(both.status).toBe(400);
    expect(caller.time.create).not.toHaveBeenCalled();
  });

  it("uden prepaid sendes et eksplicit kort uændret videre", async () => {
    await POST(request({ ...base, clientId: "c1", prepaidPackageId: "pkg-x" }));
    expect(caller.time.create.mock.calls[0][0].prepaidPackageId).toBe("pkg-x");
    expect(caller.prepaid.getActiveForClient).not.toHaveBeenCalled();
  });
});
