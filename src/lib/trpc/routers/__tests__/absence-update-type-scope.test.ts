import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router };
});
vi.mock("../enterprise/middleware", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return {
    organizationProcedure: t.procedure,
    orgAdminProcedure: t.procedure,
    orgManagerProcedure: t.procedure,
  };
});
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/enterprise/employment", () => ({
  effectiveProfileAt: async () => null,
}));
vi.mock("@/lib/enterprise/flex", () => ({
  recalculateFlexDay: async () => undefined,
}));
vi.mock("@/lib/enterprise/work-settings", () => ({
  loadOrgWorkSettings: async () => null,
}));
vi.mock("@/lib/org-audit", () => ({
  auditDiff: () => ({}),
  logOrgAudit: async () => undefined,
}));
vi.mock("@/lib/notifications/bus", () => ({
  notify: async () => undefined,
  resolveManagerRecipientIds: async () => [],
}));
vi.mock("@/lib/notifications/push", () => ({
  pushToUser: async () => undefined,
}));
vi.mock("@/lib/time/copenhagen", () => ({
  copenhagenToday: () => "2026-11-03",
}));
vi.mock("@/lib/holidays/load", () => ({
  loadDaysOff: async () => [
    { date: "2026-11-03", isHalfDay: true },
    { date: "2026-11-04", isHalfDay: false },
  ],
}));

vi.mock("@/lib/enterprise/vacation", async (original) => ({
  ...(await original<typeof import("@/lib/enterprise/vacation")>()),
  getVacationOrgSettings: async () => ({
    accrualMode: "monthly",
    defaultWeeklyHours: 40,
  }),
  lockVacationBalance: async () => ({ remainingDays: 10 }),
  getVacationOverdraft: async () => 0,
}));

import { enterpriseAbsenceRouter } from "../enterprise/absence";

/** updateRequest må ikke pege en anmodning på en anden orgs fraværstype. */
describe("updateRequest scoper absenceTypeId", () => {
  it("afviser en fraværstype fra en anden organisation", async () => {
    const ownType = {
      id: "own-type",
      organizationId: "org",
      category: "vacation",
      isArchived: false,
    };
    const foreignType = {
      id: "foreign-type",
      organizationId: "other-org",
      category: "vacation",
      isArchived: false,
    };
    const request = {
      id: "request",
      userId: "employee",
      organizationId: "org",
      startDate: "2026-11-05",
      endDate: "2026-11-05",
      halfDayStart: false,
      halfDayEnd: false,
      status: "pending",
      absenceTypeId: ownType.id,
      absenceType: ownType,
    };
    const set = vi.fn((data) => ({
      where: () => ({ returning: async () => [{ ...request, ...data }] }),
    }));
    const db = {
      query: {
        employeeProfiles: {
          findFirst: async () => ({
            userId: "employee",
            workingDays: ["1", "2", "3", "4", "5"],
          }),
        },
        absenceTypes: { findFirst: async () => foreignType },
        absenceRequests: { findFirst: async () => request },
      },
      update: () => ({ set }),
      transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
        fn(db),
    };
    const caller = enterpriseAbsenceRouter.createCaller({
      db,
      orgId: "org",
      orgRole: "member",
      session: { user: { id: "employee" } },
    } as never);

    const err = await caller
      .updateRequest({ id: "request", absenceTypeId: foreignType.id })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(set).not.toHaveBeenCalled();
  });
});
