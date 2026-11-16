/**
 * "Marker faktureret" (bulkMarkBilled) ændrer kun isBilled-flaget og må
 * ikke blokeres af ugelåsen (indsendt/godkendt uge) — enterprise-orgs
 * markerer netop tid som faktureret EFTER godkendelse. Lukket periode
 * (periodelås og periodeafslutning) gælder stadig (#1107).
 */
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

import { closingLockedMessage } from "@/lib/enterprise/period-closing";
import {
  BL_ENTRY_ID,
  entryRow,
  makeTimeCaller,
  makeTimeDb,
} from "@/test/billed-entry-mocks";

function setup(tables: Record<string, unknown>) {
  const { db, sets } = makeTimeDb([
    entryRow({
      isBilled: false,
      invoiceId: null,
      organizationId: "bl-org",
      approvalStatus: "approved",
    }),
  ]);
  Object.assign(db.query as Record<string, unknown>, tables);
  return { db, sets };
}

const approvedWeek = {
  timesheetWeeks: {
    findFirst: async () => ({ weekStart: "2026-09-14", status: "approved" }),
    findMany: async () => [{ weekStart: "2026-09-14", status: "approved" }],
  },
};

describe("bulkMarkBilled og låsene (#1107)", () => {
  it("markerer poster i en godkendt uge som faktureret", async () => {
    const { db, sets } = setup(approvedWeek);
    const res = await makeTimeCaller(db).time.bulkMarkBilled({
      ids: [BL_ENTRY_ID],
      isBilled: true,
    });
    expect(res).toEqual({ success: true, count: 1 });
    expect(sets).toEqual([{ isBilled: true }]);
  });

  it("afviser stadig poster i en lukket periode (periodelås)", async () => {
    const { db } = setup({
      ...approvedWeek,
      orgPeriodLocks: {
        findFirst: async () => ({
          lockedBefore: new Date("2026-10-01T00:00:00Z"),
        }),
        findMany: async () => [],
      },
    });
    const err = await makeTimeCaller(db)
      .time.bulkMarkBilled({ ids: [BL_ENTRY_ID], isBilled: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    // Periodelåsen kaster BAD_REQUEST; ugelåsen ville give FORBIDDEN
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("afviser stadig poster i en godkendt periodeafslutning", async () => {
    const { db } = setup({
      ...approvedWeek,
      periodClosings: {
        findFirst: async () => undefined,
        findMany: async () => [
          {
            periodStart: "2026-09-01",
            periodEnd: "2026-09-30",
            status: "approved",
          },
        ],
      },
    });
    const err = await makeTimeCaller(db)
      .time.bulkMarkBilled({ ids: [BL_ENTRY_ID], isBilled: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toBe(closingLockedMessage());
    expect(db.update).not.toHaveBeenCalled();
  });

  it("andre skriveveje afvises fortsat i en godkendt uge", async () => {
    const { db } = setup(approvedWeek);
    const err = await makeTimeCaller(db)
      .time.bulkMarkBillable({ ids: [BL_ENTRY_ID], isBillable: false })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect(db.update).not.toHaveBeenCalled();
  });
});
