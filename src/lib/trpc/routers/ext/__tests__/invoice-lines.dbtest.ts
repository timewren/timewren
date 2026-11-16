/**
 * Fakturalinjer til desktop: en kladde fra generateFromTimeEntries har én
 * linje pr. post (med `timeEntryId`), så linje-editoren ikke er tom og en
 * gemning ikke frigiver posterne. `invoices.linesByInvoice` giver linjerne
 * for mange fakturaer i ét kald, kun i egen org.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  invoices,
  memberClientAccess,
  members,
  organizations,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { type Account, deviceCaller, seedAccount, webCaller } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function seedEntries(acc: Account, hoursList: number[], rate: string) {
  const api = deviceCaller().extension;
  const client = await api.clients.create({
    token: acc.token,
    data: { name: "Linjekunde" },
  });
  const project = await api.projects.create({
    token: acc.token,
    data: { name: "Linjeprojekt", clientId: client.id, hourlyRate: rate },
  });
  const entryIds: string[] = [];
  for (const [i, hours] of hoursList.entries()) {
    const entry = await api.entries.create({
      token: acc.token,
      data: {
        projectId: project.id,
        clientId: client.id,
        description: `Post ${i + 1}`,
        hours,
        date: `2026-10-${String(20 - i).padStart(2, "0")}`,
      },
    });
    entryIds.push(entry.id);
  }
  return { client, project, entryIds };
}

describe.skipIf(!enabled)("fakturalinjer (token-API)", () => {
  it("en kladde fra ufaktureret tid har én linje pr. post", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { client, entryIds } = await seedEntries(acc, [2, 1.5], "850");

    const draft = await api.invoices.createDraft({
      token: acc.token,
      data: { clientId: client.id, timeEntryIds: entryIds },
    });
    const invoiceId = draft.invoice.id;
    // Beløbet er det samme som før linjerne.
    expect(Number(draft.invoice.amount)).toBe(3.5 * 850);

    const lines = await api.invoices.lines({ token: acc.token, id: invoiceId });
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.timeEntryId).sort()).toEqual(
      [...entryIds].sort(),
    );
    // Ældste dato først.
    expect(lines.map((l) => l.sortOrder)).toEqual([0, 1]);
    expect(lines[0].timeEntryId).toBe(entryIds[1]);
    expect(lines[0]).toMatchObject({
      quantity: "1.50",
      unitPrice: "850.00",
      amount: "1275.00",
    });
    expect(lines[1]).toMatchObject({
      quantity: "2.00",
      unitPrice: "850.00",
      amount: "1700.00",
    });
    expect(draft.lines.map((l) => l.id).sort()).toEqual(
      lines.map((l) => l.id).sort(),
    );

    // Desktop gemmer linjerne igen (med id og timeEntryId): ingen fejl, og
    // posterne bliver på fakturaen.
    await api.invoices.saveLines({
      token: acc.token,
      data: {
        invoiceId,
        lines: lines.map((l, i) => ({
          id: l.id,
          description: i === 0 ? "Rettet" : l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          amount: String(l.amount),
          timeEntryId: l.timeEntryId,
          sortOrder: i,
        })),
      },
    });
    const billed = await db.query.timeEntries.findMany({
      where: eq(timeEntries.invoiceId, invoiceId),
      columns: { id: true, isBilled: true },
    });
    expect(billed).toHaveLength(2);
    expect(billed.every((e) => e.isBilled)).toBe(true);
    const row = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
    });
    expect(Number(row?.amount)).toBe(3.5 * 850);
  });

  it("beløbet er summen af linjerne, også med øre", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { client, entryIds } = await seedEntries(
      acc,
      [0.33, 0.33, 0.33],
      "850.55",
    );
    const draft = await api.invoices.createDraft({
      token: acc.token,
      data: { clientId: client.id, timeEntryIds: entryIds },
    });
    const lines = await api.invoices.lines({
      token: acc.token,
      id: draft.invoice.id,
    });
    const sum = lines.reduce(
      (s, l) => s + Math.round(Number(l.amount) * 100),
      0,
    );
    expect(Math.round(Number(draft.invoice.amount) * 100)).toBe(sum);
    expect(Math.round(draft.totalAmount * 100)).toBe(sum);
  });

  it("forhåndsvisningen giver samme beløb som kladden", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { client, entryIds } = await seedEntries(
      acc,
      [0.33, 0.33, 0.33],
      "799.99",
    );
    const preview = await api.invoices.previewDraft({
      token: acc.token,
      data: { clientId: client.id },
    });
    const draft = await api.invoices.createDraft({
      token: acc.token,
      data: { clientId: client.id, timeEntryIds: entryIds },
    });
    expect(Number(draft.invoice.amount)).toBe(792);
    expect(preview.totalAmount).toBe(792);
  });

  it("to samtidige kladder på samme poster: kun én lykkes", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { client, entryIds } = await seedEntries(acc, [1, 2], "500");
    const draft = () =>
      api.invoices
        .createDraft({
          token: acc.token,
          data: { clientId: client.id, timeEntryIds: entryIds },
        })
        .then(
          (d) => ({ ok: true as const, id: d.invoice.id }),
          (e: { code?: string }) => ({ ok: false as const, code: e.code }),
        );
    const results = await Promise.all([draft(), draft(), draft()]);
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    const winner = (ok[0] as { id: string }).id;
    for (const r of results) if (!r.ok) expect(r.code).toBe("BAD_REQUEST");

    const all = await db.query.invoices.findMany({
      where: eq(invoices.clientId, client.id),
    });
    expect(all.map((i) => i.id)).toEqual([winner]);
    const billed = await db.query.timeEntries.findMany({
      where: eq(timeEntries.invoiceId, winner),
      columns: { id: true },
    });
    expect(billed).toHaveLength(2);
  });

  it("linesByInvoice giver linjer for mange fakturaer, kun i egen org", async () => {
    const a = await seedAccount("solo");
    const b = await seedAccount("solo");
    const api = deviceCaller().extension;
    const seededA = await seedEntries(a, [1, 2, 3], "500");
    const d1 = await api.invoices.createDraft({
      token: a.token,
      data: {
        clientId: seededA.client.id,
        timeEntryIds: seededA.entryIds.slice(0, 2),
      },
    });
    const d2 = await api.invoices.createDraft({
      token: a.token,
      data: {
        clientId: seededA.client.id,
        timeEntryIds: seededA.entryIds.slice(2),
      },
    });
    // En ældre faktura uden linjer (før denne ændring) bevarer sit beløb.
    const [legacy] = await db
      .insert(invoices)
      .values({
        invoiceNumber: "KLADDE-legacy",
        clientId: seededA.client.id,
        userId: a.userId,
        organizationId: a.orgId,
        amount: "999.99",
        status: "draft",
        issueDate: new Date("2026-10-01"),
        dueDate: new Date("2026-10-15"),
      })
      .returning();
    const seededB = await seedEntries(b, [1], "500");
    const foreign = await api.invoices.createDraft({
      token: b.token,
      data: {
        clientId: seededB.client.id,
        timeEntryIds: seededB.entryIds,
      },
    });

    const res = await api.invoices.linesByInvoice({
      token: a.token,
      ids: [d1.invoice.id, d2.invoice.id, legacy.id, foreign.invoice.id],
    });
    expect(Object.keys(res).sort()).toEqual(
      [d1.invoice.id, d2.invoice.id, legacy.id].sort(),
    );
    expect(res[d1.invoice.id]).toHaveLength(2);
    expect(res[d2.invoice.id]).toHaveLength(1);
    expect(res[d2.invoice.id][0].timeEntryId).toBe(seededA.entryIds[2]);
    expect(res[legacy.id]).toEqual([]);
    const legacyRow = await db.query.invoices.findFirst({
      where: eq(invoices.id, legacy.id),
    });
    expect(legacyRow?.amount).toBe("999.99");
  });

  it("linesByInvoice respekterer medlemmets kundeadgang", async () => {
    const owner = await seedAccount("solo");
    const api = deviceCaller().extension;
    const tilladt = await seedEntries(owner, [1], "500");
    const skjult = await seedEntries(owner, [2], "500");
    const dTilladt = await api.invoices.createDraft({
      token: owner.token,
      data: { clientId: tilladt.client.id, timeEntryIds: tilladt.entryIds },
    });
    const dSkjult = await api.invoices.createDraft({
      token: owner.token,
      data: { clientId: skjult.client.id, timeEntryIds: skjult.entryIds },
    });

    // Et almindeligt medlem i samme org, der kun har adgang til den ene kunde.
    const memberUserId = `dev-member-user-${owner.orgId}`;
    const memberId = `dev-member-row-${owner.orgId}`;
    await db.insert(users).values({
      id: memberUserId,
      email: `${memberUserId}@device.test`,
      name: "Begrænset Medlem",
      emailVerified: true,
    } as never);
    await db.insert(members).values({
      id: memberId,
      organizationId: owner.orgId,
      userId: memberUserId,
      role: "member",
    } as never);
    await db
      .update(organizations)
      .set({ metadata: { restrictClientAccess: true } } as never)
      .where(eq(organizations.id, owner.orgId));
    await db.insert(memberClientAccess).values({
      organizationId: owner.orgId,
      memberId,
      clientId: tilladt.client.id,
    } as never);

    const res = await webCaller({
      ...owner,
      userId: memberUserId,
    }).invoices.linesByInvoice({
      ids: [dTilladt.invoice.id, dSkjult.invoice.id],
    });
    expect(Object.keys(res)).toEqual([dTilladt.invoice.id]);
    expect(res[dTilladt.invoice.id]).toHaveLength(1);
  });
});

describe.skipIf(!enabled)("kladde kun med kundens egne poster", () => {
  async function errorOf(p: Promise<unknown>) {
    try {
      await p;
    } catch (err) {
      return err as { code?: string; message: string };
    }
    throw new Error("forventede en fejl");
  }

  it("generateFromTimeEntries afviser poster fra en anden kunde (web)", async () => {
    const acc = await seedAccount("solo");
    const a = await seedEntries(acc, [1], "500");
    const b = await seedEntries(acc, [2], "700");
    const err = await errorOf(
      webCaller(acc).invoices.generateFromTimeEntries({
        clientId: a.client.id,
        timeEntryIds: [...a.entryIds, ...b.entryIds],
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe(
      "En eller flere tidsregistreringer blev ikke fundet",
    );
    const rows = await db.query.timeEntries.findMany({
      where: eq(timeEntries.isBilled, true),
      columns: { id: true },
    });
    const billed = new Set(rows.map((r) => r.id));
    for (const id of [...a.entryIds, ...b.entryIds]) {
      expect(billed.has(id)).toBe(false);
    }
  });

  it("createDraft afviser poster fra en anden kunde (token)", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const a = await seedEntries(acc, [1], "500");
    const b = await seedEntries(acc, [2], "700");
    const err = await errorOf(
      api.invoices.createDraft({
        token: acc.token,
        data: { clientId: a.client.id, timeEntryIds: b.entryIds },
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe(
      "En eller flere tidsregistreringer blev ikke fundet",
    );
    expect(
      await db.query.invoices.findMany({
        where: eq(invoices.organizationId, acc.orgId),
      }),
    ).toEqual([]);
    // Med kundens egne poster går det stadig.
    const ok = await api.invoices.createDraft({
      token: acc.token,
      data: { clientId: a.client.id, timeEntryIds: a.entryIds },
    });
    expect(ok.invoice.clientId).toBe(a.client.id);
  });

  it("saveLines kan ikke knytte en anden kundes post til kladden", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const a = await seedEntries(acc, [1], "500");
    const b = await seedEntries(acc, [2], "700");
    const draft = await api.invoices.createDraft({
      token: acc.token,
      data: { clientId: a.client.id, timeEntryIds: a.entryIds },
    });
    const lines = await api.invoices.lines({
      token: acc.token,
      id: draft.invoice.id,
    });
    const err = await errorOf(
      api.invoices.saveLines({
        token: acc.token,
        data: {
          invoiceId: draft.invoice.id,
          lines: [
            ...lines.map((l, i) => ({
              id: l.id,
              description: l.description,
              quantity: String(l.quantity),
              unitPrice: String(l.unitPrice),
              amount: String(l.amount),
              timeEntryId: l.timeEntryId,
              sortOrder: i,
            })),
            {
              description: "Fremmed post",
              quantity: "2",
              unitPrice: "700",
              amount: "1400",
              timeEntryId: b.entryIds[0],
              sortOrder: lines.length,
            },
          ],
        },
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    const foreign = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, b.entryIds[0]),
      columns: { isBilled: true, invoiceId: true },
    });
    expect(foreign).toEqual({ isBilled: false, invoiceId: null });
  });

  it("en post med kunden kun på projektet kan stadig faktureres", async () => {
    const acc = await seedAccount("solo");
    const a = await seedEntries(acc, [1], "500");
    // Ældre poster har kun projektet; kunden kommer derfra (som preview).
    await db
      .update(timeEntries)
      .set({ clientId: null })
      .where(eq(timeEntries.id, a.entryIds[0]));
    const draft = await webCaller(acc).invoices.generateFromTimeEntries({
      clientId: a.client.id,
      timeEntryIds: a.entryIds,
    });
    expect(draft.lines).toHaveLength(1);
  });

  it("getLines respekterer medlemmets kundeadgang", async () => {
    const owner = await seedAccount("solo");
    const api = deviceCaller().extension;
    const tilladt = await seedEntries(owner, [1], "500");
    const skjult = await seedEntries(owner, [2], "500");
    const dTilladt = await api.invoices.createDraft({
      token: owner.token,
      data: { clientId: tilladt.client.id, timeEntryIds: tilladt.entryIds },
    });
    const dSkjult = await api.invoices.createDraft({
      token: owner.token,
      data: { clientId: skjult.client.id, timeEntryIds: skjult.entryIds },
    });

    const memberUserId = `dev-lines-user-${owner.orgId}`;
    const memberId = `dev-lines-row-${owner.orgId}`;
    await db.insert(users).values({
      id: memberUserId,
      email: `${memberUserId}@device.test`,
      name: "Begrænset Medlem",
      emailVerified: true,
    } as never);
    await db.insert(members).values({
      id: memberId,
      organizationId: owner.orgId,
      userId: memberUserId,
      role: "member",
    } as never);
    await db
      .update(organizations)
      .set({ metadata: { restrictClientAccess: true } } as never)
      .where(eq(organizations.id, owner.orgId));
    await db.insert(memberClientAccess).values({
      organizationId: owner.orgId,
      memberId,
      clientId: tilladt.client.id,
    } as never);

    const member = webCaller({ ...owner, userId: memberUserId });
    const lines = await member.invoices.getLines({
      invoiceId: dTilladt.invoice.id,
    });
    expect(lines).toHaveLength(1);
    const err = await errorOf(
      member.invoices.getLines({ invoiceId: dSkjult.invoice.id }),
    );
    expect(err.code).toBe("FORBIDDEN");
  });
});
