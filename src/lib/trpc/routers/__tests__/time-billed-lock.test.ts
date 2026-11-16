import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

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

import {
  BL_ENTRY_ID,
  BL_ENTRY_ID_2,
  BL_PROJECT_ID,
  entryRow,
  makeTimeCaller,
  makeTimeDb,
} from "@/test/billed-entry-mocks";

async function expectForbidden(p: Promise<unknown>): Promise<TRPCError> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe("FORBIDDEN");
  return err as TRPCError;
}

const formData = {
  projectId: BL_PROJECT_ID,
  description: "Arbejde",
  hours: 2,
  date: "2026-09-15",
  isBilled: true,
};

describe("time-routeren låser fakturerede poster (#702)", () => {
  it("delete afviser en faktureret post uden at skrive", async () => {
    const { db } = makeTimeDb([entryRow()]);
    const err = await expectForbidden(
      makeTimeCaller(db).time.delete({ id: BL_ENTRY_ID }),
    );
    expect(err.message).toContain("Kreditér fakturaen");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("bulkDelete afviser hele batchen hvis én post er faktureret", async () => {
    const { db } = makeTimeDb([
      entryRow({ id: BL_ENTRY_ID, isBilled: false, invoiceId: null }),
      entryRow({ id: BL_ENTRY_ID_2 }),
    ]);
    const err = await expectForbidden(
      makeTimeCaller(db).time.bulkDelete({ ids: [BL_ENTRY_ID, BL_ENTRY_ID_2] }),
    );
    expect(err.message).toMatch(/^1 af de valgte/);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("update afviser ændrede timer på en faktureret post", async () => {
    const { db } = makeTimeDb([entryRow()]);
    await expectForbidden(
      makeTimeCaller(db).time.update({
        id: BL_ENTRY_ID,
        data: { ...formData, hours: 3 },
      }),
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("update kan ikke frigive en post på en faktura ved at fjerne markeringen", async () => {
    const { db } = makeTimeDb([entryRow()]);
    await expectForbidden(
      makeTimeCaller(db).time.update({
        id: BL_ENTRY_ID,
        data: { ...formData, isBilled: false },
      }),
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("update gemmer kun noten på en faktureret post", async () => {
    const { db, sets } = makeTimeDb([entryRow()]);
    const res = await makeTimeCaller(db).time.update({
      id: BL_ENTRY_ID,
      data: { ...formData, notes: "Intern note" },
    });
    expect(sets).toEqual([{ notes: "Intern note" }]);
    expect(res.complianceWarnings).toEqual([]);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("quick-opdateringer afviser fakturerede poster", async () => {
    const { db } = makeTimeDb([entryRow()]);
    const caller = makeTimeCaller(db).time;
    await expectForbidden(
      caller.quickUpdateHours({ id: BL_ENTRY_ID, hours: 5 }),
    );
    await expectForbidden(
      caller.quickUpdateDescription({ id: BL_ENTRY_ID, description: "Ny" }),
    );
    await expectForbidden(
      caller.toggleBillable({ id: BL_ENTRY_ID, isBillable: false }),
    );
    await expectForbidden(
      caller.quickUpdateTimeRange({ id: BL_ENTRY_ID, hours: 5 }),
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("bulk-ændringer afviser fakturerede poster", async () => {
    const { db } = makeTimeDb([entryRow()]);
    const caller = makeTimeCaller(db).time;
    await expectForbidden(
      caller.bulkMarkBillable({ ids: [BL_ENTRY_ID], isBillable: false }),
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("bulkMarkBilled(false) frigiver ikke poster der står på en faktura", async () => {
    const { db } = makeTimeDb([entryRow()]);
    const err = await expectForbidden(
      makeTimeCaller(db).time.bulkMarkBilled({
        ids: [BL_ENTRY_ID],
        isBilled: false,
      }),
    );
    expect(err.message).toContain("står på en faktura");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("bulkMarkBilled(false) fjerner en manuel markering", async () => {
    const { db, sets } = makeTimeDb([entryRow({ invoiceId: null })]);
    await makeTimeCaller(db).time.bulkMarkBilled({
      ids: [BL_ENTRY_ID],
      isBilled: false,
    });
    expect(sets).toEqual([{ isBilled: false }]);
  });

  it("segmenter på en faktureret post kan ikke ændres eller slettes", async () => {
    const { db } = makeTimeDb([entryRow()]);
    const caller = makeTimeCaller(db).time;
    await expectForbidden(
      caller.deleteSegment({ id: "55555555-5555-4555-8555-555555555555" }),
    );
    expect(db.delete).not.toHaveBeenCalled();
  });
});
