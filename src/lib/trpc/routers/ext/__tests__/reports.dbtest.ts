/**
 * extension.reports.*: tid pr. kunde/projekt i en periode med web's
 * rapport-logik, og kun egen org.
 */

import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { type Account, deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

function config(grouping: "client" | "project") {
  return {
    filters: {
      dateRange: "custom" as const,
      customStart: "2026-10-01",
      customEnd: "2026-10-31",
    },
    grouping,
    columns: ["date" as const, "client" as const, "hours" as const],
    branding: {},
    rounding: "raw" as const,
  };
}

async function seedHours(acc: Account) {
  const api = deviceCaller().extension;
  const ids: Record<string, string> = {};
  for (const [name, hours] of [
    ["Kunde Nord", [2, 1]],
    ["Kunde Syd", [0.5]],
  ] as const) {
    const client = await api.clients.create({
      token: acc.token,
      data: { name },
    });
    const project = await api.projects.create({
      token: acc.token,
      data: {
        name: `${name} projekt`,
        clientId: client.id,
        hourlyRate: "1000",
      },
    });
    ids[name] = client.id;
    for (const h of hours) {
      await api.entries.create({
        token: acc.token,
        data: {
          projectId: project.id,
          clientId: client.id,
          description: "Arbejde",
          hours: h,
          date: "2026-10-15",
        },
      });
    }
  }
  // Uden for perioden: må ikke tælle med.
  await api.entries.create({
    token: acc.token,
    data: {
      clientId: ids["Kunde Nord"],
      description: "September",
      hours: 5,
      date: "2026-09-30",
    },
  });
  return ids;
}

describe.skipIf(!enabled)("extension.reports (token-API)", () => {
  it("tid pr. kunde i perioden, som web beregner den", async () => {
    const acc = await seedAccount();
    const ids = await seedHours(acc);
    const report = await deviceCaller().extension.reports.get({
      token: acc.token,
      config: config("client"),
    });
    expect(report.period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(report.aggregates.summary.totalHours).toBe(3.5);
    expect(report.aggregates.summary.totalRevenue).toBe(3500);
    const byClient = Object.fromEntries(
      report.aggregates.groups.map((g) => [g.key, g.hours]),
    );
    expect(byClient[ids["Kunde Nord"]]).toBe(3);
    expect(byClient[ids["Kunde Syd"]]).toBe(0.5);
  });

  it("eksport som csv og en anden org ser ingen af posterne", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    await seedHours(a);
    const api = deviceCaller().extension.reports;
    const csv = await api.export({
      token: a.token,
      config: config("project"),
      format: "csv",
    });
    expect(JSON.stringify(csv)).toContain("Kunde Nord");

    const other = await api.get({ token: b.token, config: config("client") });
    expect(other.aggregates.summary.entriesCount).toBe(0);
  });

  it("legacy-poster uden org: kun egne, aldrig andre brugeres", async () => {
    const a = await seedAccount();
    const stranger = await seedAccount();
    // Poster fra før multi-tenant (organization_id = NULL) i perioden.
    await db.insert(timeEntries).values([
      {
        userId: a.userId,
        organizationId: null,
        description: "Egen gammel post",
        hours: "2.00",
        date: new Date("2026-10-10T00:00:00Z"),
      },
      {
        userId: stranger.userId,
        organizationId: null,
        description: "Fremmed gammel post",
        hours: "7.00",
        date: new Date("2026-10-10T00:00:00Z"),
      },
    ] as never);

    const report = await deviceCaller().extension.reports.get({
      token: a.token,
      config: config("client"),
    });
    const descriptions = report.entries.map((e) => e.description);
    expect(descriptions).toContain("Egen gammel post");
    expect(descriptions).not.toContain("Fremmed gammel post");
    expect(report.aggregates.summary.totalHours).toBe(2);
  });
});
