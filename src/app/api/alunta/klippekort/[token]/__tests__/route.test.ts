import { afterEach, describe, expect, it, vi } from "vitest";

const token = {
  id: "tok_1",
  userId: "user_1",
  organizationId: null,
  isActive: true,
};

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      aluntaKlippekortTokens: { findFirst: vi.fn(async () => token) },
      webhookEvents: { findFirst: vi.fn(async () => undefined) },
      aluntaPlanMappings: {
        findFirst: vi.fn(async () => ({
          id: "map_1",
          clientId: "client_mapped",
          hoursPerPeriod: "10",
          hourlyRate: "800",
          client: { id: "client_mapped", name: "Mappet Kunde ApS" },
        })),
      },
      prepaidPackages: { findFirst: vi.fn(async () => undefined) },
      clients: {
        findFirst: vi.fn(async () => ({
          id: "client_cvr",
          name: "Testkunde ApS",
        })),
      },
    },
    // Pakke-oprettelsen er ikke i fokus her; fejlen fanges af handleren.
    transaction: vi.fn(async () => {
      throw new Error("ikke mocket");
    }),
    insert: () => ({ values: async () => undefined }),
  },
}));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
vi.mock("@/lib/email/alunta-klippekort", () => ({
  sendAluntaKlippekortCreatedEmail: vi.fn(),
}));

import { POST } from "../route";

const payload = {
  event: "invoice.created",
  timestamp: "2026-11-10T10:00:00Z",
  data: {
    plan: { uuid: "plan_1", name: "10 timer" },
    invoice: { uuid: "inv_1", status: "paid" },
    customer: {
      uuid: "cust_1",
      reg_number: "12345678",
      name: "Testkunde ApS",
      email: "anna@example.com",
    },
  },
};

describe("POST /api/alunta/klippekort/[token]", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logger hverken payload-data, CVR eller kundenavn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      new Request("http://localhost/api/alunta/klippekort/abc", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ token: "abc" }) },
    );
    expect(res.status).toBe(200);

    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).toContain("CVR match");
    expect(logged).not.toContain("Testkunde ApS");
    expect(logged).not.toContain("12345678");
    expect(logged).not.toContain("anna@example.com");
  });
});
