/**
 * Faktura-pengevejen (#1113): testene kører den RIGTIGE kode fra
 * src/lib/trpc/routers/invoices.ts — `computeNextInvoiceNumber`,
 * `ensureRealInvoiceNumber`, `update`-mutationens statemaskine og
 * `generateFromTimeEntries` — mod en in-memory-db, der fanger hver skrivning
 * og hver SQL-sætning.
 *
 * Før lå statemaskinen, nummer-optællingen, beløbs-valideringen og
 * linje-summen som kopier i testen selv, så ~30 grønne tests ikke sagde noget
 * om koden i src. Særligt `computeNextInvoiceNumber` (fortløbende numre og
 * advisory lock — et dansk momskrav) var helt udækket.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/email/engagement", () => ({ sendFirstInvoiceEmail: vi.fn() }));
vi.mock("@/lib/email/invoice", () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));
vi.mock("@/lib/org-audit", () => ({ logOrgAudit: vi.fn() }));
vi.mock("../clientAccess", () => ({
  assertClientAccess: vi.fn(),
  getAccessibleClientIds: vi.fn(async () => null),
}));
// Den aktive org og modulrækkerne slås ikke op i en rigtig db her; det er
// `isAuthed` der sætter ctx.orgId, og testene skal køre i ORG.
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-invoices"),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("../enterprise/middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../enterprise/middleware")>()),
  resolveModules: vi.fn(async () => ({
    raw: new Map(),
    isAvailable: () => true,
    isEnabled: () => true,
  })),
}));
// Rolleadgangen pr. modul: `moduleAccess` styrer hvad requireModuleAccess
// svarer, så både et medlem MED og UDEN skriveadgang kan prøves af.
const access = vi.hoisted(() => ({ level: "write" as string }));
vi.mock("@/lib/permissions/role-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions/role-access")>()),
  resolveModuleAccess: vi.fn(async () => access.level),
}));
vi.mock("@/lib/realtime", () => ({ publishDataChanged: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { invoiceLines, invoices, timeEntries } from "@/lib/db/schema";
import { isDraftInvoiceNumber } from "@/lib/invoices/draft-number";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { appCodeOf } from "../../app-code";
import {
  computeNextInvoiceNumber,
  ensureRealInvoiceNumber,
  invoicesRouter,
} from "../invoices";

const USER = "user-invoices";
const ORG = "org-invoices";
const INVOICE_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_1 = "33333333-3333-4333-8333-333333333333";
const ENTRY_2 = "44444444-4444-4444-8444-444444444444";

const dialect = new PgDialect();
const render = (value: unknown) => dialect.sqlToQuery(value as SQL);

/**
 * Rækker `isAuthed` og `hasActiveSubscription` slår op, før resolveren kører.
 * Testene går gennem `createCaller`, så HELE kæden er i spil — login,
 * abonnement, rolleadgang pr. modul og zod-parsingen af inputtet. Kaldes
 * resolveren direkte i stedet, kan en skrivning på pengevejen miste sin
 * `moduleWriteProcedure("invoices")` uden at en test siger noget.
 */
const AUTH_ROWS = {
  users: { id: USER, role: "user" },
  subscriptions: {
    id: "sub-invoices",
    userId: USER,
    organizationId: ORG,
    status: "active",
    planTier: "solo",
    trialEndsAt: new Date("2099-01-01T00:00:00Z"),
    pastDueSince: null,
  },
  members: { userId: USER, organizationId: ORG, role: "owner" },
} as const;

/** Lægger middleware-opslagene oven på testens egne tabel-stubbe. */
function withAuthRows(query: Record<string, unknown>) {
  const stub = (row: unknown) => ({
    findFirst: async () => row,
    findMany: async () => [row],
  });
  return {
    users: stub(AUTH_ROWS.users),
    subscriptions: stub(AUTH_ROWS.subscriptions),
    members: stub(AUTH_ROWS.members),
    employeeProfiles: stub(undefined),
    ...query,
  };
}

/** Caller med headers, så `withClientVersion`/`withLocale` også kører. */
function caller(
  db: { query?: Record<string, unknown> },
  over: {
    query?: Record<string, unknown>;
    session?: { user: { id: string } } | null;
  } = {},
) {
  return invoicesRouter.createCaller({
    db: { ...db, query: { ...withAuthRows(db.query ?? {}), ...over.query } },
    session: over.session === undefined ? { user: { id: USER } } : over.session,
    headers: new Headers(),
  } as never);
}

// ---------------------------------------------------------------------------
// computeNextInvoiceNumber / ensureRealInvoiceNumber
// ---------------------------------------------------------------------------

/** tx hvor `execute` svarer med max_num og gemmer hver kørt SQL. */
function numberingTx(maxNum: number) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const tx = {
    execute: async (statement: SQL) => {
      const { sql, params } = render(statement);
      executed.push({ sql, params });
      return sql.includes("max_num") ? [{ max_num: maxNum }] : [];
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, values });
        },
      }),
    }),
  };
  return { tx, executed, updates };
}

const DRAFT_PATTERNS = ["UDKAST-%", "DRAFT-%", "ENTWURF-%", "BORRADOR-%"];

describe("computeNextInvoiceNumber — fortløbende numre (#196)", () => {
  it("låser serien pr. org før nummeret læses", async () => {
    const { tx, executed } = numberingTx(0);

    await computeNextInvoiceNumber(tx as never, USER, ORG);

    // Advisory lock FØRST — ellers kan to samtidige udstedelser få samme
    // nummer, og serien får et hul eller en dublet.
    expect(executed[0].sql).toContain("pg_advisory_xact_lock");
    expect(executed[0].params).toEqual([ORG]);
    expect(executed).toHaveLength(2);
  });

  it("låser pr. bruger når der ingen org er", async () => {
    const { tx, executed } = numberingTx(0);

    await computeNextInvoiceNumber(tx as never, USER, null);

    expect(executed[0].params).toEqual([USER]);
    expect(executed[1].sql).toContain("user_id");
    expect(executed[1].params).toEqual([USER, ...DRAFT_PATTERNS]);
  });

  it("scoper optællingen til org'en og springer kladder over", async () => {
    const { tx, executed } = numberingTx(7);

    expect(await computeNextInvoiceNumber(tx as never, USER, ORG)).toBe(
      "INV-008",
    );
    expect(executed[1].sql).toContain("organization_id");
    expect(executed[1].sql).toContain("NOT LIKE");
    expect(executed[1].sql).not.toContain("user_id");
    // Kladder på alle sprog springes over (fund 18).
    expect(executed[1].params).toEqual([ORG, ...DRAFT_PATTERNS]);
  });

  it("starter på INV-001 og tæller op fra det højeste nummer", async () => {
    for (const [maxNum, expected] of [
      [0, "INV-001"],
      [1, "INV-002"],
      [99, "INV-100"],
      [999, "INV-1000"],
    ] as const) {
      const { tx } = numberingTx(maxNum);
      expect(await computeNextInvoiceNumber(tx as never, USER, ORG)).toBe(
        expected,
      );
    }
  });
});

describe("ensureRealInvoiceNumber — nummeret tildeles ved udstedelse", () => {
  it("bytter kladdens UDKAST-nummer og gemmer det", async () => {
    const { tx, updates } = numberingTx(41);

    const number = await ensureRealInvoiceNumber(
      tx as never,
      { id: INVOICE_ID, invoiceNumber: "UDKAST-ABC123" },
      USER,
      ORG,
    );

    expect(number).toBe("INV-042");
    expect(isDraftInvoiceNumber(number)).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(invoices);
    expect(updates[0].values).toMatchObject({ invoiceNumber: "INV-042" });
  });

  it("forbruger ikke et nyt nummer på en faktura der allerede har et", async () => {
    const { tx, executed, updates } = numberingTx(41);

    const number = await ensureRealInvoiceNumber(
      tx as never,
      { id: INVOICE_ID, invoiceNumber: "INV-007" },
      USER,
      ORG,
    );

    expect(number).toBe("INV-007");
    expect(executed).toEqual([]);
    expect(updates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// update: statemaskinen og låsen på udstedte fakturaer
// ---------------------------------------------------------------------------

function invoiceRow(over: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    userId: USER,
    organizationId: ORG,
    clientId: CLIENT_ID,
    invoiceNumber: "UDKAST-ABC123",
    status: "draft",
    amount: "1000.00",
    paidDate: null,
    notes: null,
    ...over,
  };
}

/**
 * db til `invoices.update`. `sets` er hver skrivning i rækkefølge — både
 * uden for og inde i transaktionen — så testene kan påvise at intet blev
 * skrevet, når en overgang afvises.
 */
function updateDb(invoice: Record<string, unknown>, maxNum = 41) {
  const sets: Record<string, unknown>[] = [];
  const { tx, executed } = numberingTx(maxNum);
  const db = {
    query: {
      invoices: { findFirst: async () => invoice },
      invoiceTemplates: { findFirst: async () => undefined },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            sets.push(values);
            return [{ ...invoice, ...values }];
          },
        }),
      }),
    }),
    transaction: async (fn: (t: unknown) => Promise<unknown>) =>
      fn({
        ...tx,
        // lockInvoiceStatus (#1110): rækkelåsen læser den aktuelle status
        select: () => ({
          from: () => ({
            where: () => ({
              for: async () => [
                {
                  id: invoice.id,
                  invoiceNumber: invoice.invoiceNumber,
                  status: invoice.status,
                },
              ],
            }),
          }),
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => {
              sets.push(values);
              // ensureRealInvoiceNumber awaiter uden .returning()
              return Object.assign(Promise.resolve(), {
                returning: async () => [{ ...invoice, ...values }],
              });
            },
          }),
        }),
      }),
  };
  return { db, sets, executed };
}

const updateInvoice = (
  db: Parameters<typeof caller>[0],
  input: Record<string, unknown>,
) => caller(db).update({ id: INVOICE_ID, ...input } as never);

describe("invoices.update — statemaskinen", () => {
  it("udsteder en kladde og tildeler nummeret i samme transaktion (#196)", async () => {
    const { db, sets, executed } = updateDb(invoiceRow());

    const result = (await updateInvoice(db, { status: "sent" })) as {
      status: string;
    };

    expect(executed[0].sql).toContain("pg_advisory_xact_lock");
    // Nummeret skrives inde i samme transaktion som statusskiftet.
    expect(sets).toEqual([
      expect.objectContaining({ invoiceNumber: "INV-042" }),
      expect.objectContaining({ status: "sent" }),
    ]);
    expect(result.status).toBe("sent");
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invoice.sent" }),
    );
  });

  it("afviser sent → draft: en udstedt faktura er låst (#195)", async () => {
    const { db, sets } = updateDb(invoiceRow({ status: "sent" }));

    await expect(updateInvoice(db, { status: "draft" })).rejects.toThrow(
      /kladde/i,
    );
    expect(sets).toEqual([]);
  });

  it("afviser draft → paid: betaling kræver en udstedt faktura", async () => {
    const { db, sets } = updateDb(invoiceRow());

    await expect(updateInvoice(db, { status: "paid" })).rejects.toThrow();
    expect(sets).toEqual([]);
  });

  it("sætter paidDate selv når sent → paid ikke angiver den", async () => {
    const { db, sets } = updateDb(invoiceRow({ status: "sent" }));

    await updateInvoice(db, { status: "paid" });

    expect(sets[0].status).toBe("paid");
    expect(sets[0].paidDate).toBeInstanceOf(Date);
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invoice.paid" }),
    );
  });

  it("tillader overdue → sent (forlænget frist) og overdue → paid", async () => {
    for (const status of ["sent", "paid"] as const) {
      const { db, sets } = updateDb(invoiceRow({ status: "overdue" }));
      await updateInvoice(db, { status });
      expect(sets[0].status).toBe(status);
    }
  });

  it("låser beløb og forfaldsdato på en udstedt faktura", async () => {
    for (const change of [
      { amount: "2000.00" },
      { dueDate: "2026-12-01" },
    ] as const) {
      const { db, sets } = updateDb(invoiceRow({ status: "sent" }));
      await expect(updateInvoice(db, change)).rejects.toThrow();
      expect(sets).toEqual([]);
    }
  });

  it("lader kun noter rette på en betalt faktura", async () => {
    const paid = () => updateDb(invoiceRow({ status: "paid" }));

    const notes = paid();
    await updateInvoice(notes.db, { notes: "Betalt via bankoverførsel" });
    expect(notes.sets[0]).toMatchObject({ notes: "Betalt via bankoverførsel" });

    const amount = paid();
    await expect(
      updateInvoice(amount.db, { amount: "2000.00" }),
    ).rejects.toThrow();
    expect(amount.sets).toEqual([]);
  });

  it("afviser enhver rettelse på en slettet faktura", async () => {
    const { db, sets } = updateDb(invoiceRow({ status: "deleted" }));

    await expect(updateInvoice(db, { notes: "Igen" })).rejects.toThrow();
    expect(sets).toEqual([]);
  });

  it("afviser et ugyldigt beløb i input-skemaet", async () => {
    const schema = (
      invoicesRouter.update._def as unknown as { inputs: unknown[] }
    ).inputs[0] as {
      safeParse: (v: unknown) => { success: boolean };
    };
    const parse = (amount: string) =>
      schema.safeParse({ id: INVOICE_ID, amount }).success;

    expect(parse("100")).toBe(true);
    expect(parse("1500.50")).toBe(true);
    expect(parse("0.01")).toBe(true);
    expect(parse("0")).toBe(false);
    expect(parse("-100")).toBe(false);
    expect(parse("100000001")).toBe(false);
    expect(parse("100.123")).toBe(false);
    expect(parse("")).toBe(false);
    expect(parse("abc")).toBe(false);
  });

  it("afviser et ugyldigt beløb FØR resolveren rører fakturaen", async () => {
    // Skemaet skal være koblet på proceduren, ikke kun findes: zod-parsingen
    // er en del af kæden, så et beløb som "abc" aldrig når en skrivning.
    const { db, sets } = updateDb(invoiceRow());

    await expect(updateInvoice(db, { amount: "abc" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(sets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adgangen til pengevejen: moduleWriteProcedure("invoices")
// ---------------------------------------------------------------------------

describe("fakturaskrivninger kræver skriveadgang til faktura-modulet", () => {
  // Et scoped medlem (læseadgang til fakturaer) må ikke kunne udstede en
  // faktura eller forbruge et nummer i den fortløbende serie. Kaldet skal
  // afvises af middlewaren, FØR resolveren ser inputtet.
  for (const level of ["read", "none"] as const) {
    it(`afviser update for et medlem med adgang "${level}"`, async () => {
      access.level = level;
      const { db, sets, executed } = updateDb(invoiceRow());

      await expect(updateInvoice(db, { status: "sent" })).rejects.toMatchObject(
        { code: "FORBIDDEN" },
      );
      expect(sets).toEqual([]);
      expect(executed).toEqual([]);
      expect(emitWebhookEvent).not.toHaveBeenCalled();
    });

    it(`afviser generateFromTimeEntries for et medlem med adgang "${level}"`, async () => {
      access.level = level;
      const { db, inserts } = generateDb([entryRow()]);

      await expect(generate(db, [ENTRY_1])).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(inserts).toEqual([]);
    });
  }

  it("slipper et medlem med skriveadgang igennem", async () => {
    access.level = "write";
    const { db, sets } = updateDb(invoiceRow());

    await updateInvoice(db, { status: "sent" });

    expect(sets.at(-1)).toMatchObject({ status: "sent" });
  });

  it("afviser kaldet uden et brugbart abonnement (Cloud uændret)", async () => {
    const { db, sets } = updateDb(invoiceRow());
    // Ingen abonnementsrække for hverken brugeren eller orgen.
    const scoped = caller(db, {
      query: { subscriptions: { findFirst: async () => undefined } },
    });

    await expect(
      scoped.update({ id: INVOICE_ID, status: "sent" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sets).toEqual([]);
  });

  it("afviser et kald uden session", async () => {
    const { db, sets } = updateDb(invoiceRow());

    await expect(
      caller(db, { session: null }).update({
        id: INVOICE_ID,
        status: "sent",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(sets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateFromTimeEntries: beløbet på kladden
// ---------------------------------------------------------------------------

function entryRow(over: Record<string, unknown> = {}) {
  return {
    id: ENTRY_1,
    userId: USER,
    organizationId: ORG,
    clientId: CLIENT_ID,
    description: "Frontend",
    hours: "2.50",
    billableRate: "900.00",
    date: new Date("2026-10-01T00:00:00Z"),
    isBilled: false,
    isPrepaid: false,
    project: { name: "Projekt", clientId: CLIENT_ID },
    ...over,
  };
}

function generateDb(entries: Record<string, unknown>[]) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const marked: Record<string, unknown>[] = [];
  const db = {
    query: {
      clients: {
        findFirst: async () => ({
          id: CLIENT_ID,
          name: "Testkunde ApS",
          paymentTermsDays: 14,
        }),
      },
      timeEntries: { findMany: async () => entries },
      // Ikke den første faktura: milepæls-mailen er ikke emnet her.
      invoices: { findMany: async () => [{ id: "old" }] },
    },
    transaction: async (fn: (t: unknown) => Promise<unknown>) =>
      fn({
        query: { invoiceTemplates: { findFirst: async () => undefined } },
        insert: (table: unknown) => ({
          values: (values: unknown) => ({
            returning: async () => {
              inserts.push({ table, values });
              if (table === invoices) {
                return [
                  {
                    id: INVOICE_ID,
                    clientId: CLIENT_ID,
                    ...(values as Record<string, unknown>),
                  },
                ];
              }
              return (values as Record<string, unknown>[]).map((v, i) => ({
                id: `line-${i}`,
                ...v,
              }));
            },
          }),
        }),
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => {
                if (table === timeEntries) marked.push(values);
                return entries.map((e) => ({ id: e.id }));
              },
            }),
          }),
        }),
      }),
  };
  return { db, inserts, marked };
}

const generate = (
  db: Parameters<typeof caller>[0],
  timeEntryIds: string[],
  extra: { requireCompanyProfile?: boolean } = {},
) =>
  caller(db).generateFromTimeEntries({
    clientId: CLIENT_ID,
    timeEntryIds,
    ...extra,
  }) as Promise<{
    invoice: { amount: string; invoiceNumber: string; status: string };
    totalAmount: number;
    lines: { amount: string; quantity: string; unitPrice: string }[];
  }>;

describe("invoices.generateFromTimeEntries — beløbet", () => {
  it("summerer timer × sats til én linje pr. post", async () => {
    const { db, inserts, marked } = generateDb([
      entryRow(),
      entryRow({
        id: ENTRY_2,
        description: "Møde",
        hours: "0.50",
        billableRate: "750.00",
        date: new Date("2026-10-02T00:00:00Z"),
      }),
    ]);

    const result = await generate(db, [ENTRY_1, ENTRY_2]);

    // 2,5 × 900 + 0,5 × 750 = 2.625
    expect(result.totalAmount).toBe(2625);
    expect(result.invoice.amount).toBe("2625.00");
    expect(result.lines.map((l) => l.amount)).toEqual(["2250.00", "375.00"]);
    // Kladde: nummeret tildeles først ved udstedelse (#196).
    expect(result.invoice.status).toBe("draft");
    expect(isDraftInvoiceNumber(result.invoice.invoiceNumber)).toBe(true);
    expect(inserts.map((i) => i.table)).toEqual([invoices, invoiceLines]);
    // Posterne markeres faktureret, så de ikke kan faktureres igen.
    expect(marked).toEqual([{ isBilled: true, invoiceId: INVOICE_ID }]);
  });

  it("regner en post uden sats som 0 i stedet for NaN", async () => {
    const { db } = generateDb([
      entryRow({ billableRate: null, hours: "2.00" }),
      entryRow({
        id: ENTRY_2,
        hours: "1.00",
        billableRate: "500.00",
        date: new Date("2026-10-02T00:00:00Z"),
      }),
    ]);

    const result = await generate(db, [ENTRY_1, ENTRY_2]);

    expect(result.totalAmount).toBe(500);
    expect(result.lines.map((l) => l.amount)).toEqual(["0.00", "500.00"]);
  });

  it("afviser en kladde hvor en post hører til en anden kunde", async () => {
    const { db, inserts } = generateDb([
      entryRow(),
      entryRow({
        id: ENTRY_2,
        clientId: "99999999-9999-4999-8999-999999999999",
        project: {
          name: "Andet",
          clientId: "99999999-9999-4999-8999-999999999999",
        },
      }),
    ]);

    await expect(generate(db, [ENTRY_1, ENTRY_2])).rejects.toThrow();
    expect(inserts).toEqual([]);
  });

  it("afviser hele kaldet når en post ikke var fakturerbar", async () => {
    // Forespørgslen filtrerer faktureret/prepaid tid væk, så én af de to
    // id'er kommer ikke tilbage — kladden må ikke oprettes halvt.
    const { db, inserts } = generateDb([entryRow()]);

    await expect(generate(db, [ENTRY_1, ENTRY_2])).rejects.toThrow();
    expect(inserts).toEqual([]);
  });

  it("sorterer linjerne i datoorden, ældste først", async () => {
    const { db } = generateDb([
      entryRow({
        id: ENTRY_2,
        hours: "1.00",
        billableRate: "100.00",
        date: new Date("2026-10-05T00:00:00Z"),
      }),
      entryRow({
        hours: "1.00",
        billableRate: "200.00",
        date: new Date("2026-10-01T00:00:00Z"),
      }),
    ]);

    const result = await generate(db, [ENTRY_2, ENTRY_1]);

    expect(result.lines.map((l) => l.amount)).toEqual(["200.00", "100.00"]);
  });
});

describe("invoices.generateFromTimeEntries — første faktura", () => {
  /** Ingen fakturaer endnu; `profile` er virksomhedsprofilen eller undefined. */
  function firstInvoiceDb(profile: { id: string } | undefined) {
    const setup = generateDb([entryRow()]);
    setup.db.query.invoices = { findMany: async () => [] };
    (setup.db.query as Record<string, unknown>).companyProfiles = {
      findFirst: async () => profile,
    };
    return setup;
  }

  const web = { requireCompanyProfile: true };

  it("web: afviser den første faktura uden virksomhedsoplysninger", async () => {
    const { db, inserts, marked } = firstInvoiceDb(undefined);

    const error = await generate(db, [ENTRY_1], web).catch((e) => e);
    expect(error).toMatchObject({ code: "BAD_REQUEST" });
    // Web viser vejen til oplysningerne ud fra koden, ikke den oversatte tekst.
    expect(appCodeOf(error)).toBe("COMPANY_PROFILE_REQUIRED");
    expect(inserts).toEqual([]);
    expect(marked).toEqual([]);
  });

  it("web: laver den første faktura, når virksomhedsoplysningerne findes", async () => {
    const { db, inserts } = firstInvoiceDb({ id: "profile-1" });

    const result = await generate(db, [ENTRY_1], web);

    expect(result.totalAmount).toBe(2250);
    expect(inserts.map((i) => i.table)).toEqual([invoices, invoiceLines]);
  });

  it("uden web's krav (desktop, REST, MCP): første kladde også uden profil", async () => {
    const { db, inserts } = firstInvoiceDb(undefined);

    const result = await generate(db, [ENTRY_1]);

    expect(result.totalAmount).toBe(2250);
    expect(inserts.map((i) => i.table)).toEqual([invoices, invoiceLines]);
  });
});

beforeEach(() => {
  access.level = "write";
  vi.clearAllMocks();
});
