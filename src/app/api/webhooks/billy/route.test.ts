/**
 * Billy-webhooken markerer fakturaer betalt (#1113): en forfalsket eller
 * fremmed besked må aldrig flytte en fakturas status, og et ægte
 * `invoice.paid` skal ramme NETOP den faktura, Billy-id'et peger på — inden
 * for afsenderens org.
 */
import crypto from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));

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
         * slås op på `users.billy_organization_id` med beskedens
         * organizationId. Slås der op på en anden kolonne, rammer webhooken
         * ingen bruger — en forkert kolonne kunne ellers markere en anden
         * lejers faktura betalt uden at en test sagde noget.
         */
        users: {
          findFirst: async (args: { where: unknown }) => {
            state.userQueries.push(args.where);
            if (!state.user) return undefined;
            // biome-ignore lint/suspicious/noExplicitAny: SQL-typen er ikke i scope her
            const { sql, params } = dialect.sqlToQuery(args.where as any);
            const matches =
              sql.includes("billy_organization_id") &&
              params.includes(state.user.billyOrganizationId);
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
          where: (where: unknown) => {
            state.updates.push({
              set,
              // biome-ignore lint/suspicious/noExplicitAny: SQL-typen er ikke i scope her
              params: dialect.sqlToQuery(where as any).params,
            });
            // markInvoicePaid (#1110) læser den opdaterede række tilbage
            return Object.assign(Promise.resolve(), {
              returning: async () => [{ ...state.invoice, ...set }],
            });
          },
        }),
      }),
    },
  };
});

const { POST } = await import("./route");

const SECRET = "billy-test-secret";
const BILLY_ORG = "billy-org-1";
const USER_ID = "user-1";
const INVOICE_ID = "invoice-1";

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "invoice.paid",
    organizationId: BILLY_ORG,
    timestamp: "2026-11-01T10:00:00Z",
    data: {
      invoice: {
        id: "billy-inv-1",
        invoiceNo: 42,
        state: "paid",
        contactId: "billy-contact-1",
        grossAmount: 3750,
        currency: "DKK",
        paymentDate: "2026-11-01",
      },
    },
    ...over,
  });
}

const sign = (body: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(body).digest("hex");

function post(
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
) {
  return POST(
    new Request("http://localhost/api/webhooks/billy", {
      method: "POST",
      headers,
      body,
    }),
  );
}

const signedPost = (body: string) =>
  post(body, {
    "content-type": "application/json",
    "x-billy-signature": sign(body),
  });

beforeEach(() => {
  state.user = { id: USER_ID, billyOrganizationId: BILLY_ORG };
  state.membership = { organizationId: "team-org-1" };
  state.invoice = {
    id: INVOICE_ID,
    invoiceNumber: "INV-042",
    billyInvoiceId: "billy-inv-1",
  };
  state.invoiceQueries = [];
  state.userQueries = [];
  state.updates = [];
  state.inserts = [];
  vi.stubEnv("BILLY_WEBHOOK_SECRET", SECRET);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Billy-webhook: adgang", () => {
  it("afviser en besked uden signatur", async () => {
    const res = await post(payload());

    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("afviser en forkert signatur", async () => {
    const body = payload();
    const res = await post(body, {
      "content-type": "application/json",
      "x-billy-signature": sign(body, "forkert-hemmelighed"),
    });

    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("afviser en signatur med forkert længde (timingSafeEqual kaster)", async () => {
    const res = await post(payload(), {
      "content-type": "application/json",
      "x-billy-signature": "kort",
    });

    expect(res.status).toBe(401);
  });

  it("afviser en ændret body med den gamle signatur", async () => {
    const original = payload();
    const tampered = payload({ organizationId: "en-anden-org" });
    const res = await post(tampered, {
      "content-type": "application/json",
      "x-billy-signature": sign(original),
    });

    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("svarer 500 når hemmeligheden ikke er sat", async () => {
    vi.stubEnv("BILLY_WEBHOOK_SECRET", "");
    const body = payload();

    const res = await post(body, {
      "content-type": "application/json",
      "x-billy-signature": sign(body),
    });

    expect(res.status).toBe(500);
    expect(state.updates).toEqual([]);
  });

  it("afviser andet end JSON", async () => {
    const res = await post(payload(), { "content-type": "text/plain" });

    expect(res.status).toBe(415);
  });

  it("afviser ugyldig JSON med gyldig signatur", async () => {
    const res = await signedPost("{ikke-json");

    expect(res.status).toBe(400);
    expect(state.updates).toEqual([]);
  });
});

describe("Billy-webhook: invoice.paid", () => {
  it("markerer fakturaen betalt med Billys betalingsdato", async () => {
    const res = await signedPost(payload());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });

    const paid = state.updates.find((u) => u.set.status === "paid");
    expect(paid?.set.paidDate).toEqual(new Date("2026-11-01"));
    expect(paid?.params).toContain(INVOICE_ID);
    // Hændelsen logges, og loggen lukkes som success med 1 behandlet.
    expect(state.inserts[0]).toMatchObject({
      userId: USER_ID,
      integrationType: "billy",
      operation: "webhook_invoice.paid",
      status: "pending",
    });
    expect(
      state.updates.find((u) => u.set.itemsProcessed === 1)?.set.status,
    ).toBe("success");
  });

  it("matcher fakturaen i afsenderens org, ikke kun hans egne rækker", async () => {
    await signedPost(payload());

    const params = new PgDialect().sqlToQuery(
      state.invoiceQueries[0] as SQL,
    ).params;
    expect(params).toContain("billy-inv-1");
    expect(params).toContain("team-org-1");
  });

  it("falder tilbage til bruger-scope når der ingen org er", async () => {
    state.membership = null;

    await signedPost(payload());

    const params = new PgDialect().sqlToQuery(
      state.invoiceQueries[0] as SQL,
    ).params;
    expect(params).toContain(USER_ID);
  });

  it("rører ingen faktura når Billy-id'et er ukendt", async () => {
    state.invoice = null;

    const res = await signedPost(payload());

    expect(res.status).toBe(200);
    expect(state.updates.some((u) => u.set.status === "paid")).toBe(false);
    expect(
      state.updates.find((u) => "itemsProcessed" in u.set)?.set,
    ).toMatchObject({ itemsProcessed: 0 });
  });

  it("slår lejeren op på Billy-org-kolonnen, ikke på bruger-id", async () => {
    await signedPost(payload());

    const { sql, params } = new PgDialect().sqlToQuery(
      state.userQueries[0] as SQL,
    );
    expect(sql).toContain("billy_organization_id");
    expect(params).toEqual([BILLY_ORG]);
  });

  it("behandler ikke en besked fra en ukendt Billy-org", async () => {
    // Nøglen i beskeden hører til en Billy-org ingen bruger har koblet.
    const res = await signedPost(payload({ organizationId: "fremmed-org" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      received: true,
      processed: false,
    });
    expect(state.inserts).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("markerer intet betalt uden faktura-data i beskeden", async () => {
    const res = await signedPost(payload({ data: {} }));

    expect(res.status).toBe(200);
    expect(state.updates.some((u) => u.set.status === "paid")).toBe(false);
  });
});

describe("Billy-webhook: øvrige hændelser", () => {
  it("markerer ikke betalt på invoice.approved", async () => {
    const res = await signedPost(payload({ event: "invoice.approved" }));

    expect(res.status).toBe(200);
    expect(state.updates.some((u) => u.set.status === "paid")).toBe(false);
    expect(state.updates.at(-1)?.set).toMatchObject({
      status: "success",
      itemsProcessed: 1,
    });
  });

  it("logger en ukendt hændelse som behandlet uden ændringer", async () => {
    const res = await signedPost(payload({ event: "invoice.voided" }));

    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].set).toMatchObject({
      status: "success",
      itemsProcessed: 0,
    });
  });
});
