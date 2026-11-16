import type { SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Faste skabeloner (#1108): alle skrivninger for én skabelon, inkl. nextDue,
// sker i én transaktion, så en fejl midt i kundelisten ruller alt tilbage i
// stedet for at give dubletter (og dobbelt klippekort-træk) næste time. En
// pause med slutdato genoptages, når datoen er nået.
//
// Pengevejen (#1113): posten skal få den NUVÆRENDE sats (ikke skabelonens
// gamle), et klippekort-træk der fejler skal efterlade posten fakturerbar i
// stedet for som "prepaid uden træk" (A1 P2-4), og en skabelon hvis ejer er
// ude af org'en eller hvis slutdato er passeret skal deaktiveres uden at
// skrive tid. `insertRecurringTimeEntry` er som standard mocket (egne tests i
// src/lib/prepaid/entry-sync.test.ts); fejlet-træk-sagen kører den rigtige
// helper gennem transaktionen, så posten, der faktisk skrives, kontrolleres.

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));
vi.mock("@/lib/cron/get-user-org", () => ({
  getUserOrgId: async () => "org-1",
}));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
vi.mock("@/lib/trpc/routers/time", () => ({
  getRateForTimeEntry: (...args: unknown[]) => s.rate(...args),
}));
vi.mock("@/lib/time/default-billable", () => ({
  resolveDefaultBillable: async () => s.billable,
}));

type Write = {
  via: "db" | "tx";
  op: "insert" | "update";
  table: string;
  value: Record<string, unknown>;
};

type InsertInput = {
  values: Record<string, unknown> & { clientId: string | null };
  prepaid: { packageId: string; hours: number } | null;
};

const s = vi.hoisted(() => ({
  templates: [] as Record<string, unknown>[],
  where: null as unknown,
  writes: [] as Write[],
  order: [] as string[],
  failOnClient: null as string | null,
  failOnTemplate: null as string | null,
  deduction: null as Record<string, unknown> | null,
  deductionError: null as Error | null,
  isMember: true,
  todoLane: undefined as { id: string } | undefined,
  txStub: null as unknown,
  insertCalls: [] as unknown[],
  insertInputs: [] as InsertInput[],
  alerts: vi.fn(),
  rate: vi.fn(async (..._args: unknown[]) => "800.00"),
  billable: true,
  realInsert: false,
  deductCore: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("deductHoursCore ikke sat op");
  }),
}));

vi.mock("@/lib/trpc/routers/prepaid", () => ({
  checkAndSendLowBalanceAlert: (...args: unknown[]) => {
    s.order.push("alert");
    return s.alerts(...args);
  },
  deductHoursCore: (...args: unknown[]) => s.deductCore(...args),
  reversePrepaidUsage: vi.fn(),
}));

vi.mock("@/lib/prepaid/entry-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/prepaid/entry-sync")>();
  const insertRecurringTimeEntry = async (
    dbArg: unknown,
    input: InsertInput,
  ) => {
    s.insertCalls.push(dbArg);
    s.insertInputs.push(input);
    if (s.realInsert) {
      return actual.insertRecurringTimeEntry(
        dbArg as Parameters<typeof actual.insertRecurringTimeEntry>[0],
        input as Parameters<typeof actual.insertRecurringTimeEntry>[1],
      );
    }
    if (s.failOnClient && input.values.clientId === s.failOnClient) {
      throw new Error("FK-fejl");
    }
    if (
      s.failOnTemplate &&
      input.values.recurringTemplateId === s.failOnTemplate
    ) {
      throw new Error("insert fejlede");
    }
    return {
      entry: { id: `te-${input.values.clientId}`, ...input.values },
      deduction: s.deduction,
      deductionError: s.deductionError,
    };
  };
  return { insertRecurringTimeEntry };
});

vi.mock("@/lib/db", async () => {
  const { getTableName: name } = await import("drizzle-orm");
  const make = (via: "db" | "tx") => ({
    insert: (table: PgTable) => ({
      values: (value: Record<string, unknown>) => {
        s.writes.push({ via, op: "insert", table: name(table), value });
        // Både `await insert().values()` og `.returning()` (tidsposten)
        return Object.assign(Promise.resolve(), {
          returning: async () => [{ id: `te-${value.clientId}`, ...value }],
        });
      },
    }),
    update: (table: PgTable) => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          s.writes.push({ via, op: "update", table: name(table), value });
        },
      }),
    }),
    query: {
      recurringTimeTemplates: {
        findMany: async (args: { where: unknown }) => {
          s.where = args.where;
          return s.templates;
        },
      },
      members: {
        findFirst: async () => (s.isMember ? { id: "m" } : undefined),
      },
      taskStatuses: { findFirst: async () => s.todoLane },
    },
  });
  const tx = make("tx");
  // Som Postgres: kaster callbacken, rulles transaktionens skrivninger tilbage
  const transaction = async (fn: (t: unknown) => Promise<unknown>) => {
    const before = s.writes.length;
    s.order.push("tx:start");
    try {
      const out = await fn(tx);
      s.order.push("tx:commit");
      return out;
    } catch (err) {
      s.writes.splice(before);
      s.order.push("tx:rollback");
      throw err;
    }
  };
  Object.assign(tx, { transaction });
  s.txStub = tx;
  return { db: { ...make("db"), transaction } };
});

import { captureRouteError } from "@/lib/utils/sentry";
import { GET } from "./route";

const DAY = 24 * 60 * 60 * 1000;
const template = (over: Record<string, unknown> = {}) => ({
  id: "tpl-1",
  name: "Support",
  description: "Fast support",
  userId: "u-1",
  organizationId: "org-1",
  projectId: "p-1",
  clientId: null,
  project: null,
  templateType: "time_entry",
  hours: "2.00",
  frequency: "daily",
  dayOfWeek: null,
  dayOfMonth: null,
  endDate: null,
  isPrepaid: false,
  prepaidPackageId: null,
  isPaused: false,
  pausedUntil: null,
  pauseReason: null,
  nextDue: new Date(Date.now() - 60_000),
  templateClients: [
    { clientId: "c-1", projectId: "p-1" },
    { clientId: "c-2", projectId: "p-1" },
  ],
  ...over,
});

/** Skabelon med én kunde direkte på skabelonen (ingen templateClients). */
const single = (over: Record<string, unknown> = {}) =>
  template({
    clientId: "c-1",
    project: { clientId: "c-1" },
    templateClients: [],
    billableRate: "700.00",
    ...over,
  });

type Result = {
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  metadata?: { errors?: { templateId: string }[] };
};

const run = () =>
  (GET as unknown as (r: Request) => Promise<Result>)(
    new Request("http://localhost/api/cron/recurring"),
  );

/** Værdierne cron'en bad insertRecurringTimeEntry om at skrive. */
const insertedEntry = (call = 0) => s.insertInputs[call];

beforeEach(() => {
  s.templates = [template()];
  s.where = null;
  s.writes = [];
  s.order = [];
  s.failOnClient = null;
  s.failOnTemplate = null;
  s.deduction = null;
  s.deductionError = null;
  s.isMember = true;
  s.todoLane = undefined;
  s.insertCalls = [];
  s.insertInputs = [];
  s.alerts.mockReset();
  s.rate.mockClear();
  s.billable = true;
  s.realInsert = false;
  s.deductCore.mockClear();
  vi.mocked(captureRouteError).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.warn).mockRestore();
  vi.mocked(console.error).mockRestore();
});

describe("recurring cron: én transaktion pr. skabelon", () => {
  it("skriver poster, genererede rækker og nextDue gennem transaktionen", async () => {
    const res = await run();
    expect(res.itemsSucceeded).toBe(1);
    expect(s.order.filter((o) => o === "tx:start")).toHaveLength(1);
    expect(s.insertCalls).toEqual([s.txStub, s.txStub]);
    const generated = s.writes.filter(
      (w) => w.table === "generated_time_entries",
    );
    expect(generated).toHaveLength(2);
    expect(generated.every((w) => w.via === "tx")).toBe(true);
    const update = s.writes.find(
      (w) => w.table === "recurring_time_templates" && w.op === "update",
    );
    expect(update?.via).toBe("tx");
    expect(update?.value.nextDue).toBeInstanceOf(Date);
  });

  it("ruller tilbage og lader nextDue stå, når en kunde fejler", async () => {
    s.failOnClient = "c-2";
    const res = await run();
    expect(res.itemsFailed).toBe(1);
    expect(s.order).toContain("tx:rollback");
    expect(s.writes).toEqual([]);
  });

  it("sender lav-saldo-advarsel først efter commit", async () => {
    s.templates = [
      template({
        isPrepaid: true,
        prepaidPackageId: "pp-1",
        templateClients: [{ clientId: "c-1", projectId: "p-1" }],
      }),
    ];
    s.deduction = { remaining: 1 };
    await run();
    expect(s.alerts).toHaveBeenCalledTimes(1);
    expect(s.order).toEqual(["tx:start", "tx:commit", "alert"]);
  });

  it("genoptager en pause, hvis slutdato er passeret", async () => {
    s.templates = [
      template({
        isPaused: true,
        pausedUntil: new Date(Date.now() - DAY),
        pauseReason: "Ferie",
      }),
    ];
    await run();
    const update = s.writes.find(
      (w) => w.table === "recurring_time_templates" && w.op === "update",
    );
    expect(update?.value).toMatchObject({
      isPaused: false,
      pausedUntil: null,
      pauseReason: null,
    });
  });

  it("filteret tager pausedUntil med", async () => {
    await run();
    const { sql } = new PgDialect().sqlToQuery(s.where as SQL);
    expect(sql).toContain('"paused_until"');
    expect(sql).toContain('"is_paused"');
  });
});

describe("recurring cron: tidsposten", () => {
  it("bruger den nuværende sats, ikke skabelonens gamle", async () => {
    s.templates = [single()];
    s.rate.mockResolvedValueOnce("950.00");

    const result = await run();

    expect(result).toMatchObject({ itemsProcessed: 1, itemsSucceeded: 1 });
    expect(s.rate).toHaveBeenCalledWith(
      expect.anything(),
      "u-1",
      "p-1",
      "c-1",
      "org-1",
      expect.any(Date),
    );
    expect(insertedEntry()?.values).toMatchObject({
      billableRate: "950.00",
      hours: "2.00",
      isBilled: false,
      source: "recurring",
      isFromTemplate: true,
    });
  });

  it("daterer posten til dansk dato ved UTC-midnat (#649)", async () => {
    s.templates = [single()];

    await run();

    const date = insertedEntry()?.values.date as Date;
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
  });

  it("rykker nextDue frem og noterer kørslen", async () => {
    s.templates = [single()];

    await run();

    const advanced = s.writes.find(
      (w) => w.table === "recurring_time_templates" && "nextDue" in w.value,
    )?.value;
    expect(advanced?.lastGenerated).toBeInstanceOf(Date);
    const nextDue = advanced?.nextDue as Date | undefined;
    expect(nextDue).toBeInstanceOf(Date);
    expect(nextDue?.getTime()).toBeGreaterThan(Date.now());
  });

  it("skriver en generated-række, så posten kan spores til skabelonen", async () => {
    s.templates = [single()];

    await run();

    expect(
      s.writes
        .filter((w) => w.op === "insert")
        .map(({ table, value }) => ({
          table,
          value,
        })),
    ).toEqual([
      {
        table: "generated_time_entries",
        value: expect.objectContaining({
          recurringTemplateId: "tpl-1",
          timeEntryId: "te-c-1",
          isCompleted: true,
        }),
      },
    ]);
  });

  it("laver én post pr. kunde på en skabelon med flere kunder", async () => {
    s.templates = [
      single({
        templateClients: [
          { clientId: "c-1", projectId: "p-1" },
          { clientId: "c-2", projectId: null },
        ],
      }),
    ];

    await run();

    expect(s.insertInputs).toHaveLength(2);
    expect(insertedEntry(0)?.values).toMatchObject({
      clientId: "c-1",
      projectId: "p-1",
    });
    // Uden eget projekt falder kunden tilbage på skabelonens.
    expect(insertedEntry(1)?.values).toMatchObject({
      clientId: "c-2",
      projectId: "p-1",
    });
  });
});

describe("recurring cron: klippekort-trækket", () => {
  it("trækker på kortet og tjekker saldoen bagefter", async () => {
    s.templates = [single({ isPrepaid: true, prepaidPackageId: "pkg-1" })];
    const deduction = {
      remainingHours: 3,
      totalHours: 20,
      clientId: "c-1",
      packageName: "Klippekort",
      lowBalanceAlertSentAt: null,
      usageId: "usage-1",
      hoursDeducted: 2,
    };
    s.deduction = deduction;

    await run();

    expect(insertedEntry()?.prepaid).toEqual({
      packageId: "pkg-1",
      hours: 2,
    });
    expect(s.alerts).toHaveBeenCalledWith(
      expect.anything(),
      "u-1",
      "pkg-1",
      deduction,
    );
  });

  it("efterlader posten fakturerbar når trækket fejler (A1 P2-4)", async () => {
    s.templates = [single({ isPrepaid: true, prepaidPackageId: "pkg-1" })];
    // Den rigtige helper: posten indsættes, og trækket fejler i sit savepoint
    s.realInsert = true;
    s.deductCore.mockRejectedValueOnce(new Error("Ikke nok timer tilbage"));

    const result = await run();

    expect(s.deductCore).toHaveBeenCalledTimes(1);
    const entries = s.writes.filter((w) => w.table === "time_entries");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      via: "tx",
      op: "insert",
      value: {
        isBillable: true,
        isBilled: false,
        isPrepaid: false,
        prepaidPackageId: null,
      },
    });
    // Ingen senere skrivning gør den til prepaid eller ikke-fakturerbar
    expect(
      s.writes.filter(
        (w) =>
          w.op === "update" &&
          ("isPrepaid" in w.value || "isBillable" in w.value),
      ),
    ).toEqual([]);

    // Kørslen fortsætter (posten står som almindelig, fakturerbar tid)…
    expect(result).toMatchObject({ itemsSucceeded: 1, itemsFailed: 0 });
    // Kun trækkets savepoint rulles tilbage; skabelonens transaktion committer
    expect(s.order).toEqual([
      "tx:start",
      "tx:start",
      "tx:rollback",
      "tx:commit",
    ]);
    // …og der sendes ingen lav-saldo-mail for et træk der ikke skete.
    expect(s.alerts).not.toHaveBeenCalled();
    expect(
      s.writes
        .filter((w) => w.table === "generated_time_entries")
        .map((w) => w.value.timeEntryId),
    ).toEqual(["te-c-1"]);
  });

  it("trækker ikke når skabelonen peger på et kort uden at være prepaid", async () => {
    s.templates = [single({ isPrepaid: false, prepaidPackageId: "pkg-1" })];

    await run();

    expect(insertedEntry()?.prepaid).toBeNull();
  });

  it("vælter ikke kørslen når lav-saldo-mailen fejler", async () => {
    s.templates = [single({ isPrepaid: true, prepaidPackageId: "pkg-1" })];
    s.deduction = { remainingHours: 1, totalHours: 20 };
    s.alerts.mockRejectedValue(new Error("Resend nede"));

    const result = await run();

    expect(s.alerts).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ itemsSucceeded: 1, itemsFailed: 0 });
  });
});

describe("recurring cron: skabeloner der skal stoppe", () => {
  it("deaktiverer en skabelon hvis ejer er ude af org'en", async () => {
    s.templates = [single()];
    s.isMember = false;

    const result = await run();

    expect(s.insertInputs).toEqual([]);
    expect(s.writes).toEqual([
      {
        via: "db",
        op: "update",
        table: "recurring_time_templates",
        value: { isActive: false },
      },
    ]);
    expect(result).toMatchObject({ itemsProcessed: 1, itemsSucceeded: 0 });
  });

  it("deaktiverer en udløbet skabelon uden at skrive tid", async () => {
    s.templates = [single({ endDate: "2020-01-01" })];

    const result = await run();

    expect(s.insertInputs).toEqual([]);
    expect(s.writes).toEqual([
      {
        via: "db",
        op: "update",
        table: "recurring_time_templates",
        value: { isActive: false },
      },
    ]);
    expect(result.itemsSucceeded).toBe(0);
  });

  it("tæller en fejlet skabelon, kører videre og melder til Sentry", async () => {
    s.templates = [single(), single({ id: "tpl-2" })];
    s.failOnTemplate = "tpl-1";

    const result = await run();

    expect(result).toMatchObject({
      itemsProcessed: 2,
      itemsSucceeded: 1,
      itemsFailed: 1,
    });
    expect(result.metadata?.errors?.[0]).toMatchObject({
      templateId: "tpl-1",
    });
    expect(captureRouteError).toHaveBeenCalled();
  });
});

describe("recurring cron: opgave-skabeloner", () => {
  it("laver kun en opgave for templateType task", async () => {
    s.templates = [single({ templateType: "task" })];
    s.todoLane = { id: "lane-todo" };

    await run();

    expect(s.insertInputs).toEqual([]);
    expect(
      s.writes
        .filter((w) => w.op === "insert")
        .map(({ table, value }) => ({
          table,
          value,
        })),
    ).toEqual([
      {
        table: "tasks",
        value: expect.objectContaining({
          title: "Support",
          sourceType: "recurring",
          statusId: "lane-todo",
          clientId: "c-1",
        }),
      },
    ]);
  });

  it("laver både post og opgave for templateType both", async () => {
    s.templates = [single({ templateType: "both" })];

    await run();

    expect(s.insertInputs).toHaveLength(1);
    expect(
      s.writes.filter((w) => w.op === "insert").map((w) => w.table),
    ).toEqual(["generated_time_entries", "tasks"]);
  });
});
