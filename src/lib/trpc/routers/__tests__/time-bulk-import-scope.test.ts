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

import { makeTimeCaller, makeTimeDb } from "@/test/billed-entry-mocks";

/** Et projekt i en anden organisation (findes ikke i kalderens projekter). */
const FOREIGN_PROJECT_ID = "99999999-9999-4999-8999-999999999999";

describe("time.bulkImport scoper defaultProjectId", () => {
  it("afviser et standardprojekt uden for kalderens organisation", async () => {
    // Kalderens org har ingen projekter (tomme tabeller i mock-db'en).
    const { db } = makeTimeDb([]);
    const err = await makeTimeCaller(db)
      .time.bulkImport({
        entries: [{ date: "2026-09-15", hours: 1, description: "Arbejde" }],
        defaultProjectId: FOREIGN_PROJECT_ID,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(db.insert).not.toHaveBeenCalled();
  });
});
