import { expect, it, vi } from "vitest";

vi.mock("../flex", () => ({ recalculateFlexDay: vi.fn() }));

import { materializeClosureForEmployee } from "../closure";
import { DEFAULT_VACATION_ORG_SETTINGS } from "../vacation";

it("en lukkeperiode bruger kun en halv feriedag på en halv fridag", async () => {
  const values = vi.fn(() => ({ returning: async () => [{ id: "request" }] }));
  const db = {
    query: { absenceRequests: { findFirst: async () => null } },
    insert: () => ({ values }),
  };
  const result = await materializeClosureForEmployee(db as never, {
    orgId: "org",
    period: {
      id: "closure",
      name: "Lukket",
      startDate: "2026-12-24",
      endDate: "2026-12-24",
      absenceTypeId: "type",
    },
    absenceType: { id: "type", deductsVacation: false, vacationPool: null },
    employee: {
      userId: "employee",
      weeklyHours: 37,
      workingDays: ["1", "2", "3", "4", "5"],
    },
    holidayDates: [],
    halfDayHolidayDates: ["2026-12-24"],
    createdBy: null,
    overdraft: 0,
    settings: DEFAULT_VACATION_ORG_SETTINGS,
  });
  expect(result).toMatchObject({ status: "created", totalDays: 0.5 });
  expect(values).toHaveBeenCalledWith(
    expect.objectContaining({ totalDays: "0.5" }),
  );
});
