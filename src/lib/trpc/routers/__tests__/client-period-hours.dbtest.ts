import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { clients, projects, timeEntries } from "@/lib/db/schema";
import { seedAccount, seedMember, webCaller } from "../ext/__tests__/fixture";

describe.skipIf(process.env.TT_DB_TESTS !== "1")("client period hours", () => {
  it("matches the default report for owners and restricted members", async () => {
    const owner = await seedAccount();
    const owned = { userId: owner.userId, organizationId: owner.orgId };
    const [client, other] = await db
      .insert(clients)
      .values([
        { ...owned, name: "Kunde A", roundingEnabled: true },
        { ...owned, name: "Kunde B" },
      ])
      .returning();
    const [project] = await db
      .insert(projects)
      .values({
        ...owned,
        clientId: client.id,
        name: "Projekt A",
        roundingEnabled: true,
        roundingMinutes: 15,
        roundingMethod: "down",
      })
      .returning();
    const member = await seedMember(owner, {
      clientIds: [client.id],
      readOnlyModules: ["clients", "reports"],
    });
    const outsider = await seedAccount();
    const entry = {
      ...owned,
      description: "Test",
      date: new Date("2026-04-30T23:59:59Z"),
      clientId: client.id,
    };
    const entries = await db
      .insert(timeEntries)
      .values([
        { ...entry, clientId: null, projectId: project.id, hours: "2.26" },
        { ...entry, userId: member.userId, hours: "1.46" },
        {
          ...entry,
          organizationId: null,
          date: new Date("2026-04-30T23:59:59.500Z"),
          hours: "0.25",
        },
        { ...entry, date: new Date("2026-05-01T00:00:00Z"), hours: "8" },
        { ...entry, date: new Date("2026-03-31T23:59:59Z"), hours: "6" },
        { ...entry, date: new Date("2025-12-31T23:59:59Z"), hours: "10" },
        { ...entry, clientId: other.id, projectId: project.id, hours: "16" },
        {
          ...entry,
          organizationId: outsider.orgId,
          userId: member.userId,
          hours: "32",
        },
      ])
      .returning({ id: timeEntries.id });

    // April starts in Copenhagen while UTC is still in March.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-31T22:30:00Z"));
    try {
      for (const [account, expected, byProject] of [
        [owner, 4, { [project.id]: 2.25, _none: 1.75 }],
        [member, 1.5, { _none: 1.5 }],
      ] as const) {
        const caller = webCaller(account);
        const actual = await caller.clients.getPeriodHours({
          clientId: client.id,
        });
        const report = await caller.reports.getReportData({
          config: {
            filters: { dateRange: "thisMonth", clientIds: [client.id] },
            columns: ["hours"],
            branding: {},
            grouping: "project",
          },
        });
        expect(actual.totalHours).toBe(expected);
        expect(actual.totalHours).toBe(report.aggregates.summary.totalHours);
        expect(
          Object.fromEntries(
            actual.projects.map((row) => [row.projectId ?? "_none", row.hours]),
          ),
        ).toEqual(byProject);
        expect(
          Object.fromEntries(
            report.aggregates.groups.map((row) => [row.key, row.hours]),
          ),
        ).toEqual(byProject);
      }
      for (const [account, expected] of [
        [owner, [entries[0].id, entries[1].id, entries[2].id]],
        [member, [entries[1].id]],
      ] as const) {
        const drillDown = {
          clientId: client.id,
          startDate: "2026-04-01",
          endDate: "2026-04-30",
          reportScope: true,
          limit: 1,
        };
        const caller = webCaller(account);
        const ids: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await caller.time.list({ ...drillDown, cursor });
          ids.push(...page.entries.map(({ id }) => id));
          cursor = page.nextCursor;
        } while (cursor && ids.length <= expected.length);
        expect(ids.sort()).toEqual([...expected].sort());
      }
      const caller = webCaller(owner);
      for (const [dateRange, expected] of [
        ["lastMonth", 6],
        ["thisYear", 18],
        ["lastYear", 10],
        ["custom", 4],
      ] as const) {
        const result = await caller.clients.getPeriodHours({
          clientId: client.id,
          dateRange,
          ...(dateRange === "custom"
            ? { customStart: "2026-04-30", customEnd: "2026-04-30" }
            : {}),
        });
        expect(result.totalHours).toBe(expected);
      }
      await expect(
        caller.clients.getPeriodHours({
          clientId: client.id,
          dateRange: "custom",
          customStart: "2026-05-01",
          customEnd: "2026-04-30",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        webCaller(member).clients.getPeriodHours({ clientId: other.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the same exact total when decimal entries span projects", async () => {
    const owner = await seedAccount();
    const owned = { userId: owner.userId, organizationId: owner.orgId };
    const [client] = await db
      .insert(clients)
      .values({ ...owned, name: "Kunde A", roundingEnabled: false })
      .returning();
    const [projectA, projectB] = await db
      .insert(projects)
      .values([
        { ...owned, clientId: client.id, name: "Projekt A" },
        { ...owned, clientId: client.id, name: "Projekt B" },
      ])
      .returning();
    await db.insert(timeEntries).values(
      [
        ["2026-04-03", projectA.id, "0.01"],
        ["2026-04-02", projectB.id, "0.02"],
        ["2026-04-01", projectA.id, "0.42"],
      ].map(([date, projectId, hours]) => ({
        ...owned,
        description: "Test",
        date: new Date(date),
        clientId: client.id,
        projectId,
        hours,
      })),
    );
    const period = {
      dateRange: "custom",
      customStart: "2026-04-01",
      customEnd: "2026-04-03",
    } as const;
    const caller = webCaller(owner);
    const actual = await caller.clients.getPeriodHours({
      ...period,
      clientId: client.id,
    });
    const report = await caller.reports.getReportData({
      config: {
        filters: { ...period, clientIds: [client.id] },
        columns: ["hours"],
        branding: {},
        grouping: "project",
      },
    });
    expect(actual.totalHours).toBe(0.45);
    expect(report.aggregates.summary.totalHours).toBe(actual.totalHours);
    expect(actual.projects.map(({ hours }) => hours)).toEqual([0.43, 0.02]);
    expect(report.aggregates.groups.map(({ hours }) => hours)).toEqual([
      0.43, 0.02,
    ]);
  });
});
