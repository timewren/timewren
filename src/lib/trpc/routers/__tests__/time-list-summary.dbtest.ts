/**
 * time.list({ view: "summary" }) mod rigtig Postgres
 * (src/lib/time/list-summary.ts): relationerne har kun de udvalgte kolonner,
 * standardvisningen er uændret for REST, MCP, udvidelsen og mobilen, og
 * roundedHours regnes stadig ud fra kundens og projektets afrunding.
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clients, projects, timeEntries } from "@/lib/db/schema";
import { TIME_LIST_SUMMARY_COLUMNS } from "@/lib/time/list-summary";
import { seedAccount, webCaller } from "../ext/__tests__/fixture";

const enabled = process.env.TT_DB_TESTS === "1";

describe.skipIf(!enabled)("time.list view summary", () => {
  it("trims the relations and keeps rounding and the default view", async () => {
    const acc = await seedAccount();
    const owned = { userId: acc.userId, organizationId: acc.orgId };
    const [client] = await db
      .insert(clients)
      .values({
        ...owned,
        name: "Summary ApS",
        notes: "lang intern note, som listen ikke skal sende",
        address: "Testvej 1",
        // Kundens afrunding: op til nærmeste kvarter
        roundingEnabled: true,
        roundingMinutes: 15,
        roundingMethod: "up",
      } as never)
      .returning({ id: clients.id });
    const [project] = await db
      .insert(projects)
      .values({
        ...owned,
        name: "Summary-projekt",
        description: "beskrivelse, som listen ikke skal sende",
        clientId: client.id,
        hourlyRate: "900",
      } as never)
      .returning({ id: projects.id });
    await db.insert(timeEntries).values({
      ...owned,
      projectId: project.id,
      clientId: client.id,
      description: "Arbejde",
      hours: "1.10",
      date: new Date("2026-11-20T00:00:00Z"),
    } as never);
    // Kun via projektet (ingen client_id) og en anden kundes post: kundens
    // liste og totaler skal tage den første med og ikke den anden
    // (entryBelongsToClient, src/lib/time/client-scope.ts).
    const [other] = await db
      .insert(clients)
      .values({ ...owned, name: "Anden kunde" } as never)
      .returning({ id: clients.id });
    await db.insert(timeEntries).values([
      {
        ...owned,
        projectId: project.id,
        clientId: null,
        description: "Kun projekt",
        hours: "2.00",
        date: new Date("2026-11-19T00:00:00Z"),
      },
      {
        ...owned,
        clientId: other.id,
        description: "Anden kunde",
        hours: "5.00",
        date: new Date("2026-11-18T00:00:00Z"),
      },
    ] as never);

    const caller = webCaller(acc);
    const full = await caller.time.list({
      forClientId: client.id,
      includeClientTotals: true,
    });
    const summary = await caller.time.list({
      forClientId: client.id,
      includeClientTotals: true,
      view: "summary",
    });

    expect(full.entries.map((e) => e.description)).toEqual([
      "Arbejde",
      "Kun projekt",
    ]);
    expect(summary.entries.map((e) => e.description)).toEqual([
      "Arbejde",
      "Kun projekt",
    ]);
    expect(full.clientTotals?.hours).toBe(3.1);
    expect(summary.clientTotals).toEqual(full.clientTotals);
    const [f] = full.entries;
    const [s] = summary.entries;

    // Standardvisningen: de fulde rækker som før
    expect(f.client?.notes).toContain("intern note");
    expect(f.project?.description).toContain("beskrivelse");
    expect(f.project?.client?.address).toBe("Testvej 1");

    // Summary: præcis de udvalgte kolonner
    const keys = (o: object | null | undefined) => Object.keys(o ?? {}).sort();
    expect(keys(s.client)).toEqual(
      Object.keys(TIME_LIST_SUMMARY_COLUMNS.client).sort(),
    );
    expect(keys(s.project)).toEqual(
      [...Object.keys(TIME_LIST_SUMMARY_COLUMNS.project), "client"].sort(),
    );
    expect(keys(s.project?.client)).toEqual(
      Object.keys(TIME_LIST_SUMMARY_COLUMNS.client).sort(),
    );
    expect(s.client?.name).toBe("Summary ApS");
    expect(s.project?.name).toBe("Summary-projekt");

    // Postens egne felter og afrundingen er de samme i begge visninger
    expect(s.roundedHours).toBe("1.25");
    expect(s.roundedHours).toBe(f.roundedHours);
    expect({ ...s, project: null, client: null, prepaidPackage: null }).toEqual(
      { ...f, project: null, client: null, prepaidPackage: null },
    );
    expect(JSON.stringify(summary).length).toBeLessThan(
      JSON.stringify(full).length,
    );
  });
});
