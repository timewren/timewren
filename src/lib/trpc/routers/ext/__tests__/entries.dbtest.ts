/**
 * extension.entries.update (web's time.update): desktop skal kunne fjerne
 * tidspunktet fra en post (`startTime`/`endTime: null`). Udeladt = uændret.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { prepaidPackages, timeEntries } from "@/lib/db/schema";
import { deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

describe.skipIf(!enabled)("extension.entries.update (token-API)", () => {
  it("rydder startTime og endTime med null, og udeladt bevarer dem", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const base = {
      description: "Møde",
      hours: 1,
      date: "2026-10-20",
    };
    const entry = await api.entries.create({
      token: acc.token,
      data: {
        ...base,
        startTime: "2026-10-20T08:00:00.000Z",
        endTime: "2026-10-20T09:00:00.000Z",
      },
    });

    // Udeladt tidspunkt: posten beholder sit tidsrum.
    await api.entries.update({
      token: acc.token,
      id: entry.id,
      data: { ...base, description: "Møde med kunden" },
    });
    let row = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, entry.id),
    });
    expect(row?.startTime?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(row?.endTime?.toISOString()).toBe("2026-10-20T09:00:00.000Z");

    // Kun sluttiden ryddes.
    await api.entries.update({
      token: acc.token,
      id: entry.id,
      data: { ...base, endTime: null },
    });
    row = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, entry.id),
    });
    expect(row?.startTime?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(row?.endTime).toBeNull();

    // Begge ryddes; timerne er uændrede.
    await api.entries.update({
      token: acc.token,
      id: entry.id,
      data: { ...base, startTime: null, endTime: null },
    });
    row = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, entry.id),
    });
    expect(row?.startTime).toBeNull();
    expect(row?.endTime).toBeNull();
    expect(Number(row?.hours)).toBe(1);
  });

  it("en faktureret post kan ikke få fjernet sit tidspunkt", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const base = { description: "Faktureret", hours: 2, date: "2026-10-21" };
    const entry = await api.entries.create({
      token: acc.token,
      data: {
        ...base,
        startTime: "2026-10-21T08:00:00.000Z",
        endTime: "2026-10-21T10:00:00.000Z",
      },
    });
    await db
      .update(timeEntries)
      .set({ isBilled: true, invoiceId: null })
      .where(eq(timeEntries.id, entry.id));
    const err = await errorOf(
      api.entries.update({
        token: acc.token,
        id: entry.id,
        data: { ...base, isBilled: true, startTime: null, endTime: null },
      }),
    );
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe.skipIf(!enabled)("intet klippekort ved oprettelse (token-API)", () => {
  async function seedCardClient() {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Kortkunde" },
    });
    // Kortet har auto-træk slået til (standard).
    const card = await api.klippekort.create({
      token: acc.token,
      data: {
        clientId: client.id,
        name: "Auto-kort",
        totalHours: 10,
        hourlyRate: 700,
        purchaseDate: "2026-10-01",
      },
    });
    return { acc, api, client, card };
  }

  async function remaining(id: string) {
    const row = await db.query.prepaidPackages.findFirst({
      where: eq(prepaidPackages.id, id),
      columns: { remainingHours: true },
    });
    return Number(row?.remainingHours);
  }

  it("prepaidPackageId: null og noPrepaid: true giver en post uden kort", async () => {
    const { acc, api, client, card } = await seedCardClient();
    const base = { clientId: client.id, hours: 2, date: "2026-10-20" };

    const viaNull = await api.entries.create({
      token: acc.token,
      data: {
        ...base,
        description: "Uden kort (null)",
        prepaidPackageId: null,
      },
    });
    const viaFlag = await api.entries.create({
      token: acc.token,
      data: { ...base, description: "Uden kort (flag)", noPrepaid: true },
    });
    for (const created of [viaNull, viaFlag]) {
      const row = await db.query.timeEntries.findFirst({
        where: eq(timeEntries.id, created.id),
        columns: { isPrepaid: true, prepaidPackageId: true },
      });
      expect(row).toEqual({ isPrepaid: false, prepaidPackageId: null });
    }
    expect(await remaining(card.id)).toBe(10);

    // Udeladt: som før. Med et kort: trækkes som før.
    await api.entries.create({
      token: acc.token,
      data: { ...base, description: "Udeladt" },
    });
    expect(await remaining(card.id)).toBe(10);
    await api.entries.create({
      token: acc.token,
      data: { ...base, description: "Med kort", prepaidPackageId: card.id },
    });
    expect(await remaining(card.id)).toBe(8);
  });

  it("noPrepaid sammen med et kort afvises", async () => {
    const { acc, api, client, card } = await seedCardClient();
    const err = await errorOf(
      api.entries.create({
        token: acc.token,
        data: {
          clientId: client.id,
          description: "Modstrid",
          hours: 1,
          date: "2026-10-20",
          prepaidPackageId: card.id,
          noPrepaid: true,
        },
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(await remaining(card.id)).toBe(10);
  });
});
