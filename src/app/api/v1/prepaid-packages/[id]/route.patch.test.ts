import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Ruten kaldes med en stub-caller, så testen kun ser hvad der sendes til
// prepaid.update (#718).
const caller = vi.hoisted(() => ({
  prepaid: { getById: vi.fn(), update: vi.fn() },
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

const ID = "33333333-3333-4333-8333-333333333333";
const params = { params: Promise.resolve({ id: ID }) };
const request = (body: unknown) =>
  new Request(`https://timetrack.test/api/v1/prepaid-packages/${ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  caller.prepaid.getById.mockResolvedValue({
    id: ID,
    name: "20 timer",
    clientId: "client-1",
    totalHours: "20.00",
    hourlyRate: "800.00",
    purchaseDate: new Date("2026-08-01T00:00:00.000Z"),
    expiryDate: new Date("2027-08-01T00:00:00.000Z"),
    description: "Support",
    clipSizeMinutes: 15,
  });
  caller.prepaid.update.mockResolvedValue({});
});

describe("REST PATCH /api/v1/prepaid-packages/[id] — PATCH-semantik (#718)", () => {
  it("bevarer udløb, beskrivelse og klip-størrelse når kun navnet sendes", async () => {
    const res = await PATCH(request({ name: "Nyt navn" }), params);
    expect(res.status).toBe(200);
    const { data } = caller.prepaid.update.mock.calls[0][0];
    expect(data).toEqual({
      name: "Nyt navn",
      clientId: "client-1",
      totalHours: 20,
      hourlyRate: 800,
      purchaseDate: "2026-08-01T00:00:00.000Z",
      expiryDate: "2027-08-01T00:00:00.000Z",
      description: "Support",
      clipSizeMinutes: 15,
    });
  });

  it("rydder udløbsdatoen ved eksplicit null", async () => {
    await PATCH(request({ expiryDate: null }), params);
    const { data } = caller.prepaid.update.mock.calls[0][0];
    expect(data.expiryDate).toBeUndefined();
    expect(data.description).toBe("Support");
  });

  it("afviser en body der ikke er et objekt", async () => {
    const res = await PATCH(request([1, 2]), params);
    expect(res.status).toBe(400);
    expect(caller.prepaid.update).not.toHaveBeenCalled();
  });
});
