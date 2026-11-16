import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Ruten kaldes med en stub-caller, så testen kun ser hvad der sendes til
// projects.update (#718).
const caller = vi.hoisted(() => ({
  projects: { getById: vi.fn(), update: vi.fn() },
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

import { PATCH } from "./route";

const ID = "22222222-2222-4222-8222-222222222222";
const params = { params: Promise.resolve({ id: ID }) };
const request = (body: unknown) =>
  new Request(`https://timetrack.test/api/v1/projects/${ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  caller.projects.getById.mockResolvedValue({
    id: ID,
    name: "Website",
    description: "Redesign",
    clientId: "client-1",
    hourlyRate: "950.00",
    budgetHours: "80.00",
    status: "active",
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    endDate: null,
  });
  caller.projects.update.mockResolvedValue({});
});

describe("REST PATCH /api/v1/projects/[id] — PATCH-semantik (#718)", () => {
  it("bevarer kunde, sats og budget når kun status sendes", async () => {
    const res = await PATCH(request({ status: "completed" }), params);
    expect(res.status).toBe(200);
    const { data } = caller.projects.update.mock.calls[0][0];
    expect(data).toMatchObject({
      name: "Website",
      clientId: "client-1",
      hourlyRate: "950.00",
      budgetHours: "80.00",
      status: "completed",
      startDate: "2026-09-01T00:00:00.000Z",
    });
  });

  it("rydder kunden ved eksplicit null", async () => {
    await PATCH(request({ clientId: null }), params);
    const { data } = caller.projects.update.mock.calls[0][0];
    expect(data.clientId).toBeNull();
    expect(data.name).toBe("Website");
  });
});
