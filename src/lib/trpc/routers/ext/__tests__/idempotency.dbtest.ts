/**
 * Idempotensnøgle på token-API'ets create-procedurer: samme nøgle fra samme
 * bruger/org inden for 24 timer giver det oprindelige objekt, også ved
 * samtidige kald. En fejlet oprettelse frigiver nøglen.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  clients,
  deviceIdempotencyKeys,
  invoices,
  members,
  prepaidPackages,
  projects,
  tasks,
  timeEntries,
} from "@/lib/db/schema";
import { type Account, deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

async function countClients(acc: Account, name: string) {
  const rows = await db.query.clients.findMany({
    where: and(eq(clients.userId, acc.userId), eq(clients.name, name)),
    columns: { id: true },
  });
  return rows.length;
}

describe.skipIf(!enabled)("idempotensnøgle på create (token-API)", () => {
  it("samme nøgle giver samme kunde; en ny nøgle en ny", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const key = randomUUID();
    const first = await api.clients.create({
      token: acc.token,
      idempotencyKey: key,
      data: { name: "Nøglekunde" },
    });
    const again = await api.clients.create({
      token: acc.token,
      idempotencyKey: key,
      data: { name: "Nøglekunde" },
    });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Nøglekunde");
    expect(await countClients(acc, "Nøglekunde")).toBe(1);

    const other = await api.clients.create({
      token: acc.token,
      idempotencyKey: randomUUID(),
      data: { name: "Nøglekunde" },
    });
    expect(other.id).not.toBe(first.id);
    // Uden nøgle: som før (ingen dedup).
    await api.clients.create({
      token: acc.token,
      data: { name: "Nøglekunde" },
    });
    expect(await countClients(acc, "Nøglekunde")).toBe(3);
  });

  it("samtidige kald med samme nøgle opretter kun én", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const key = randomUUID();
    const call = () =>
      api.clients
        .create({
          token: acc.token,
          idempotencyKey: key,
          data: { name: "Samtidig" },
        })
        .then(
          (c) => ({ ok: true as const, id: c.id }),
          (e: { code?: string }) => ({ ok: false as const, code: e.code }),
        );
    const results = await Promise.all([call(), call(), call()]);
    const ids = new Set(results.flatMap((r) => (r.ok ? [r.id] : [])));
    expect(ids.size).toBe(1);
    for (const r of results) if (!r.ok) expect(r.code).toBe("CONFLICT");
    expect(await countClients(acc, "Samtidig")).toBe(1);
    // Når den første er færdig, giver nøglen kunden.
    const later = await call();
    expect(later).toEqual({ ok: true, id: [...ids][0] });
  });

  it("nøglen gælder pr. bruger, pr. org og pr. procedure", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    const api = deviceCaller().extension;
    const key = randomUUID();
    const ca = await api.clients.create({
      token: a.token,
      idempotencyKey: key,
      data: { name: "Delt nøgle" },
    });
    const cb = await api.clients.create({
      token: b.token,
      idempotencyKey: key,
      data: { name: "Delt nøgle" },
    });
    expect(cb.id).not.toBe(ca.id);
    expect(cb.organizationId).toBe(b.orgId);

    // Samme nøgle på et projekt er en anden procedure.
    const project = await api.projects.create({
      token: a.token,
      idempotencyKey: key,
      data: { name: "Nøgleprojekt", clientId: ca.id },
    });
    expect(project.clientId).toBe(ca.id);

    // En anden org for samme bruger (a er også medlem af b's org).
    const org2 = b.orgId;
    await db.insert(members).values({
      id: `m2-${a.userId}`,
      organizationId: org2,
      userId: a.userId,
      role: "admin",
    } as never);
    const c2 = await api.clients.create({
      token: a.token,
      organizationId: org2,
      idempotencyKey: key,
      data: { name: "Delt nøgle" },
    });
    expect(c2.id).not.toBe(ca.id);
    expect(c2.organizationId).toBe(org2);
  });

  it("efter 24 timer er nøglen brugt op og giver et nyt objekt", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const key = randomUUID();
    const first = await api.clients.create({
      token: acc.token,
      idempotencyKey: key,
      data: { name: "Gammel nøgle" },
    });
    await db
      .update(deviceIdempotencyKeys)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(deviceIdempotencyKeys.key, key));
    const next = await api.clients.create({
      token: acc.token,
      idempotencyKey: key,
      data: { name: "Gammel nøgle" },
    });
    expect(next.id).not.toBe(first.id);
  });

  it("en fejlet oprettelse frigiver nøglen", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const key = randomUUID();
    const err = await errorOf(
      api.clients.create({
        token: acc.token,
        idempotencyKey: key,
        data: { name: "" },
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    const ok = await api.clients.create({
      token: acc.token,
      idempotencyKey: key,
      data: { name: "Anden gang" },
    });
    expect(ok.name).toBe("Anden gang");
  });

  it("projekter, opgaver, klippekort, poster og kladder", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const twice = async <T>(fn: () => Promise<T>) => [await fn(), await fn()];

    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Alt-kunde" },
    });
    const pKey = randomUUID();
    const [p1, p2] = await twice(() =>
      api.projects.create({
        token: acc.token,
        idempotencyKey: pKey,
        data: { name: "Alt-projekt", clientId: client.id, hourlyRate: "700" },
      }),
    );
    expect(p2.id).toBe(p1.id);

    const tKey = randomUUID();
    const [t1, t2] = await twice(() =>
      api.tasks.create({
        token: acc.token,
        idempotencyKey: tKey,
        data: { title: "Alt-opgave", projectId: p1.id },
      }),
    );
    expect(t2.id).toBe(t1.id);

    const kKey = randomUUID();
    // Kortet ligger på en anden kunde, så posterne nedenfor kan faktureres.
    const cardClient = await api.clients.create({
      token: acc.token,
      data: { name: "Kort-kunde" },
    });
    const [k1, k2] = await twice(() =>
      api.klippekort.create({
        token: acc.token,
        idempotencyKey: kKey,
        data: {
          clientId: cardClient.id,
          name: "Alt-kort",
          totalHours: 10,
          hourlyRate: 700,
          purchaseDate: "2026-10-01",
        },
      }),
    );
    expect(k2.id).toBe(k1.id);

    const eKey = randomUUID();
    const [e1, e2] = await twice(() =>
      api.entries.create({
        token: acc.token,
        idempotencyKey: eKey,
        data: {
          projectId: p1.id,
          clientId: client.id,
          description: "Alt-post",
          hours: 1,
          date: "2026-10-20",
        },
      }),
    );
    expect(e2.id).toBe(e1.id);

    const lKey = randomUUID();
    const [l1, l2] = await twice(() =>
      api.tasks.logTime({
        token: acc.token,
        id: t1.id,
        idempotencyKey: lKey,
        data: {
          projectId: p1.id,
          clientId: client.id,
          description: "Opgavetid",
          hours: 0.5,
          date: "2026-10-20",
        },
      }),
    );
    expect(l2.id).toBe(l1.id);

    const open = await api.invoices.uninvoicedEntries({
      token: acc.token,
      clientId: client.id,
    });
    const ids = open.map((e: { id: string }) => e.id);
    expect(ids.sort()).toEqual([e1.id, l1.id].sort());
    const dKey = randomUUID();
    const [d1, d2] = await twice(() =>
      api.invoices.createDraft({
        token: acc.token,
        idempotencyKey: dKey,
        data: { clientId: client.id, timeEntryIds: ids },
      }),
    );
    expect(d2.invoice.id).toBe(d1.invoice.id);
    expect(d2.lines.map((l) => l.id).sort()).toEqual(
      d1.lines.map((l) => l.id).sort(),
    );
    const drafts = await db.query.invoices.findMany({
      where: eq(invoices.clientId, client.id),
    });
    expect(drafts).toHaveLength(1);

    const counts = await Promise.all([
      db.$count(projects, eq(projects.organizationId, acc.orgId)),
      db.$count(tasks, eq(tasks.organizationId, acc.orgId)),
      db.$count(prepaidPackages, eq(prepaidPackages.organizationId, acc.orgId)),
      db.$count(timeEntries, eq(timeEntries.userId, acc.userId)),
    ]);
    expect(counts.slice(0, 3)).toEqual([1, 1, 1]);
    expect(counts[3]).toBe(2);
  });
});

describe.skipIf(!enabled)("idempotensnøgle på klippekort.topUp", () => {
  async function seedCard(acc: Account) {
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Optankningskunde" },
    });
    return api.klippekort.create({
      token: acc.token,
      data: {
        clientId: client.id,
        name: "Optankningskort",
        totalHours: 10,
        hourlyRate: 700,
        purchaseDate: "2026-10-01",
      },
    });
  }

  async function hoursOf(id: string) {
    const row = await db.query.prepaidPackages.findFirst({
      where: eq(prepaidPackages.id, id),
      columns: { totalHours: true, remainingHours: true },
    });
    return {
      total: Number(row?.totalHours),
      remaining: Number(row?.remainingHours),
    };
  }

  it("samme nøgle fylder kun på én gang, også ved samtidige kald", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const card = await seedCard(acc);
    const key = randomUUID();

    const first = await api.klippekort.topUp({
      token: acc.token,
      id: card.id,
      hours: 5,
      idempotencyKey: key,
    });
    expect(Number(first.totalHours)).toBe(15);
    const again = await api.klippekort.topUp({
      token: acc.token,
      id: card.id,
      hours: 5,
      idempotencyKey: key,
    });
    expect(again.id).toBe(card.id);
    expect(Number(again.totalHours)).toBe(15);
    expect(await hoursOf(card.id)).toEqual({ total: 15, remaining: 15 });

    // Samtidige kald med en ny nøgle: højst én optankning.
    const key2 = randomUUID();
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        api.klippekort.topUp({
          token: acc.token,
          id: card.id,
          hours: 2,
          idempotencyKey: key2,
        }),
      ),
    );
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results) {
      if (r.status === "rejected") {
        expect((r.reason as { code?: string }).code).toBe("CONFLICT");
      }
    }
    expect(await hoursOf(card.id)).toEqual({ total: 17, remaining: 17 });

    // Uden nøgle: som før.
    await api.klippekort.topUp({ token: acc.token, id: card.id, hours: 1 });
    expect(await hoursOf(card.id)).toEqual({ total: 18, remaining: 18 });
  });

  it("en fejlet optankning frigiver nøglen", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const card = await seedCard(acc);
    const key = randomUUID();
    const err = await errorOf(
      api.klippekort.topUp({
        token: acc.token,
        id: card.id,
        hours: 0,
        idempotencyKey: key,
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    const ok = await api.klippekort.topUp({
      token: acc.token,
      id: card.id,
      hours: 3,
      idempotencyKey: key,
    });
    expect(Number(ok.totalHours)).toBe(13);
  });
});
