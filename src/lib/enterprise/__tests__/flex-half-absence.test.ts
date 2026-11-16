import { expect, it, vi } from "vitest";

vi.mock("@/lib/holidays/load", () => ({
  loadDayOffCalendar: async () => ({ lookup: () => ({ isHalfDay: true }) }),
}));
vi.mock("../work-plan-load", () => ({
  loadPlanMembers: async () => [],
  loadPlanLookups: async () => new Map(),
}));

import { recalculateFlexDay } from "../flex";

it("flex giver ingen negativ saldo ved fravær på en halv fridag", async () => {
  const values = vi.fn(() => ({ returning: async () => [] }));
  const db = {
    query: {
      employeeProfiles: {
        findFirst: async () => ({
          weeklyHours: 37,
          workingDays: ["1", "2", "3", "4", "5"],
          departmentId: null,
        }),
      },
      employmentPeriods: { findMany: async () => [] },
      organizations: { findFirst: async () => null },
      absenceRequests: {
        findFirst: async () => ({
          startDate: "2026-11-03",
          endDate: "2026-11-03",
        }),
      },
      timeEntries: { findMany: async () => [] },
      flexEntries: { findFirst: async () => null },
    },
    insert: () => ({ values }),
  };
  await recalculateFlexDay(db as never, {
    userId: "employee",
    orgId: "org",
    date: "2026-11-03",
  });
  expect(values).toHaveBeenCalledWith(
    expect.objectContaining({ expectedHours: "0", delta: "0" }),
  );
});
