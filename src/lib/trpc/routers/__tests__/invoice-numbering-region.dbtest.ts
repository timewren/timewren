/**
 * Fakturanumre efter organisationens region mod rigtig Postgres (fund 11 og
 * 18 i docs/research/2026-11-22-foerste-oplevelse.md):
 *
 * - En organisation fra før (ingen region i metadata) får "INV-001" som før.
 * - En ny dansk organisation får løbenumre uden præfiks.
 * - Kladder på alle sprog ("UDKAST-", "DRAFT-", "ENTWURF-", …) forbruger
 *   ikke numre af serien.
 * - En ny kladde i en engelsk organisation hedder "DRAFT-…".
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clients, invoices, organizations } from "@/lib/db/schema";
import { regionForNewOrg, regionMetadata } from "@/lib/org/region";
import { clearOrgRegionCache } from "@/lib/org/region.server";
import { deviceCaller, seedAccount } from "../ext/__tests__/fixture";
import { computeNextInvoiceNumber } from "../invoices";

const enabled = process.env.TT_DB_TESTS === "1";

async function setRegion(orgId: string, locale: string, brand = "timewren") {
  await db
    .update(organizations)
    .set({
      metadata: {
        type: "freelance",
        ...regionMetadata(
          regionForNewOrg(brand as "timewren" | "timetrack", locale),
        ),
      },
    })
    .where(eq(organizations.id, orgId));
  clearOrgRegionCache();
}

async function insertInvoice(
  acc: { userId: string; orgId: string },
  clientId: string,
  invoiceNumber: string,
) {
  await db.insert(invoices).values({
    invoiceNumber,
    clientId,
    userId: acc.userId,
    organizationId: acc.orgId,
    amount: "100.00",
    status: invoiceNumber.match(/^\d|^INV-/) ? "sent" : "draft",
    issueDate: new Date("2026-11-01"),
    dueDate: new Date("2026-11-15"),
  });
}

async function seedClient(acc: { userId: string; orgId: string }) {
  const [client] = await db
    .insert(clients)
    .values({
      name: "Kunde ApS",
      userId: acc.userId,
      organizationId: acc.orgId,
    })
    .returning({ id: clients.id });
  return client.id;
}

const next = (acc: { userId: string; orgId: string }) =>
  db.transaction((tx) => computeNextInvoiceNumber(tx, acc.userId, acc.orgId));

describe.skipIf(!enabled)("fakturanumre efter region", () => {
  it("beholder INV-001 for en organisation fra før", async () => {
    const acc = await seedAccount();
    clearOrgRegionCache();
    expect(await next(acc)).toBe("INV-001");
  });

  it("giver en ny dansk organisation løbenumre uden præfiks", async () => {
    const acc = await seedAccount();
    await setRegion(acc.orgId, "da", "timetrack");
    expect(await next(acc)).toBe("1");
    const clientId = await seedClient(acc);
    await insertInvoice(acc, clientId, "1");
    expect(await next(acc)).toBe("2");
  });

  it("springer kladder over på alle sprog", async () => {
    const acc = await seedAccount();
    await setRegion(acc.orgId, "en");
    const clientId = await seedClient(acc);
    await insertInvoice(acc, clientId, "INV-007");
    for (const draft of [
      "UDKAST-X99",
      "DRAFT-X99",
      "ENTWURF-X99",
      "BORRADOR-X99",
    ])
      await insertInvoice(acc, clientId, draft);
    expect(await next(acc)).toBe("INV-008");
  });

  it("giver en engelsk organisations nye kladde DRAFT-", async () => {
    const acc = await seedAccount();
    await setRegion(acc.orgId, "en");
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Sunflower Bakery", email: "owner@example.com" },
    });
    const project = await api.projects.create({
      token: acc.token,
      data: { name: "Website", clientId: client.id, hourlyRate: "100" },
    });
    const entry = await api.entries.create({
      token: acc.token,
      data: {
        projectId: project.id,
        clientId: client.id,
        description: "Workshop",
        hours: 2,
        date: "2026-11-20",
      },
    });
    const draft = await api.invoices.createDraft({
      token: acc.token,
      data: { clientId: client.id, timeEntryIds: [entry.id] },
    });
    expect(draft.invoice.invoiceNumber).toMatch(/^DRAFT-/);
  });
});
