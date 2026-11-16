/**
 * Dinero-webhooken markerer fakturaer betalt (#1113). Samme pengevej som
 * Billy, men signaturen er base64 og felterne har store forbogstaver — en
 * forveksling dér ville betyde, at enhver kunne markere fakturaer betalt.
 */
import crypto from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  membership: null as { organizationId: string } | null,
  invoice: null as Record<string, unknown> | null,
  invoiceQueries: [] as unknown[],
  userQueries: [] as unknown[],
  updates: [] as { set: Record<string, unknown>; params: unknown[] }[],
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", async () => {
  // Rendring inde i factoryen: den kører før testfilens egne imports.
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  return {
    db: {
      query: {
        /**
         * Lejer-opslaget honorerer sin nøgle: brugeren findes KUN hvis der
         * slås op på `users.dinero_organization_id` med beskedens
         * OrganizationId. En forkert kolonne kunne ellers markere en anden
         * lejers faktura betalt uden at en test sagde noget.
         */
        users: {
          findFirst: async (args: { where: unknown }) => {
            state.userQueries.push(args.where);
            if (!state.user) return undefined;
            // biome-ignore lint/suspicious/noExplicitAny: SQL-typen er ikke i scope her
            const { sql, params } = dialect.sqlToQuery(args.where as any);
            const matches =
              sql.includes("dinero_organization_id") &&
              params.includes(state.user.dineroOrganizationId);
            return matches ? state.user : undefined;
          },
        },
        members: { findFirst: async () => state.membership ?? undefined },
        invoices: {
          findFirst: async (args: { where: unknown }) => {
            state.invoiceQueries.push(args.where);
            return state.invoice ?? undefined;
          },
        },
      },
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            state.inserts.push(values);
            return [{ id: `log-${state.inserts.length}` }];
          },
        }),
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: async (where: unknown) => {
            state.updates.push({
              set,
              // biome-ignore lint/suspicious/noExplicitAny: SQL-typen er ikke i scope her
              params: dialect.sqlToQuery(where as any).params,
            });
          },
        }),
      }),
    },
  };
});

const { POST } = await import("./route");

const SECRET = "dinero-test-secret";
const DINERO_ORG = 424242;
const USER_ID = "user-1";
const INVOICE_ID = "invoice-1";
const GUID = "11111111-2222-3333-4444-555555555555";

function payload(over: Record<string, unknown> = {}) {
  const { Data, ...rest } = over as {
    Data?: Record<string, unknown>;
  } & Record<string, unknown>;
  return JSON.stringify({
    EventType: "InvoicePaid",
    Timestamp: "2026-11-01T10:00:00Z",
    Data: {
      OrganizationId: DINERO_ORG,
      InvoiceId: GUID,
      InvoiceNumber: "42",
      Amount: 3750,
      Currency: "DKK",
      PaymentDate: "2026-11-01",
      ...Data,
    },
    ...rest,
  });
}

const sign = (body: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(body).digest("base64");

function post(body: string, headers: Record<string, string>) {
  return POST(
    new Request("http://localhost/api/webhooks/dinero", {
      method: "POST",
      headers,
      body,
    }),
  );
}

const signedPost = (body: string) =>
  post(body, {
    "content-type": "application/json",
    "x-dinero-signature": sign(body),
  });

const whereParams = (index = 0) =>
  new PgDialect().sqlToQuery(state.invoiceQueries[index] as SQL).params;

beforeEach(() => {
  state.user = { id: USER_ID, dineroOrganizationId: String(DINERO_ORG) };
  state.membership = { organizationId: "team-org-1" };
  state.invoice = {
    id: INVOICE_ID,
    invoiceNumber: "INV-042",
    dineroInvoiceGuid: GUID,
  };
  state.invoiceQueries = [];
  state.userQueries = [];
  state.updates = [];
  state.inserts = [];
  vi.stubEnv("DINERO_WEBHOOK_SECRET", SECRET);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Dinero-webhook: adgang", () => {
  it("afviser uden signatur, med forkert signatur og med hex i stedet for base64", async () => {
    const body = payload();
    const hex = crypto.createHmac("sha256", SECRET).update(body).digest("hex");

    const variants: Record<string, string>[] = [
      { "content-type": "application/json" },
      {
        "content-type": "application/json",
        "x-dinero-signature": sign(body, "forkert"),
      },
      { "content-type": "application/json", "x-dinero-signature": hex },
    ];
    for (const headers of variants) {
      const res = await post(body, headers);
      expect(res.status).toBe(401);
    }
    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("svarer 500 uden hemmelighed, 415 uden JSON og 400 på ugyldig JSON", async () => {
    const body = payload();
    vi.stubEnv("DINERO_WEBHOOK_SECRET", "");
    expect(
      (
        await post(body, {
          "content-type": "application/json",
          "x-dinero-signature": sign(body),
        })
      ).status,
    ).toBe(500);

    vi.stubEnv("DINERO_WEBHOOK_SECRET", SECRET);
    expect(
      (
        await post(body, {
          "content-type": "text/plain",
          "x-dinero-signature": sign(body),
        })
      ).status,
    ).toBe(415);
    expect((await signedPost("{ikke-json")).status).toBe(400);
    expect(state.updates).toEqual([]);
  });
});

describe("Dinero-webhook: InvoicePaid", () => {
  it("markerer fakturaen betalt med Dineros betalingsdato", async () => {
    const res = await signedPost(payload());

    expect(res.status).toBe(200);
    const paid = state.updates.find((u) => u.set.status === "paid");
    expect(paid?.set.paidDate).toEqual(new Date("2026-11-01"));
    expect(paid?.params).toContain(INVOICE_ID);
    expect(state.inserts[0]).toMatchObject({
      userId: USER_ID,
      integrationType: "dinero",
      operation: "webhook_invoicepaid",
      status: "pending",
    });
  });

  it("slår op på GUID inden for afsenderens org", async () => {
    await signedPost(payload());

    expect(whereParams()).toContain(GUID);
    expect(whereParams()).toContain("team-org-1");
  });

  it("falder tilbage til bruger-scope uden org", async () => {
    state.membership = null;

    await signedPost(payload());

    expect(whereParams()).toContain(USER_ID);
  });

  it("rører ingen faktura når GUID'et er ukendt", async () => {
    state.invoice = null;

    await signedPost(payload());

    expect(state.updates.some((u) => u.set.status === "paid")).toBe(false);
    expect(
      state.updates.find((u) => "itemsProcessed" in u.set)?.set,
    ).toMatchObject({ itemsProcessed: 0 });
  });

  it("slår lejeren op på Dinero-org-kolonnen, ikke på bruger-id", async () => {
    await signedPost(payload());

    const { sql, params } = new PgDialect().sqlToQuery(
      state.userQueries[0] as SQL,
    );
    expect(sql).toContain("dinero_organization_id");
    // Dinero sender et tal; opslaget sker på strengen i kolonnen.
    expect(params).toEqual([String(DINERO_ORG)]);
  });

  it("behandler ikke en besked fra en ukendt Dinero-org", async () => {
    // Nøglen i beskeden hører til en Dinero-org ingen bruger har koblet.
    const res = await signedPost(payload({ Data: { OrganizationId: 999999 } }));

    await expect(res.json()).resolves.toEqual({
      received: true,
      processed: false,
    });
    expect(state.inserts).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("gør intet uden OrganizationId i beskeden", async () => {
    const res = await signedPost(
      payload({ Data: { OrganizationId: undefined } }),
    );

    await expect(res.json()).resolves.toEqual({
      received: true,
      processed: false,
    });
    expect(state.updates).toEqual([]);
  });

  it("markerer intet betalt uden InvoiceId", async () => {
    await signedPost(payload({ Data: { InvoiceId: undefined } }));

    expect(state.updates.some((u) => u.set.status === "paid")).toBe(false);
  });
});

describe("Dinero-webhook: øvrige hændelser", () => {
  it("markerer ikke betalt på InvoiceBooked, InvoiceSent og kontakt-hændelser", async () => {
    for (const EventType of [
      "InvoiceBooked",
      "InvoiceSent",
      "ContactCreated",
      "ContactUpdated",
    ]) {
      state.updates = [];
      const res = await signedPost(payload({ EventType }));

      expect(res.status).toBe(200);
      expect(state.updates.some((u) => u.set.status === "paid")).toBe(false);
      expect(state.updates.at(-1)?.set).toMatchObject({
        status: "success",
        itemsProcessed: 1,
      });
    }
  });

  it("logger en ukendt hændelse som behandlet uden ændringer", async () => {
    const res = await signedPost(payload({ EventType: "InvoiceDeleted" }));

    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].set).toMatchObject({
      status: "success",
      itemsProcessed: 0,
    });
  });
});
