import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #750: en device-token fra org A må hverken pege på org B's projekter,
 * kunder eller opgaver, eller sætte server-ejede felter (fakturering,
 * godkendelse, ejerskab, fakturastatus) via den generiske create/update.
 *
 * Den falske db evaluerer drizzle-betingelserne groft: en række matcher et
 * opslag når hver bundet parameter i WHERE findes blandt rækkens værdier. Det
 * er nok til at skelne `id = X AND organization_id = A` fra en række i org B.
 */

const ORG_A = "org-a";
const ORG_B = "org-b";
const USER_A = "user-a";
const USER_B = "user-b";

const ids = {
  projectA: "aaaaaaaa-0000-4000-8000-000000000001",
  projectB: "bbbbbbbb-0000-4000-8000-000000000001",
  clientA: "aaaaaaaa-0000-4000-8000-000000000002",
  clientB: "bbbbbbbb-0000-4000-8000-000000000002",
  clientA2: "aaaaaaaa-0000-4000-8000-000000000012",
  packageA: "aaaaaaaa-0000-4000-8000-000000000007",
  taskA: "aaaaaaaa-0000-4000-8000-000000000003",
  taskB: "bbbbbbbb-0000-4000-8000-000000000003",
  entryA: "aaaaaaaa-0000-4000-8000-000000000004",
  invoiceDraftA: "aaaaaaaa-0000-4000-8000-000000000005",
  invoiceSentA: "aaaaaaaa-0000-4000-8000-000000000006",
  invoiceB: "bbbbbbbb-0000-4000-8000-000000000006",
};

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  updates: [] as { table: string; values: Record<string, unknown> }[],
  orgId: "org-a" as string | null,
  moduleEnabled: true,
  access: "write" as "write" | "read" | "none",
  atClientLimit: false,
}));

vi.mock("@/lib/trpc/trpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trpc/trpc")>()),
  resolvePlanTier: vi.fn(async () => "free"),
}));
vi.mock("@/lib/trpc/routers/enterprise/middleware", () => ({
  resolveModules: vi.fn(async () => ({ isEnabled: () => state.moduleEnabled })),
}));
vi.mock("@/lib/permissions/role-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions/role-access")>()),
  resolveModuleAccess: vi.fn(async () => state.access),
}));
vi.mock("@/lib/billing/plan-limits", () => ({
  assertCanAddActiveClient: vi.fn(async () => {
    if (state.atClientLimit) throw new Error("Kundegrænse nået");
  }),
}));

function seed() {
  state.moduleEnabled = true;
  state.access = "write";
  state.atClientLimit = false;
  state.rows = {
    projects: [
      { id: ids.projectA, organizationId: ORG_A, userId: USER_A },
      { id: ids.projectB, organizationId: ORG_B, userId: USER_B },
    ],
    clients: [
      { id: ids.clientA, organizationId: ORG_A, userId: USER_A },
      { id: ids.clientB, organizationId: ORG_B, userId: USER_B },
      { id: ids.clientA2, organizationId: ORG_A, userId: USER_A },
    ],
    tasks: [
      { id: ids.taskA, organizationId: ORG_A, userId: USER_A },
      { id: ids.taskB, organizationId: ORG_B, userId: USER_B },
    ],
    time_entries: [
      {
        id: ids.entryA,
        organizationId: ORG_A,
        userId: USER_A,
        projectId: ids.projectA,
        clientId: null,
        taskId: null,
        description: "Arbejde",
        notes: null,
        hours: "1.00",
        date: new Date("2026-09-15T00:00:00Z"),
        isBillable: true,
        isBilled: false,
        invoiceId: null,
        isPrepaid: false,
        prepaidPackageId: null,
        approvalStatus: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    invoices: [
      {
        id: ids.invoiceDraftA,
        organizationId: ORG_A,
        userId: USER_A,
        clientId: ids.clientA,
        status: "draft",
        invoiceNumber: "UDKAST-X",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: ids.invoiceSentA,
        organizationId: ORG_A,
        userId: USER_A,
        clientId: ids.clientA,
        status: "sent",
        invoiceNumber: "INV-001",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: ids.invoiceB,
        organizationId: ORG_B,
        userId: USER_B,
        clientId: ids.clientB,
        status: "draft",
        invoiceNumber: "UDKAST-Y",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    prepaid_packages: [
      {
        id: ids.packageA,
        organizationId: ORG_A,
        userId: USER_A,
        clientId: ids.clientA,
        usedHours: "0",
        hourlyRate: "100",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    // Ejer → ingen klientbegrænsning, medmindre en test siger andet.
    members: [
      { id: "member-a", userId: USER_A, organizationId: ORG_A, role: "owner" },
    ],
    organizations: [{ id: ORG_A, metadata: {} }],
    memberClientAccess: [],
  };
  state.orgId = ORG_A;
  state.inserts = [];
  state.updates = [];
}

vi.mock("@/lib/db", () => {
  const dialect = new PgDialect();
  const params = (where: unknown): unknown[] =>
    where ? dialect.sqlToQuery(where as SQL).params : [];
  const matches = (row: Row, where: unknown) => {
    const values = Object.values(row);
    return params(where).every((p) => values.includes(p));
  };
  const queryTable = (name: string) => ({
    findFirst: async (opts?: { where?: unknown }) =>
      (state.rows[name] ?? []).find((r) => matches(r, opts?.where)),
    findMany: async (opts?: { where?: unknown }) =>
      (state.rows[name] ?? []).filter((r) => matches(r, opts?.where)),
  });
  let seq = 0;
  // biome-ignore lint/suspicious/noExplicitAny: test-fake for drizzle
  const db: any = {
    query: new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          queryTable(
            {
              projects: "projects",
              clients: "clients",
              tasks: "tasks",
              timeEntries: "time_entries",
              invoices: "invoices",
              invoiceLines: "invoice_lines",
              prepaidPackages: "prepaid_packages",
            }[prop] ?? prop,
          ),
      },
    ),
    select: () => ({
      from: (table: unknown) => ({
        where: (where: unknown) => {
          const name = getTableName(table as Table);
          const rows = (state.rows[name] ?? []).filter((r) =>
            matches(r, where),
          );
          return Object.assign(Promise.resolve(rows), {
            for: async () => rows,
          });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Row) => {
        const name = getTableName(table as Table);
        state.inserts.push({ table: name, values });
        const row = { id: `new-${++seq}`, ...values };
        const result = {
          onConflictDoNothing: () => result,
          returning: async () => [row],
          // biome-ignore lint/suspicious/noThenProperty: awaitable like drizzle
          then: (resolve: (v: unknown) => unknown) => resolve(undefined),
        };
        return result;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => {
        const name = getTableName(table as Table);
        state.updates.push({ table: name, values });
        return { where: async () => undefined };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db };
});
vi.mock("@/lib/desktop-auth", () => ({
  authenticateDevice: async () => ({ userId: USER_A, deviceId: "device-a" }),
}));
vi.mock("@/lib/desktop-org", () => ({
  resolveDesktopOrgId: async () => state.orgId,
}));
vi.mock("@/lib/desktop-rate-limit", () => ({
  checkRateLimit: () => true,
  getClientIp: () => "127.0.0.1",
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/enterprise/edit-guard", () => ({
  assertEntryEditable: vi.fn(async () => undefined),
}));
vi.mock("@/lib/org/period-lock", () => ({
  assertPeriodUnlocked: vi.fn(async () => undefined),
}));
vi.mock("@/lib/time/default-billable", () => ({
  resolveDefaultBillable: async () => true,
}));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/trpc/routers/prepaid", () => ({
  deductHoursCore: vi.fn(),
  reversePrepaidUsage: vi.fn(),
}));
vi.mock("@/lib/trpc/routers/invoices", () => ({
  markEntriesBilled: vi.fn(async () => 1),
  recalcInvoiceTotal: vi.fn(async () => undefined),
  releaseEntries: vi.fn(async () => undefined),
}));

import { POST } from "./route";

interface PushEntity {
  type: string;
  action: "create" | "update" | "delete";
  data: Record<string, unknown>;
  localId?: string;
}

async function push(...entities: PushEntity[]) {
  const res = await POST(
    new Request("https://timetrack.test/api/desktop/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entities }),
    }),
  );
  return res.json();
}

const entityWrites = (table: string) => [
  ...state.inserts.filter((w) => w.table === table),
  ...state.updates.filter((w) => w.table === table),
];

const timeEntryCreate = (data: Record<string, unknown>): PushEntity => ({
  type: "time_entry",
  action: "create",
  localId: "local-1",
  data: {
    description: "Arbejde",
    startTime: "2026-09-15T08:00:00.000Z",
    endTime: "2026-09-15T10:00:00.000Z",
    ...data,
  },
});

describe("desktop-push — referencer skal tilhøre callerens org (#750)", () => {
  beforeEach(seed);

  it.each([
    ["projectId", ids.projectB, "Projekt ikke fundet"],
    ["clientId", ids.clientB, "Kunde ikke fundet"],
    ["taskId", ids.taskB, "Opgave ikke fundet"],
  ])("afviser time_entry-create med fremmed %s", async (field, value, msg) => {
    const body = await push(timeEntryCreate({ [field]: value }));
    expect(body.accepted).toEqual([]);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].error).toContain(msg);
    expect(entityWrites("time_entries")).toEqual([]);
  });

  it("afviser et reference-id der ikke er et uuid uden at ramme databasen", async () => {
    const body = await push(timeEntryCreate({ projectId: "42" }));
    expect(body.errors[0].error).toContain("Projekt ikke fundet");
    expect(entityWrites("time_entries")).toEqual([]);
  });

  it("accepterer egne projekt-, kunde- og opgave-id'er", async () => {
    const body = await push(
      timeEntryCreate({
        projectId: ids.projectA,
        clientId: ids.clientA,
        taskId: ids.taskA,
      }),
    );
    expect(body.errors).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    const [insert] = entityWrites("time_entries");
    expect(insert.values).toMatchObject({
      projectId: ids.projectA,
      clientId: ids.clientA,
      taskId: ids.taskA,
    });
  });

  it("afviser time_entry-update der flytter posten til et fremmed projekt", async () => {
    const body = await push({
      type: "time_entry",
      action: "update",
      data: { id: ids.entryA, projectId: ids.projectB },
    });
    expect(body.errors[0].error).toContain("Projekt ikke fundet");
    expect(entityWrites("time_entries")).toEqual([]);
  });

  it("afviser project-create og -update med fremmed kunde", async () => {
    const body = await push(
      {
        type: "project",
        action: "create",
        localId: "p1",
        data: { name: "X", clientId: ids.clientB },
      },
      {
        type: "project",
        action: "update",
        data: { id: ids.projectA, clientId: ids.clientB },
      },
    );
    expect(body.accepted).toEqual([]);
    expect(body.errors).toHaveLength(2);
    for (const err of body.errors) {
      expect(err.error).toContain("Kunde ikke fundet");
    }
    expect(entityWrites("projects")).toEqual([]);
  });

  it("afviser klippekort og fakturakladde på en fremmed kunde", async () => {
    const body = await push(
      {
        type: "klippekort",
        action: "create",
        localId: "k1",
        data: { name: "10 timer", clientId: ids.clientB, totalHours: 10 },
      },
      {
        type: "invoice_draft",
        action: "create",
        localId: "i1",
        data: { clientId: ids.clientB, issueDate: "2026-09-15" },
      },
    );
    expect(body.accepted).toEqual([]);
    expect(body.errors.map((e: { error: string }) => e.error)).toEqual([
      expect.stringContaining("Kunde ikke fundet"),
      expect.stringContaining("Kunde ikke fundet"),
    ]);
    expect(entityWrites("prepaid_packages")).toEqual([]);
    expect(entityWrites("invoices")).toEqual([]);
  });

  it("afviser en fakturalinje med en fremmed opgave", async () => {
    const body = await push({
      type: "invoice_line",
      action: "create",
      localId: "l1",
      data: {
        invoiceId: ids.invoiceDraftA,
        taskId: ids.taskB,
        description: "Linje",
        quantity: "1",
        unitPrice: "100",
        amount: "100",
      },
    });
    expect(body.errors[0].error).toContain("Opgave ikke fundet");
    expect(entityWrites("invoice_lines")).toEqual([]);
  });

  it("lader batchen fortsætte efter en afvist post (idMap bevares)", async () => {
    const body = await push(timeEntryCreate({ projectId: ids.projectB }), {
      ...timeEntryCreate({ projectId: ids.projectA }),
      localId: "local-2",
    });
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ index: 0, localId: "local-1" });
    expect(body.accepted).toHaveLength(1);
    expect(Object.keys(body.idMap)).toEqual(["local-2"]);
  });
});

describe("desktop-push — kun skrivbare felter (#750)", () => {
  beforeEach(seed);

  const PROTECTED_TIME_ENTRY = {
    id: "cccccccc-0000-4000-8000-000000000009",
    userId: USER_B,
    organizationId: ORG_B,
    isBilled: true,
    invoiceId: ids.invoiceB,
    approvalStatus: "approved",
    approvedBy: USER_B,
    approvedAt: "2026-09-15T12:00:00.000Z",
    rejectionReason: "x",
    billableRate: "9999",
    costRate: "1",
    recurringTemplateId: "dddddddd-0000-4000-8000-000000000009",
    isFromTemplate: true,
  };

  it("stripper beskyttede felter ved time_entry-create", async () => {
    const body = await push(
      timeEntryCreate({ ...PROTECTED_TIME_ENTRY, projectId: ids.projectA }),
    );
    expect(body.errors).toEqual([]);
    const [insert] = entityWrites("time_entries");
    expect(insert.values.userId).toBe(USER_A);
    expect(insert.values.organizationId).toBe(ORG_A);
    for (const field of [
      "isBilled",
      "invoiceId",
      "approvalStatus",
      "approvedBy",
      "approvedAt",
      "rejectionReason",
      "billableRate",
      "costRate",
      "recurringTemplateId",
      "isFromTemplate",
    ]) {
      expect(insert.values).not.toHaveProperty(field);
    }
    expect(insert.values.id).toBeUndefined();
  });

  it("stripper beskyttede felter ved time_entry-update", async () => {
    const { id: _ignored, ...protectedFields } = PROTECTED_TIME_ENTRY;
    const body = await push({
      type: "time_entry",
      action: "update",
      data: { id: ids.entryA, description: "Ny tekst", ...protectedFields },
    });
    expect(body.errors).toEqual([]);
    const writes = entityWrites("time_entries");
    expect(writes).toHaveLength(1);
    const { updatedAt, ...written } = writes[0].values;
    expect(written).toEqual({ description: "Ny tekst" });
    expect(updatedAt).toBeInstanceOf(Date);
  });

  it("stripper integrations- og ejerfelter på kunder", async () => {
    const body = await push({
      type: "client",
      action: "create",
      localId: "c1",
      data: {
        name: "Kunde",
        email: "k@example.com",
        userId: USER_B,
        organizationId: ORG_B,
        billyId: "billy-1",
        dineroId: "dinero-1",
        economicCustomerNumber: 7,
        isDemoData: true,
        statusReportLastSentAt: "2026-09-01T00:00:00.000Z",
      },
    });
    expect(body.errors).toEqual([]);
    const [insert] = entityWrites("clients");
    expect(insert.values).toMatchObject({
      name: "Kunde",
      email: "k@example.com",
      userId: USER_A,
      organizationId: ORG_A,
    });
    for (const field of [
      "billyId",
      "dineroId",
      "economicCustomerNumber",
      "isDemoData",
      "statusReportLastSentAt",
    ]) {
      expect(insert.values).not.toHaveProperty(field);
    }
  });

  it("opretter altid fakturakladder som kladde med UDKAST-nummer", async () => {
    const body = await push({
      type: "invoice_draft",
      action: "create",
      localId: "i1",
      data: {
        clientId: ids.clientA,
        issueDate: "2026-09-15T00:00:00.000Z",
        status: "paid",
        invoiceNumber: "INV-999",
        paidDate: "2026-09-16T00:00:00.000Z",
        billyInvoiceId: "b-1",
        kind: "credit_note",
      },
    });
    expect(body.errors).toEqual([]);
    const [insert] = entityWrites("invoices");
    expect(insert.values.status).toBe("draft");
    expect(String(insert.values.invoiceNumber)).toMatch(/^UDKAST-/);
    for (const field of ["paidDate", "billyInvoiceId", "kind"]) {
      expect(insert.values).not.toHaveProperty(field);
    }
  });

  it("afviser redigering af en faktura der ikke er en kladde", async () => {
    const body = await push({
      type: "invoice_draft",
      action: "update",
      data: { id: ids.invoiceSentA, notes: "Ændret" },
    });
    expect(body.errors[0].error).toContain("kladde");
    expect(entityWrites("invoices")).toEqual([]);
  });

  it("stripper status og nummer ved redigering af en kladde", async () => {
    const body = await push({
      type: "invoice_draft",
      action: "update",
      data: {
        id: ids.invoiceDraftA,
        notes: "Ændret",
        status: "paid",
        invoiceNumber: "INV-999",
        amount: "1",
      },
    });
    expect(body.errors).toEqual([]);
    const writes = entityWrites("invoices");
    expect(writes).toHaveLength(1);
    const { updatedAt: _u, ...written } = writes[0].values;
    expect(written).toEqual({ notes: "Ændret" });
  });

  it("ignorerer en update på en anden orgs faktura", async () => {
    const body = await push({
      type: "invoice_draft",
      action: "update",
      data: { id: ids.invoiceB, notes: "x" },
    });
    expect(body.errors[0].error).toContain("Entity not found");
    expect(entityWrites("invoices")).toEqual([]);
  });
});

describe("desktop-push — øvrige værn (#750)", () => {
  beforeEach(seed);

  it.each(["client", "project"])(
    "afviser %s når modulet er slukket",
    async (type) => {
      state.moduleEnabled = false;
      const body = await push({
        type,
        action: "create",
        data: { name: "Test" },
      });
      expect(body.errors).toHaveLength(1);
      expect(state.inserts).toEqual([]);
    },
  );

  it.each(["client", "project"])("afviser %s med læseadgang", async (type) => {
    state.access = "read";
    const body = await push({ type, action: "create", data: { name: "Test" } });
    expect(body.errors).toHaveLength(1);
    expect(state.inserts).toEqual([]);
  });

  it("afviser nye kunder ved planens kundegrænse", async () => {
    state.atClientLimit = true;
    const body = await push({
      type: "client",
      action: "create",
      data: { name: "Test" },
    });
    expect(body.errors).toHaveLength(1);
    expect(state.inserts).toEqual([]);
  });

  it("afviser klippekort-update der flytter kortet til en fremmed kunde", async () => {
    const body = await push({
      type: "klippekort",
      action: "update",
      data: { id: ids.packageA, clientId: ids.clientB },
    });
    expect(body.errors[0].error).toContain("Kunde ikke fundet");
    expect(entityWrites("prepaid_packages")).toEqual([]);
  });

  it("håndhæver per-medlem klientadgang for et begrænset medlem", async () => {
    state.rows.members = [
      { id: "member-a", userId: USER_A, organizationId: ORG_A, role: "member" },
    ];
    state.rows.organizations = [
      { id: ORG_A, metadata: { restrictClientAccess: true } },
    ];
    state.rows.memberClientAccess = [
      { organizationId: ORG_A, memberId: "member-a", clientId: ids.clientA },
    ];
    const body = await push(
      {
        type: "project",
        action: "create",
        localId: "p-denied",
        data: { name: "Nej", clientId: ids.clientA2 },
      },
      {
        type: "project",
        action: "create",
        localId: "p-ok",
        data: { name: "Ja", clientId: ids.clientA },
      },
    );
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ localId: "p-denied" });
    expect(body.errors[0].error).toContain("adgang");
    expect(Object.keys(body.idMap)).toEqual(["p-ok"]);
  });

  it("afviser en enhed uden org (fjernet medlem) og skriver intet", async () => {
    state.orgId = null;
    const res = await POST(
      new Request("https://timetrack.test/api/desktop/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entities: [timeEntryCreate({ projectId: ids.projectA })],
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect(entityWrites("time_entries")).toHaveLength(0);
  });

  it("melder fejl frem for at acceptere en fjernelse af en manuel faktureret-markering", async () => {
    Object.assign(state.rows.time_entries[0], {
      isBilled: true,
      invoiceId: null,
    });
    const body = await push({
      type: "time_entry",
      action: "update",
      data: { id: ids.entryA, isBilled: false, description: "Ny" },
    });
    expect(body.accepted).toEqual([]);
    expect(body.errors[0].error).toContain("web-appen");
    expect(entityWrites("time_entries")).toEqual([]);
  });
});
