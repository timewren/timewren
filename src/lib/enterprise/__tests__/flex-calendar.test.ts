import { describe, expect, it, vi } from "vitest";

vi.mock("../flex", () => ({ recalculateFlexDay: vi.fn(async () => null) }));
vi.mock("../work-settings", () => ({
  loadOrgWorkSettings: vi.fn(async () => ({ defaultWeeklyHours: 37 })),
}));

import { recalculateFlexDay } from "../flex";
import { recalculateCalendarFlex } from "../flex-calendar";
import { loadOrgWorkSettings } from "../work-settings";

describe("recalculateCalendarFlex", () => {
  it("genberegner hver gemt dato og henter org-normen én gang", async () => {
    vi.clearAllMocks();
    const rows = [
      { userId: "u1", date: "2025-12-24" },
      { userId: "u2", date: "2026-05-01" },
    ];
    const db = {
      query: { flexEntries: { findMany: vi.fn(async () => rows) } },
    };
    await recalculateCalendarFlex(db as never, { orgId: "org" });
    expect(loadOrgWorkSettings).toHaveBeenCalledOnce();
    expect(recalculateFlexDay).toHaveBeenCalledTimes(2);
    expect(recalculateFlexDay).toHaveBeenNthCalledWith(1, db, {
      ...rows[0],
      orgId: "org",
      orgSettings: { defaultWeeklyHours: 37 },
    });
    expect(recalculateFlexDay).toHaveBeenNthCalledWith(2, db, {
      ...rows[1],
      orgId: "org",
      orgSettings: { defaultWeeklyHours: 37 },
    });
  });
  it("lader fejl afbryde kalenderens transaktion", async () => {
    vi.mocked(recalculateFlexDay).mockRejectedValueOnce(
      new Error("recalc failed"),
    );
    const db = {
      query: {
        flexEntries: {
          findMany: async () => [{ userId: "u1", date: "2025-12-24" }],
        },
      },
    };
    await expect(
      recalculateCalendarFlex(db as never, { orgId: "org" }),
    ).rejects.toThrow("recalc failed");
  });
});

it("afgrænser afdelingens genberegning til organisation og afdeling", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { sql } = await import("drizzle-orm");
  const entries = vi.fn(
    async (_options: { where: import("drizzle-orm").SQL }) => [],
  );
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: import("drizzle-orm").SQL) =>
          sql`select user_id from employee_profiles where ${condition}`,
      }),
    }),
    query: { flexEntries: { findMany: entries } },
  };
  await recalculateCalendarFlex(db as never, {
    orgId: "org",
    departmentId: "dept",
  });
  const query = new PgDialect().sqlToQuery(entries.mock.calls[0][0].where);
  expect(query.params).toEqual(["org", "org", "dept"]);
  expect(query.sql).toContain('"flex_entries"."organization_id"');
  expect(query.sql).toContain('"employee_profiles"."department_id"');
});
