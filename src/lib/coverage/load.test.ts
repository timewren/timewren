import { describe, expect, it, vi } from "vitest";
import { loadWorkTimeContexts } from "./load";

function fixture() {
  const query = {
    users: {
      findMany: vi.fn(async () => [
        { id: "employee" },
        {
          id: "solo",
          workSchedule: { "1": 6, "2": 6, "3": 6, "4": 6, "5": 6 },
        },
      ]),
    },
    employeeProfiles: {
      findMany: vi.fn(async () => [
        {
          userId: "employee",
          isActive: true,
          departmentId: null,
          weeklyHours: 30,
          workingDays: ["1", "2", "3", "4", "5"],
        },
      ]),
    },
    employmentPeriods: { findMany: vi.fn(async () => []) },
    organizations: { findFirst: vi.fn(async () => null) },
    workPlanAssignments: { findMany: vi.fn(async () => []) },
    dayOffCalendars: {
      findMany: vi.fn(async () => [
        {
          id: "personal",
          userId: "solo",
          organizationId: null,
          departmentId: null,
          preset: "private",
          customDays: [{ date: "2026-11-03", name: "Fri", isHalfDay: true }],
        },
      ]),
    },
    holidays: { findMany: vi.fn(async () => []) },
  };
  return { query };
}

describe("loadWorkTimeContexts (#763)", () => {
  it("indlæser normtid med et fast antal opslag og bevarer egen kalender for ikke-medarbejdere", async () => {
    const db = fixture();
    const contexts = await loadWorkTimeContexts(
      db as never,
      ["employee", "solo"],
      "org",
      { enterpriseEnabled: true },
    );
    expect(contexts.get("employee")?.source).toBe("hr");
    expect(contexts.get("employee")?.hoursFor("2026-11-03")).toBe(6);
    expect(contexts.get("solo")?.source).toBe("user");
    expect(contexts.get("solo")?.hoursFor("2026-11-03")).toBe(3);
    for (const table of Object.values(db.query)) {
      for (const query of Object.values(table))
        expect(query).toHaveBeenCalledTimes(1);
    }
  });
  it("undgår opslag for et tomt team", async () => {
    const db = fixture();
    expect(
      await loadWorkTimeContexts(db as never, [], "org", {
        enterpriseEnabled: true,
      }),
    ).toEqual(new Map());
    expect(db.query.users.findMany).not.toHaveBeenCalled();
  });
});
