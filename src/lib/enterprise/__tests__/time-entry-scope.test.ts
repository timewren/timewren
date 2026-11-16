import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  isOwnTimeEntryInOrg,
  ownTimeEntriesInOrg,
  usersTimeEntriesInOrg,
} from "../time-entry-scope";
import { cellsFromWeekEntries } from "../timesheet";

const dialect = new PgDialect();

describe("ownTimeEntriesInOrg (#445)", () => {
  it("bygger userId AND (organizationId = org OR organizationId IS NULL)", () => {
    const { sql, params } = dialect.sqlToQuery(
      ownTimeEntriesInOrg("user-1", "org-a"),
    );
    expect(sql).toBe(
      '("time_entries"."user_id" = $1 and ("time_entries"."organization_id" = $2 or "time_entries"."organization_id" is null))',
    );
    expect(params).toEqual(["user-1", "org-a"]);
  });

  it("usersTimeEntriesInOrg bruger IN over brugere med samme org-prædikat", () => {
    const { sql, params } = dialect.sqlToQuery(
      usersTimeEntriesInOrg(["u1", "u2"], "org-a"),
    );
    expect(sql).toBe(
      '("time_entries"."user_id" in ($1, $2) and ("time_entries"."organization_id" = $3 or "time_entries"."organization_id" is null))',
    );
    expect(params).toEqual(["u1", "u2", "org-a"]);
  });
});

describe("isOwnTimeEntryInOrg", () => {
  it("matcher egne poster i org og legacy-poster uden org", () => {
    expect(
      isOwnTimeEntryInOrg({ userId: "u", organizationId: "a" }, "u", "a"),
    ).toBe(true);
    expect(
      isOwnTimeEntryInOrg({ userId: "u", organizationId: null }, "u", "a"),
    ).toBe(true);
  });

  it("afviser poster fra andre orgs og andre brugere", () => {
    expect(
      isOwnTimeEntryInOrg({ userId: "u", organizationId: "b" }, "u", "a"),
    ).toBe(false);
    expect(
      isOwnTimeEntryInOrg({ userId: "x", organizationId: "a" }, "u", "a"),
    ).toBe(false);
    expect(
      isOwnTimeEntryInOrg({ userId: "x", organizationId: null }, "u", "a"),
    ).toBe(false);
  });
});

describe("cellsFromWeekEntries med org-scoping", () => {
  const weekStart = new Date(2026, 7, 24); // mandag 24/8-2026
  const day = (offset: number) => new Date(2026, 7, 24 + offset, 8, 0, 0, 0);

  const entries = [
    // Org A — tæller
    {
      userId: "u",
      organizationId: "a",
      projectId: "p1",
      date: day(0),
      hours: "2.50",
    },
    {
      userId: "u",
      organizationId: "a",
      projectId: "p1",
      date: day(0),
      hours: "1.00",
    },
    // Legacy uden org — tæller
    {
      userId: "u",
      organizationId: null,
      projectId: "p2",
      date: day(2),
      hours: "4.00",
    },
    // Org B — må IKKE tælle
    {
      userId: "u",
      organizationId: "b",
      projectId: "p1",
      date: day(0),
      hours: "5.00",
    },
    {
      userId: "u",
      organizationId: "b",
      projectId: "p3",
      date: day(4),
      hours: "7.40",
    },
    // Uden projekt — springes altid over
    {
      userId: "u",
      organizationId: "a",
      projectId: null,
      date: day(1),
      hours: "3.00",
    },
  ];

  it("tæller kun poster fra den aktive org og legacy-poster", () => {
    const scoped = entries.filter((e) => isOwnTimeEntryInOrg(e, "u", "a"));
    const cells = cellsFromWeekEntries(scoped, weekStart).sort((x, y) =>
      x.projectId.localeCompare(y.projectId),
    );
    expect(cells).toEqual([
      { projectId: "p1", activityTypeId: null, dayOffset: 0, hours: 3.5 },
      { projectId: "p2", activityTypeId: null, dayOffset: 2, hours: 4 },
    ]);
  });

  it("uden scoping ville org B's timer have blandet sig ind (kontrol)", () => {
    const cells = cellsFromWeekEntries(entries, weekStart);
    const p1 = cells.find((c) => c.projectId === "p1" && c.dayOffset === 0);
    expect(p1?.hours).toBe(8.5);
    expect(cells.some((c) => c.projectId === "p3")).toBe(true);
  });
});
