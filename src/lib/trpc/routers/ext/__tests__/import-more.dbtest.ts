/**
 * import.run, desktop 0.2.23: opgaver, regler, fakturalinjer og arkiverede
 * klippekort. Idempotent ved gentagelse; dry-run opretter intet.
 */

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  companyProfiles,
  deviceMatchRules,
  invoiceLines,
  invoices,
  prepaidPackages,
  tasks,
  timeEntries,
} from "@/lib/db/schema";
import { type Account, deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function seedCompanyProfile(acc: Account) {
  await db.insert(companyProfiles).values({
    userId: acc.userId,
    organizationId: acc.orgId,
    name: "Testfirma ApS",
    email: "faktura@testfirma.test",
  } as never);
}

function bundle() {
  return {
    clients: [
      {
        localId: "c-1",
        data: { name: "Importkunde", defaultHourlyRate: "600" },
      },
    ],
    projects: [
      {
        localId: "p-1",
        clientLocalId: "c-1",
        data: { name: "Importprojekt", hourlyRate: "800" },
      },
    ],
    prepaidPackages: [
      {
        localId: "k-1",
        clientLocalId: "c-1",
        isArchived: true,
        data: {
          name: "Gammelt kort",
          totalHours: 10,
          hourlyRate: 800,
          purchaseDate: "2026-01-01",
        },
      },
    ],
    tasks: [
      {
        localId: "t-1",
        projectLocalId: "p-1",
        data: { title: "Importeret opgave", status: "todo" as const },
      },
      { localId: "t-2", clientLocalId: "c-1", data: { title: "Kundeopgave" } },
    ],
    entries: [
      {
        localId: "e-1",
        projectLocalId: "p-1",
        clientLocalId: "c-1",
        taskLocalId: "t-1",
        data: { description: "Fakturapost 1", hours: 2, date: "2026-09-01" },
      },
      {
        localId: "e-2",
        projectLocalId: "p-1",
        clientLocalId: "c-1",
        data: { description: "Fakturapost 2", hours: 1, date: "2026-09-02" },
      },
      {
        localId: "e-3",
        projectLocalId: "p-1",
        clientLocalId: "c-1",
        prepaidLocalId: "k-1",
        data: { description: "Klippekortpost", hours: 1, date: "2026-09-03" },
      },
    ],
    rules: [
      {
        localId: "r-1",
        kind: "domain" as const,
        pattern: "www.importkunde.dk",
        clientLocalId: "c-1",
        usageCount: 4,
      },
      {
        localId: "r-2",
        kind: "repo" as const,
        pattern: "github.com/importkunde/web",
        projectLocalId: "p-1",
      },
    ],
    invoices: [
      {
        localId: "i-1",
        clientLocalId: "c-1",
        entryLocalIds: ["e-1", "e-2"],
        invoiceNumber: "L-7",
        paidDate: "2026-09-20",
        lines: [
          {
            description: "Udvikling",
            quantity: "2.00",
            unitPrice: "800.00",
            amount: "1600.00",
            entryLocalId: "e-1",
          },
          {
            description: "Møde",
            quantity: "1.00",
            unitPrice: "800.00",
            amount: "800.00",
            entryLocalId: "e-2",
          },
          {
            description: "Kørsel",
            quantity: "1",
            unitPrice: "150.00",
            amount: "150.00",
          },
        ],
        data: {
          amount: "2550.00",
          status: "paid" as const,
          issueDate: "2026-09-05",
          dueDate: "2026-09-19",
        },
      },
    ],
  };
}

describe.skipIf(!enabled)("import.run: opgaver, regler, linjer, kort", () => {
  it("importerer alt, og et gentaget kald opretter intet nyt", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    const api = deviceCaller().extension;

    const dry = await api.import.run({
      token: acc.token,
      dryRun: true,
      ...bundle(),
    });
    expect(dry.errors).toEqual([]);
    expect(dry.report.tasks).toMatchObject({ total: 2, created: 2 });
    expect(dry.report.rules).toMatchObject({ total: 2, created: 2 });
    expect(await db.$count(tasks, eq(tasks.organizationId, acc.orgId))).toBe(0);

    const res = await api.import.run({
      token: acc.token,
      dryRun: false,
      ...bundle(),
    });
    expect(res.errors).toEqual([]);
    expect(res.report.tasks).toMatchObject({ created: 2, failed: 0 });
    expect(res.report.rules).toMatchObject({ created: 2, failed: 0 });
    expect(res.report.invoices).toMatchObject({ created: 1, failed: 0 });

    // Opgaver på projekt og kunde; posten bærer sin opgave.
    const t1 = await db.query.tasks.findFirst({
      where: eq(tasks.id, res.ids.tasks["t-1"]),
    });
    expect(t1).toMatchObject({
      title: "Importeret opgave",
      projectId: res.ids.projects["p-1"],
      status: "todo",
    });
    const t2 = await db.query.tasks.findFirst({
      where: eq(tasks.id, res.ids.tasks["t-2"]),
    });
    expect(t2?.clientId).toBe(res.ids.clients["c-1"]);
    const e1 = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, res.ids.entries["e-1"]),
    });
    expect(e1?.taskId).toBe(res.ids.tasks["t-1"]);

    // Regler: domænet normaliseret, kunde/projekt koblet.
    const rules = await db.query.deviceMatchRules.findMany({
      where: and(
        eq(deviceMatchRules.organizationId, acc.orgId),
        eq(deviceMatchRules.userId, acc.userId),
      ),
    });
    expect(rules.map((r) => [r.kind, r.pattern]).sort()).toEqual([
      ["domain", "importkunde.dk"],
      ["repo", "github.com/importkunde/web"],
    ]);
    expect(rules.find((r) => r.kind === "repo")?.clientId).toBe(
      res.ids.clients["c-1"],
    );

    // Fakturaen: linjerne, posterne knyttet, betalt med rigtigt nummer.
    const invoiceId = res.ids.invoices["i-1"];
    const inv = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
    });
    expect(inv?.status).toBe("paid");
    expect(inv?.amount).toBe("2550.00");
    expect(inv?.invoiceNumber).not.toMatch(/^UDKAST|KLADDE/i);
    const lines = await db.query.invoiceLines.findMany({
      where: eq(invoiceLines.invoiceId, invoiceId),
      orderBy: [invoiceLines.sortOrder],
    });
    expect(lines.map((l) => [l.description, l.amount, l.timeEntryId])).toEqual([
      ["Udvikling", "1600.00", res.ids.entries["e-1"]],
      ["Møde", "800.00", res.ids.entries["e-2"]],
      ["Kørsel", "150.00", null],
    ]);
    const billed = await db.query.timeEntries.findMany({
      where: eq(timeEntries.invoiceId, invoiceId),
      columns: { id: true, isBilled: true },
    });
    expect(billed.map((b) => b.id).sort()).toEqual(
      [res.ids.entries["e-1"], res.ids.entries["e-2"]].sort(),
    );

    // Det arkiverede kort er arkiveret, og posten er trukket på det først.
    const card = await db.query.prepaidPackages.findFirst({
      where: eq(prepaidPackages.id, res.ids.prepaidPackages["k-1"]),
    });
    expect(card?.isArchived).toBe(true);
    const e3 = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, res.ids.entries["e-3"]),
    });
    expect(e3?.prepaidPackageId).toBe(card?.id);

    // Gentaget kald: intet nyt, kortet forbliver arkiveret (ingen toggle).
    const again = await api.import.run({
      token: acc.token,
      dryRun: false,
      ...bundle(),
    });
    expect(again.errors).toEqual([]);
    expect(again.report.tasks).toMatchObject({ created: 0, existing: 2 });
    expect(again.report.rules).toMatchObject({ created: 0, existing: 2 });
    expect(again.report.invoices).toMatchObject({ created: 0, existing: 1 });
    expect(await db.$count(tasks, eq(tasks.organizationId, acc.orgId))).toBe(2);
    expect(
      await db.$count(invoiceLines, eq(invoiceLines.invoiceId, invoiceId)),
    ).toBe(3);
    const cardAgain = await db.query.prepaidPackages.findFirst({
      where: eq(prepaidPackages.id, res.ids.prepaidPackages["k-1"]),
    });
    expect(cardAgain?.isArchived).toBe(true);
  }, 120_000);

  it("afviser linjer, der ikke summerer til beløbet, og regler uden mål", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    const api = deviceCaller().extension;
    const b = bundle();
    b.invoices[0].data.amount = "2000.00";
    const rules = [
      ...b.rules,
      { localId: "r-3", kind: "app" as const, pattern: "Spotify" },
    ];
    const res = await api.import.run({
      token: acc.token,
      dryRun: true,
      ...b,
      rules,
    });
    expect(res.errors).toEqual([
      {
        entity: "rule",
        localId: "r-3",
        message: "En regel skal pege på et projekt eller en kunde",
      },
      {
        entity: "invoice",
        localId: "i-1",
        message: "Linjernes sum (2550.00) er ikke fakturaens beløb (2000.00)",
      },
    ]);
  });
});
