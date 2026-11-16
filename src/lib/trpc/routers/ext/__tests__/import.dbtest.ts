/**
 * Lokal → cloud-import (extension.import.run) med en fixture på 1.200
 * poster: dry-run opretter intet, importen overfører alt uden tab, et
 * gentaget kald opretter intet to gange, og Gratis' grænser er web's.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FREE_CLIENT_LIMIT_MESSAGE } from "@/lib/billing/plan-limits";
import { db } from "@/lib/db";
import {
  clients,
  companyProfiles,
  invoices,
  prepaidPackages,
  projects,
  timeEntries,
} from "@/lib/db/schema";
import { importClientEntryId } from "../import";
import { deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

/** En lokal desktop-database: 10 kunder (2 arkiverede), 15 projekter … */
function localFixture(entryCount = 1200) {
  const clientsIn = Array.from({ length: 10 }, (_, i) => ({
    localId: `c-${i}`,
    isArchived: i >= 8,
    data: { name: `Lokal kunde ${i}`, defaultHourlyRate: "700" },
  }));
  const projectsIn = Array.from({ length: 15 }, (_, i) => ({
    localId: `p-${i}`,
    clientLocalId: `c-${i % 10}`,
    data: {
      name: `Lokalt projekt ${i}`,
      hourlyRate: String(800 + i * 10),
      status: (i === 14 ? "archived" : "active") as "archived" | "active",
    },
  }));
  const prepaidIn = [0, 1, 2].map((i) => ({
    localId: `k-${i}`,
    clientLocalId: `c-${i}`,
    data: {
      name: `Klippekort ${i}`,
      totalHours: 100,
      hourlyRate: 750,
      purchaseDate: "2026-01-01",
    },
  }));

  const entriesIn = Array.from({ length: entryCount }, (_, i) => {
    const project = i % 15;
    const client = project % 10;
    const month = String(1 + (i % 9)).padStart(2, "0");
    const day = String(1 + (i % 27)).padStart(2, "0");
    // Hver 20. post på kunde 0-2 trækkes fra klippekortet.
    const prepaid = client < 3 && i % 20 === 0 ? `k-${client}` : null;
    return {
      localId: randomUUID(),
      projectLocalId: `p-${project}`,
      clientLocalId: `c-${client}`,
      prepaidLocalId: prepaid,
      data: {
        description: `Lokal post ${i}`,
        hours: 0.25 + (i % 12) * 0.25,
        date: `2026-${month}-${day}`,
      },
    };
  });

  // Fakturaer på kunde 3-7 (ingen klippekort), hver med kundens første 5
  // ikke-klippekort-poster.
  const invoicesIn = [3, 4, 5, 6, 7].map((client, n) => {
    const entryLocalIds = entriesIn
      .filter((e) => e.clientLocalId === `c-${client}` && !e.prepaidLocalId)
      .slice(0, 5)
      .map((e) => e.localId);
    const status = (["draft", "sent", "paid", "paid", "overdue"] as const)[n];
    return {
      localId: `i-${n}`,
      clientLocalId: `c-${client}`,
      entryLocalIds,
      invoiceNumber: `L-${1000 + n}`,
      paidDate: status === "paid" ? "2026-09-15" : undefined,
      data: {
        amount: "1000.00",
        status,
        issueDate: "2026-09-01",
        dueDate: "2026-09-15",
      },
    };
  });

  return {
    clients: clientsIn,
    projects: projectsIn,
    prepaidPackages: prepaidIn,
    entries: entriesIn,
    invoices: invoicesIn,
  };
}

/** Virksomhedsprofil — web kræver den før org'ens første faktura. */
async function seedCompanyProfile(acc: { userId: string; orgId: string }) {
  await db.insert(companyProfiles).values({
    userId: acc.userId,
    organizationId: acc.orgId,
    name: "Testfirma ApS",
    email: "faktura@testfirma.test",
  } as never);
}

async function countIn(
  orgId: string,
  table: typeof clients | typeof projects | typeof timeEntries,
) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.organizationId, orgId));
  return row.n;
}

describe.skipIf(!enabled)("extension.import.run (lokal → cloud)", () => {
  it("dry-run, import af 1.200 poster uden tab og idempotent gentagelse", async () => {
    const acc = await seedAccount("solo");
    const local = localFixture();
    const api = deviceCaller().extension.import;

    // Uden virksomhedsprofil forudser dry-run, at fakturaerne afvises.
    const noProfile = await api.run({ token: acc.token, ...local });
    expect(noProfile.report.invoices.failed).toBe(5);
    expect(noProfile.errors[0].message).toMatch(/Virksomhedsoplysningerne/);
    await seedCompanyProfile(acc);

    // Dry-run: fuld rapport, intet oprettet.
    const dry = await api.run({ token: acc.token, dryRun: true, ...local });
    expect(dry.dryRun).toBe(true);
    expect(dry.errorCount).toBe(0);
    expect(dry.report.entries).toEqual({
      total: 1200,
      created: 1200,
      existing: 0,
      failed: 0,
    });
    expect(dry.report.invoices.created).toBe(5);
    expect(await countIn(acc.orgId, clients)).toBe(0);
    expect(await countIn(acc.orgId, timeEntries)).toBe(0);
    expect(dry.ids.entries).toEqual({});

    // Import.
    const started = Date.now();
    const res = await api.run({ token: acc.token, dryRun: false, ...local });
    const ms = Date.now() - started;
    console.log(`[import] 1.200 poster importeret på ${ms} ms`);
    expect(res.errors).toEqual([]);
    expect(res.report.clients.created).toBe(10);
    expect(res.report.projects.created).toBe(15);
    expect(res.report.prepaidPackages.created).toBe(3);
    expect(res.report.entries.created).toBe(1200);
    expect(res.report.invoices.created).toBe(5);
    expect(Object.keys(res.ids.entries)).toHaveLength(1200);

    // Intet tab: antal, timer, arkivering, status, klippekort og fakturaer.
    expect(await countIn(acc.orgId, clients)).toBe(10);
    expect(await countIn(acc.orgId, projects)).toBe(15);
    expect(await countIn(acc.orgId, timeEntries)).toBe(1200);
    const [hours] = await db
      .select({ h: sql<string>`sum(${timeEntries.hours})` })
      .from(timeEntries)
      .where(eq(timeEntries.organizationId, acc.orgId));
    const expectedHours = local.entries.reduce((s, e) => s + e.data.hours, 0);
    expect(Number(hours.h)).toBeCloseTo(expectedHours, 2);

    const archivedClients = await db.query.clients.findMany({
      where: and(
        eq(clients.organizationId, acc.orgId),
        eq(clients.isArchived, true),
      ),
    });
    expect(archivedClients.map((c) => c.id).sort()).toEqual(
      [res.ids.clients["c-8"], res.ids.clients["c-9"]].sort(),
    );
    const archivedProject = await db.query.projects.findFirst({
      where: eq(projects.id, res.ids.projects["p-14"]),
    });
    expect(archivedProject?.status).toBe("archived");

    // Klippekort: web's træk = summen af de lokale klippekort-poster.
    for (const k of local.prepaidPackages) {
      const pkg = await db.query.prepaidPackages.findFirst({
        where: eq(prepaidPackages.id, res.ids.prepaidPackages[k.localId]),
      });
      const used = local.entries
        .filter((e) => e.prepaidLocalId === k.localId)
        .reduce((s, e) => s + e.data.hours, 0);
      expect(Number(pkg?.usedHours)).toBeCloseTo(used, 2);
    }

    // Timepris fra hierarkiet (projektets pris).
    const sample = local.entries[16]; // projekt p-1
    const entry = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, res.ids.entries[sample.localId]),
    });
    expect(Number(entry?.billableRate)).toBe(810);
    // clientEntryId afledt af org + lokalt id (web's egen idempotens).
    expect(entry?.clientEntryId).toBe(
      importClientEntryId(acc.orgId, acc.userId, sample.localId),
    );

    const invoiceRows = await db.query.invoices.findMany({
      where: inArray(invoices.id, Object.values(res.ids.invoices)),
    });
    expect(invoiceRows.map((i) => i.status).sort()).toEqual(
      ["draft", "overdue", "paid", "paid", "sent"].sort(),
    );
    for (const inv of invoiceRows) {
      if (inv.status === "draft") continue;
      expect(inv.notes).toMatch(/lokalt fakturanummer L-10\d\d/);
    }
    const billed = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(timeEntries)
      .where(inArray(timeEntries.invoiceId, Object.values(res.ids.invoices)));
    expect(billed[0].n).toBe(25);

    // Gentaget kald (fx efter afbrudt forbindelse): intet nyt.
    const again = await api.run({ token: acc.token, dryRun: false, ...local });
    expect(again.report.entries).toEqual({
      total: 1200,
      created: 0,
      existing: 1200,
      failed: 0,
    });
    expect(again.report.clients.created).toBe(0);
    expect(again.report.invoices.existing).toBe(5);
    expect(await countIn(acc.orgId, clients)).toBe(10);
    expect(await countIn(acc.orgId, timeEntries)).toBe(1200);
  }, 600_000);

  it("i bidder: kunder/projekter først, poster i to kald", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    const local = localFixture(100);
    const api = deviceCaller().extension.import;
    const base = {
      clients: local.clients,
      projects: local.projects,
      prepaidPackages: local.prepaidPackages,
    };
    const first = await api.run({
      token: acc.token,
      dryRun: false,
      ...base,
      entries: local.entries.slice(0, 60),
    });
    expect(first.report.entries.created).toBe(60);
    const second = await api.run({
      token: acc.token,
      dryRun: false,
      ...base,
      entries: local.entries.slice(40),
      invoices: local.invoices,
    });
    expect(second.report.clients.existing).toBe(10);
    expect(second.report.entries).toMatchObject({ created: 40, existing: 20 });
    expect(second.errors).toEqual([]);
    expect(await countIn(acc.orgId, timeEntries)).toBe(100);
  }, 120_000);

  it("fejler opfølgningen, giver et nyt forsøg ingen dublet-faktura", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    const local = localFixture(100);
    // Faktura i-2 er "betalt": oprettelsen lykkes, men markeringen som
    // betalt fejler på den ugyldige dato.
    local.invoices[2].paidDate = "ikke-en-dato";
    const api = deviceCaller().extension.import;
    const input = { token: acc.token, dryRun: false, ...local };

    const first = await api.run(input);
    expect(first.report.invoices).toMatchObject({ created: 5, failed: 1 });
    expect(first.errors.map((e: { localId: string }) => e.localId)).toEqual([
      "i-2",
    ]);
    const countInvoices = async () =>
      (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(invoices)
          .where(eq(invoices.organizationId, acc.orgId))
      )[0].n;
    expect(await countInvoices()).toBe(5);

    // Nyt forsøg med en gyldig dato: ingen ny faktura, men markeringen som
    // betalt gennemføres nu.
    local.invoices[2].paidDate = "2026-09-15";
    const again = await api.run({ ...input, invoices: local.invoices });
    expect(again.report.invoices).toMatchObject({
      created: 0,
      existing: 5,
      failed: 0,
    });
    expect(await countInvoices()).toBe(5);
    const paid = await db.query.invoices.findFirst({
      where: eq(invoices.id, first.ids.invoices["i-2"]),
      columns: { status: true },
    });
    expect(paid?.status).toBe("paid");
  }, 120_000);

  it("to samtidige importer: den ene afvises, intet oprettes to gange", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    const local = localFixture(100);
    const api = deviceCaller().extension.import;
    const input = { token: acc.token, dryRun: false, ...local };

    const results = await Promise.allSettled([api.run(input), api.run(input)]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(
      ((rejected[0] as PromiseRejectedResult).reason as { code?: string }).code,
    ).toBe("CONFLICT");
    expect(await countIn(acc.orgId, clients)).toBe(10);
    expect(await countIn(acc.orgId, timeEntries)).toBe(100);

    // Låsen slippes, når importen er færdig.
    const after = await api.run(input);
    expect(after.report.clients).toMatchObject({ created: 0, existing: 10 });
  }, 120_000);

  it("Gratis: web's kundeloft (ingen funktionslås), også i dry-run", async () => {
    const acc = await seedAccount("free");
    const local = localFixture(40);
    const api = deviceCaller().extension.import;

    const dry = await api.run({ token: acc.token, dryRun: true, ...local });
    // 2 arkiverede + 3 aktive kan komme ind; 5 aktive afvises.
    expect(dry.report.clients).toMatchObject({ created: 5, failed: 5 });
    expect(dry.errors.filter((e) => e.entity === "client")[0].message).toBe(
      FREE_CLIENT_LIMIT_MESSAGE,
    );
    // Klippekort er ikke låst bag planen: de tre pakker ligger på kunde 0-2,
    // som alle er blandt de 5 kunder, der kommer ind.
    expect(dry.report.prepaidPackages).toMatchObject({ created: 3, failed: 0 });
    expect(
      dry.errors.find((e) => e.message.includes("Fakturering og klippekort")),
    ).toBeUndefined();

    const res = await api.run({ token: acc.token, dryRun: false, ...local });
    expect(res.report.clients).toMatchObject({ created: 5, failed: 5 });
    expect(res.report.prepaidPackages).toMatchObject({ created: 3, failed: 0 });
    // Fakturaerne ligger på kunde 3-7, som alle er afvist af kundeloftet:
    // de fejler på den manglende kunde, ikke på en funktionslås.
    expect(res.report.invoices.failed).toBe(5);
    expect(
      res.errors.some((e) => e.message.includes("Fakturering og klippekort")),
    ).toBe(false);
    // Poster på afviste kunder fejler med en forklaring; resten kommer ind.
    expect(res.report.entries.failed).toBeGreaterThan(0);
    expect(res.report.entries.created).toBeGreaterThan(0);
    expect(res.errors.some((e) => /blev ikke importeret/.test(e.message))).toBe(
      true,
    );
    const [active] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(clients)
      .where(
        and(
          eq(clients.organizationId, acc.orgId),
          eq(clients.isArchived, false),
        ),
      );
    expect(active.n).toBe(3);
  }, 120_000);

  it("samme lokale id'er i en anden konto giver egne rækker", async () => {
    const a = await seedAccount("solo");
    const b = await seedAccount("solo");
    const local = localFixture(10);
    const api = deviceCaller().extension.import;
    const ra = await api.run({ token: a.token, dryRun: false, ...local });
    const rb = await api.run({ token: b.token, dryRun: false, ...local });
    expect(rb.report.clients.created).toBe(10);
    expect(rb.ids.clients["c-0"]).not.toBe(ra.ids.clients["c-0"]);
    expect(await countIn(b.orgId, clients)).toBe(10);
  }, 120_000);
});
