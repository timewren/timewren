import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Kør handleren direkte (uden CRON_SECRET/cron-log-rækker).
vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));
vi.mock("@/lib/cron/get-user-org", () => ({
  getUserOrgId: async () => "org-1",
}));
vi.mock("@/lib/utils/encryption", () => ({ decrypt: (s: string) => s }));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
const emitted = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/webhooks/events", () => ({
  emitWebhookEvent: (p: Record<string, unknown>) => emitted.push(p),
}));

type Row = {
  id: string;
  invoiceNumber: string;
  organizationId: string;
  status: string;
  kind: string;
  issueDate: Date;
  amount: string;
  billyInvoiceId: string | null;
  dineroInvoiceGuid: string | null;
  economicInvoiceNumber: number | null;
  client: { billyId: string | null };
};

type BillyRow = {
  id: string;
  invoiceNo: number | null;
  type?: string;
  state: string;
  currencyId?: string;
  contactId?: string;
  entryDate: string;
  amount: number;
  grossAmount?: number;
  isPaid: boolean;
  balance: number;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  billy: [] as BillyRow[],
  updates: [] as { set: Record<string, unknown>; params: unknown[] }[],
}));

const dialect = new PgDialect();
const paramsOf = (where: SQL) => dialect.sqlToQuery(where).params;

// Lille in-memory-db: skelner forespørgslerne på deres `columns`, så testen
// ikke afhænger af rækkefølgen. Opdateringer rammer rækken hvis id står i
// WHERE-parametrene og respekterer "billy_invoice_id IS NULL"-vagten.
vi.mock("@/lib/db", () => {
  const open = (r: Row) => r.status === "sent" || r.status === "overdue";
  return {
    db: {
      query: {
        users: {
          findMany: async () => [
            {
              id: "user-1",
              autoSyncInvoices: true,
              billyApiKey: "billy-key",
              dineroApiKey: null,
              dineroRefreshToken: null,
              dineroOrganizationId: null,
              economicAppSecretToken: null,
              economicAgreementGrantToken: null,
            },
          ],
        },
        invoices: {
          findMany: async (args: {
            columns?: Record<string, boolean>;
            where: SQL;
          }) => {
            const cols = Object.keys(args.columns ?? {});
            const params = paramsOf(args.where);
            // Org-scope skal stå i WHERE; rækker fra andre orgs filtreres fra.
            const inOrg = (r: Row) =>
              params.includes("org-1") && r.organizationId === "org-1";
            if (cols.length === 1 && cols[0] === "billyInvoiceId") {
              return state.rows
                .filter((r) => inOrg(r) && r.billyInvoiceId)
                .map((r) => ({ billyInvoiceId: r.billyInvoiceId }));
            }
            if (cols.includes("issueDate")) {
              // gte(issueDate, since): den eneste dato-parameter i WHERE
              const since = params
                .map((p) =>
                  typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p)
                    ? Date.parse(p)
                    : Number.NaN,
                )
                .find((t) => Number.isFinite(t));
              if (since === undefined) throw new Error("mangler datovindue");
              return state.rows.filter(
                (r) =>
                  inOrg(r) &&
                  open(r) &&
                  r.kind === "invoice" &&
                  !r.billyInvoiceId &&
                  r.issueDate.getTime() >= since,
              );
            }
            return state.rows.filter(
              (r) =>
                open(r) &&
                (r.billyInvoiceId ||
                  r.dineroInvoiceGuid ||
                  r.economicInvoiceNumber),
            );
          },
        },
      },
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (where: SQL) => {
            const params = paramsOf(where);
            state.updates.push({ set, params });
            const hit: Row[] = [];
            for (const r of state.rows) {
              if (!params.includes(r.id)) continue;
              if (
                "billyInvoiceId" in set &&
                set.billyInvoiceId &&
                r.billyInvoiceId
              )
                continue;
              Object.assign(r, set);
              hit.push({ ...r });
            }
            return Object.assign(Promise.resolve(), {
              returning: async () => hit,
            });
          },
        }),
      }),
      insert: () => ({ values: async () => undefined }),
    },
  };
});

import { GET } from "./route";

type Result = { itemsProcessed: number; itemsSucceeded: number };
const run = () =>
  (GET as unknown as (r: Request) => Promise<Result>)(
    new Request("http://localhost/api/cron/invoice-sync"),
  );

const recent = (daysAgo: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

function local(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    invoiceNumber: id.toUpperCase(),
    organizationId: "org-1",
    status: "sent",
    kind: "invoice",
    issueDate: recent(3),
    amount: "3000.00",
    billyInvoiceId: null,
    dineroInvoiceGuid: null,
    economicInvoiceNumber: null,
    client: { billyId: null },
    ...over,
  };
}

function billyInv(id: string, over: Partial<BillyRow> = {}): BillyRow {
  return {
    id,
    invoiceNo: Number(id.replace(/\D/g, "")) || null,
    type: "invoice",
    state: "approved",
    currencyId: "DKK",
    entryDate: iso(recent(3)),
    amount: 3000,
    grossAmount: 3750,
    isPaid: false,
    balance: 3750,
    ...over,
  };
}

const row = (id: string) => state.rows.find((r) => r.id === id);

beforeEach(() => {
  state.rows = [];
  state.billy = [];
  state.updates = [];
  emitted.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const single = url.pathname.match(/\/v2\/invoices\/([^/]+)$/);
      if (single) {
        const inv = state.billy.find((b) => b.id === single[1]);
        if (!inv) return new Response("{}", { status: 404 });
        return Response.json({ invoice: inv });
      }
      if (url.pathname.endsWith("/v2/invoices")) {
        return Response.json({ invoices: state.billy });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("invoice-sync cron: kobling af ukoblede Billy-fakturaer (#730)", () => {
  it("kobler en entydig faktura og markerer den betalt i samme kørsel", async () => {
    state.rows = [local("inv-064")];
    state.billy = [billyInv("b200", { isPaid: true, balance: 0 })];

    await run();

    expect(row("inv-064")?.billyInvoiceId).toBe("b200");
    expect(row("inv-064")?.status).toBe("paid");
  });

  it("sender invoice.paid-webhooken når Billy melder betalt (#1110)", async () => {
    state.rows = [local("inv-080", { billyInvoiceId: "b300" })];
    state.billy = [billyInv("b300", { isPaid: true, balance: 0 })];

    await run();

    expect(row("inv-080")?.status).toBe("paid");
    expect(emitted).toEqual([
      expect.objectContaining({
        eventType: "invoice.paid",
        eventId: "inv-080",
        orgId: "org-1",
        data: expect.objectContaining({ previousStatus: "sent" }),
      }),
    ]);
  });

  it("kobler men markerer ikke betalt, når Billy-fakturaen er ubetalt", async () => {
    state.rows = [local("inv-065")];
    state.billy = [billyInv("b201")];

    await run();

    expect(row("inv-065")?.billyInvoiceId).toBe("b201");
    expect(row("inv-065")?.status).toBe("sent");
  });

  it("kobler intet når to Billy-fakturaer har samme dato og beløb", async () => {
    state.rows = [local("inv-066")];
    state.billy = [billyInv("b202"), billyInv("b203")];

    await run();

    expect(row("inv-066")?.billyInvoiceId).toBeNull();
    expect(state.updates.filter((u) => "billyInvoiceId" in u.set)).toHaveLength(
      0,
    );
  });

  it("kobler intet når to TimeTrack-fakturaer deler én Billy-kandidat", async () => {
    state.rows = [local("inv-067"), local("inv-068")];
    state.billy = [billyInv("b204")];

    await run();

    expect(row("inv-067")?.billyInvoiceId).toBeNull();
    expect(row("inv-068")?.billyInvoiceId).toBeNull();
  });

  it("bruger Billy-kontakten til at skille to kunder med samme dato og beløb", async () => {
    state.rows = [
      local("inv-069", { client: { billyId: "c-a" } }),
      local("inv-070", { client: { billyId: "c-b" } }),
    ];
    state.billy = [
      billyInv("b205", { contactId: "c-b" }),
      billyInv("b206", { contactId: "c-a" }),
    ];

    await run();

    expect(row("inv-069")?.billyInvoiceId).toBe("b206");
    expect(row("inv-070")?.billyInvoiceId).toBe("b205");
  });

  it("genbruger ikke en Billy-faktura der allerede er koblet i org'en", async () => {
    state.rows = [
      local("inv-071", { status: "paid", billyInvoiceId: "b207" }),
      local("inv-072"),
    ];
    state.billy = [billyInv("b207", { isPaid: true, balance: 0 })];

    await run();

    expect(row("inv-072")?.billyInvoiceId).toBeNull();
  });

  it("matcher hverken kreditnotaer, fremmed valuta eller bruttobeløb", async () => {
    state.rows = [
      local("inv-073"),
      local("inv-074", { amount: "3750.00" }),
      local("kn-1", { kind: "credit_note", amount: "-3000.00" }),
    ];
    state.billy = [
      billyInv("b208", { type: "creditNote" }),
      billyInv("b209", { currencyId: "EUR" }),
    ];

    await run();

    expect(row("inv-073")?.billyInvoiceId).toBeNull();
    expect(row("inv-074")?.billyInvoiceId).toBeNull();
    expect(row("kn-1")?.billyInvoiceId).toBeNull();
  });

  it("rører ikke fakturaer ældre end vinduet eller fra en anden org", async () => {
    state.rows = [
      local("inv-old", { issueDate: recent(90) }),
      local("inv-other", { organizationId: "org-2" }),
    ];
    state.billy = [
      billyInv("b211", { entryDate: iso(recent(90)) }),
      billyInv("b212"),
    ];

    await run();

    expect(row("inv-old")?.billyInvoiceId).toBeNull();
    expect(row("inv-other")?.billyInvoiceId).toBeNull();
  });

  it("er idempotent: en anden kørsel ændrer intet", async () => {
    state.rows = [local("inv-075")];
    state.billy = [billyInv("b210")];

    await run();
    const linkUpdates = () =>
      state.updates.filter((u) => "billyInvoiceId" in u.set).length;
    const after1 = linkUpdates();
    await run();

    expect(after1).toBe(1);
    expect(linkUpdates()).toBe(1);
    expect(row("inv-075")?.billyInvoiceId).toBe("b210");
  });
});
