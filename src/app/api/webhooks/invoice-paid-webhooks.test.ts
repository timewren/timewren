import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Billy/Dinero "betalt"-webhooks skal sende TimeTracks egen invoice.paid
// videre til brugerens automationer (#1110).

const emitted = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/webhooks/events", () => ({
  emitWebhookEvent: (p: Record<string, unknown>) => emitted.push(p),
}));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));

const invoice = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: async () => ({ id: "user-1" }) },
      members: { findFirst: async () => ({ organizationId: "org-1" }) },
      invoices: { findFirst: async () => ({ ...invoice.current }) },
    },
    insert: () => ({
      values: () => ({ returning: async () => [{ id: "log-1" }] }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () =>
          Object.assign(Promise.resolve(), {
            returning: async () => {
              if (invoice.current.status === "paid") return [];
              Object.assign(invoice.current, set);
              return [{ ...invoice.current }];
            },
          }),
      }),
    }),
  },
}));

import { POST as billyPost } from "./billy/route";
import { POST as dineroPost } from "./dinero/route";

function signed(
  body: unknown,
  secret: string,
  header: string,
  encoding: "hex" | "base64",
) {
  const payload = JSON.stringify(body);
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest(encoding);
  return new Request("http://localhost/api/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json", [header]: sig },
    body: payload,
  });
}

beforeEach(() => {
  emitted.length = 0;
  invoice.current = {
    id: "inv-1",
    userId: "user-1",
    organizationId: "org-1",
    clientId: "client-1",
    invoiceNumber: "INV-001",
    status: "sent",
    paidDate: null,
  };
  vi.stubEnv("BILLY_WEBHOOK_SECRET", "billy-secret");
  vi.stubEnv("DINERO_WEBHOOK_SECRET", "dinero-secret");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const billyPaid = () =>
  signed(
    {
      event: "invoice.paid",
      organizationId: "billy-org",
      timestamp: "2026-11-01T10:00:00Z",
      data: {
        invoice: { id: "b-1", invoiceNo: 1, paymentDate: "2026-11-01" },
      },
    },
    "billy-secret",
    "x-billy-signature",
    "hex",
  );

const dineroPaid = () =>
  signed(
    {
      EventType: "InvoicePaid",
      Timestamp: "2026-11-01T10:00:00Z",
      Data: { OrganizationId: 42, InvoiceId: "d-1", PaymentDate: "2026-11-01" },
    },
    "dinero-secret",
    "x-dinero-signature",
    "base64",
  );

describe.each([
  ["Billy", () => billyPost(billyPaid())],
  ["Dinero", () => dineroPost(dineroPaid())],
])("%s invoice paid-webhook", (_name, send) => {
  it("markerer fakturaen betalt og sender invoice.paid", async () => {
    const res = await send();

    expect(res.status).toBe(200);
    expect(invoice.current.status).toBe("paid");
    expect(invoice.current.paidDate).toEqual(new Date("2026-11-01"));
    expect(emitted).toEqual([
      expect.objectContaining({
        eventType: "invoice.paid",
        eventId: "inv-1",
        orgId: "org-1",
        clientId: "client-1",
        data: expect.objectContaining({ previousStatus: "sent" }),
      }),
    ]);
  });

  it("sender ikke invoice.paid igen ved en gentaget levering", async () => {
    await send();
    await send();

    expect(emitted).toHaveLength(1);
  });
});
