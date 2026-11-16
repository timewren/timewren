/**
 * import.run, desktop 0.2.24: en lokal kreditnota (beløb ≤ 0) med
 * reference til sin originale lokale faktura bliver en rigtig kreditnota
 * gennem web's createCreditNote (samme nummerserie, negerede linjer,
 * originalen udlignet). Idempotent ved gentagelse; dry-run opretter intet.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { companyProfiles, invoices, timeEntries } from "@/lib/db/schema";
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

function bundle(creditAmount = "-1600.00") {
  return {
    clients: [{ localId: "c-1", data: { name: "Kreditkunde" } }],
    projects: [
      {
        localId: "p-1",
        clientLocalId: "c-1",
        data: { name: "Kreditprojekt", hourlyRate: "800" },
      },
    ],
    entries: [
      {
        localId: "e-1",
        projectLocalId: "p-1",
        clientLocalId: "c-1",
        data: { description: "Fejlfaktureret", hours: 2, date: "2026-09-01" },
      },
    ],
    invoices: [
      // Kreditnotaen står før originalen: rækkefølgen må ikke betyde noget.
      {
        localId: "i-2",
        clientLocalId: "c-1",
        invoiceNumber: "L-8",
        creditNoteForLocalId: "i-1",
        data: {
          amount: creditAmount,
          status: "paid" as const,
          issueDate: "2026-09-10",
        },
      },
      {
        localId: "i-1",
        clientLocalId: "c-1",
        entryLocalIds: ["e-1"],
        invoiceNumber: "L-7",
        data: {
          amount: "1600.00",
          status: "sent" as const,
          issueDate: "2026-09-05",
          dueDate: "2026-09-19",
        },
      },
    ],
  };
}

async function orgInvoices(acc: Account) {
  return db.query.invoices.findMany({
    where: eq(invoices.organizationId, acc.orgId),
    with: { lines: true },
  });
}

describe.skipIf(!enabled)("import.run: kreditnotaer", () => {
  it("en lokal kreditnota bliver en rigtig kreditnota, kun én gang", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    const api = deviceCaller().extension;

    const dry = await api.import.run({ token: acc.token, ...bundle() });
    expect(dry.errors).toEqual([]);
    expect(dry.report.invoices).toEqual({
      total: 2,
      created: 2,
      existing: 0,
      failed: 0,
    });
    expect(await orgInvoices(acc)).toEqual([]);

    const res = await api.import.run({
      token: acc.token,
      dryRun: false,
      ...bundle(),
    });
    expect(res.errors).toEqual([]);
    expect(res.report.invoices.created).toBe(2);

    const rows = await orgInvoices(acc);
    expect(rows).toHaveLength(2);
    const original = rows.find((r) => r.id === res.ids.invoices["i-1"]);
    const credit = rows.find((r) => r.id === res.ids.invoices["i-2"]);
    expect(credit?.kind).toBe("credit_note");
    expect(credit?.relatedInvoiceId).toBe(original?.id);
    expect(credit?.amount).toBe("-1600.00");
    expect(credit?.status).toBe("paid");
    // Fortløbende nummerserie, ikke en kladde.
    expect(credit?.invoiceNumber).not.toBe(original?.invoiceNumber);
    expect(original?.status).toBe("paid");
    // Posten bliver på originalen (frigives ikke ved import).
    const entry = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, res.ids.entries["e-1"]),
      columns: { isBilled: true, invoiceId: true },
    });
    expect(entry).toEqual({ isBilled: true, invoiceId: original?.id });

    const again = await api.import.run({
      token: acc.token,
      dryRun: false,
      ...bundle(),
    });
    expect(again.errors).toEqual([]);
    expect(again.report.invoices).toEqual({
      total: 2,
      created: 0,
      existing: 2,
      failed: 0,
    });
    expect(await orgInvoices(acc)).toHaveLength(2);
  });

  it("afviser delvis kreditering og en kreditnota uden original", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    const api = deviceCaller().extension;

    const partial = await api.import.run({
      token: acc.token,
      dryRun: false,
      ...bundle("-500.00"),
    });
    expect(partial.report.invoices.failed).toBe(1);
    expect(partial.errors[0]).toMatchObject({
      entity: "invoice",
      localId: "i-2",
    });
    expect(
      (await orgInvoices(acc)).filter((r) => r.kind === "credit_note"),
    ).toEqual([]);

    const b = bundle();
    const orphan = await api.import.run({
      token: acc.token,
      ...b,
      invoices: [{ ...b.invoices[0], creditNoteForLocalId: "i-ukendt" }],
    });
    expect(orphan.report.invoices.failed).toBe(1);
    expect(orphan.errors[0].message).toContain("i-ukendt");

    // En kladde krediteres ikke af web; dry-run siger det på forhånd.
    const draftOriginal = await api.import.run({
      token: acc.token,
      ...b,
      invoices: [
        b.invoices[0],
        {
          ...b.invoices[1],
          data: { ...b.invoices[1].data, status: "draft" as const },
        },
      ],
    });
    expect(draftOriginal.errors).toEqual([
      expect.objectContaining({ localId: "i-2" }),
    ]);
    expect(draftOriginal.errors[0].message).toContain("kladde");
  });
});
