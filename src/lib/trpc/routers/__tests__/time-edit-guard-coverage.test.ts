/**
 * Alle skriveveje på tidsposter i time-routeren skal køre den fælles
 * redigeringsguard (#467, #1107), og kopier (duplicate/copyWeek) skal have
 * godkendelsesstatus og kostpris som en ny post fra create.
 */
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/engagement", () => ({ sendFirstTimeEntryEmail: vi.fn() }));
vi.mock("@/lib/email/prepaid", () => ({ sendLowBalanceAlert: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/enterprise/edit-guard", () => ({
  assertEntryEditable: vi.fn(),
}));

import { assertEntryEditable } from "@/lib/enterprise/edit-guard";
import {
  BL_ENTRY_ID,
  BL_PROJECT_ID,
  BL_USER_ID,
  entryRow,
  makeTimeCaller,
  makeTimeDb,
} from "@/test/billed-entry-mocks";

const guard = vi.mocked(assertEntryEditable);

function lockedGuard() {
  guard.mockImplementation(async () => {
    throw new TRPCError({ code: "FORBIDDEN", message: "LOCKED_BY_TEST" });
  });
}

function setup() {
  const { db } = makeTimeDb([
    entryRow({ isBilled: false, invoiceId: null, organizationId: "bl-org" }),
  ]);
  (db.query as Record<string, unknown>).projects = {
    findFirst: async () => ({
      id: BL_PROJECT_ID,
      clientId: null,
      name: "Testprojekt",
    }),
    findMany: async () => [],
  };
  return db;
}

type Db = ReturnType<typeof setup>;

/** Lader transaktionen køre mod mock-db'en (update registreres stadig). */
function allowTransaction(db: { transaction: unknown }) {
  db.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
}

const cases: Array<[string, (db: Db) => Promise<unknown>]> = [
  [
    "copyWeek",
    (db) => makeTimeCaller(db).time.copyWeek({ targetWeekStart: "2026-09-21" }),
  ],
  [
    "bulkMarkBilled",
    (db) =>
      makeTimeCaller(db).time.bulkMarkBilled({
        ids: [BL_ENTRY_ID],
        isBilled: true,
      }),
  ],
  [
    "bulkMarkBillable",
    (db) =>
      makeTimeCaller(db).time.bulkMarkBillable({
        ids: [BL_ENTRY_ID],
        isBillable: false,
      }),
  ],
  [
    "bulkMoveToProject",
    (db) =>
      makeTimeCaller(db).time.bulkMoveToProject({
        ids: [BL_ENTRY_ID],
        projectId: BL_PROJECT_ID,
      }),
  ],
  [
    "bulkRecalculateRates",
    (db) =>
      makeTimeCaller(db).time.bulkRecalculateRates({ ids: [BL_ENTRY_ID] }),
  ],
  [
    "quickUpdateDescription",
    (db) =>
      makeTimeCaller(db).time.quickUpdateDescription({
        id: BL_ENTRY_ID,
        description: "x",
      }),
  ],
  [
    "toggleBillable",
    (db) =>
      makeTimeCaller(db).time.toggleBillable({
        id: BL_ENTRY_ID,
        isBillable: false,
      }),
  ],
];

describe("time-routeren kører redigeringsguarden på alle skriveveje (#1107)", () => {
  beforeEach(() => {
    guard.mockReset();
  });

  it.each(cases)("%s afviser en låst post uden at skrive", async (_, call) => {
    lockedGuard();
    const db = setup();
    const err = await call(db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toBe("LOCKED_BY_TEST");
    expect(guard).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("toggleBillable skriver når guarden godkender", async () => {
    guard.mockResolvedValue(undefined);
    const db = setup();
    await makeTimeCaller(db).time.toggleBillable({
      id: BL_ENTRY_ID,
      isBillable: false,
    });
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard.mock.calls[0][1]).toMatchObject({
      orgId: "bl-org",
      userId: BL_USER_ID,
      actorUserId: BL_USER_ID,
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("copyWeek tjekker måluges datoer, ikke kildeugens", async () => {
    lockedGuard();
    const db = setup();
    await makeTimeCaller(db)
      .time.copyWeek({ targetWeekStart: "2026-09-21" })
      .catch(() => undefined);
    const dates = guard.mock.calls[0][1].dates as Date[];
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2026-09-22T00:00:00.000Z",
    ]);
  });

  it("bulk-guarden kaldes én gang pr. ejer", async () => {
    guard.mockResolvedValue(undefined);
    const { db } = makeTimeDb([
      entryRow({ isBilled: false, invoiceId: null, userId: "ejer-a" }),
      entryRow({
        id: "22222222-2222-4222-8222-222222222222",
        isBilled: false,
        invoiceId: null,
        userId: "ejer-b",
      }),
    ]);
    await makeTimeCaller(db).time.bulkMarkBillable({
      ids: [BL_ENTRY_ID, "22222222-2222-4222-8222-222222222222"],
      isBillable: false,
    });
    expect(guard.mock.calls.map((c) => c[1].userId).sort()).toEqual([
      "ejer-a",
      "ejer-b",
    ]);
    for (const [, input] of guard.mock.calls) {
      expect(input.actorUserId).toBe(BL_USER_ID);
      expect(input.entries).toHaveLength(1);
    }
  });

  it("bulkRecalculateRates guarder kun de poster, der skrives (ikke fakturerede)", async () => {
    guard.mockResolvedValue(undefined);
    const openId = "33333333-3333-4333-8333-333333333333";
    const { db } = makeTimeDb([
      entryRow({ isBilled: true, invoiceId: null }),
      entryRow({
        id: openId,
        isBilled: false,
        invoiceId: null,
        date: new Date("2026-09-16T00:00:00.000Z"),
      }),
    ]);
    allowTransaction(db);
    const res = await makeTimeCaller(db).time.bulkRecalculateRates({
      ids: [BL_ENTRY_ID, openId],
    });
    expect(guard).toHaveBeenCalledTimes(1);
    const input = guard.mock.calls[0][1];
    expect(input.entries).toHaveLength(1);
    expect((input.dates as Date[]).map((d) => d.toISOString())).toEqual([
      "2026-09-16T00:00:00.000Z",
    ]);
    expect(res).toMatchObject({ skipped: 1 });
  });

  it("bulkRecalculateRates med kun fakturerede poster kalder ikke guarden", async () => {
    lockedGuard();
    const { db } = makeTimeDb([entryRow({ isBilled: true, invoiceId: null })]);
    allowTransaction(db);
    const res = await makeTimeCaller(db).time.bulkRecalculateRates({
      ids: [BL_ENTRY_ID],
    });
    expect(guard).not.toHaveBeenCalled();
    expect(res).toMatchObject({ updated: 0, skipped: 1 });
  });
});

/** Mock-db der godkender skrivninger og fanger indsatte værdier. */
function setupCopy() {
  guard.mockResolvedValue(undefined);
  const db = setup();
  const q = db.query as Record<string, unknown>;
  // Brugeren kræver godkendelse pr. post; medlemmet har en kostpris
  q.users = {
    findFirst: async () => ({ role: "admin", approvalWorkflow: "per_entry" }),
  };
  q.members = {
    findFirst: async () => ({
      id: "bl-member",
      organizationId: "bl-org",
      userId: BL_USER_ID,
      role: "owner",
      costRate: "350.00",
    }),
    findMany: async () => [],
  };
  const inserted: Record<string, unknown>[] = [];
  db.insert = vi.fn(() => ({
    values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
      inserted.push(...(Array.isArray(v) ? v : [v]));
      return Object.assign(Promise.resolve(undefined), {
        returning: async () => [{ id: "ny-post", ...inserted[0] }],
      });
    },
  })) as never;
  return { db, inserted };
}

describe("kopier af tidsposter får godkendelse og kostpris (#1107)", () => {
  beforeEach(() => {
    guard.mockReset();
  });

  it("duplicate sætter approvalStatus og costRate som create", async () => {
    const { db, inserted } = setupCopy();
    await makeTimeCaller(db).time.duplicate({
      id: BL_ENTRY_ID,
      newDate: "2026-09-16",
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      approvalStatus: "pending",
      costRate: "350.00",
    });
  });

  it("copyWeek sætter approvalStatus og costRate som create", async () => {
    const { db, inserted } = setupCopy();
    await makeTimeCaller(db).time.copyWeek({ targetWeekStart: "2026-09-21" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      approvalStatus: "pending",
      costRate: "350.00",
    });
  });
});
