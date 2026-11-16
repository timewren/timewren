/**
 * Rækkelåsen ved fakturaovergange mod rigtig Postgres (#1144, opfølgning på
 * #1110). `invoices-status-lock.test.ts` viser med en mocket db, at
 * update/transition/delete kalder `lockInvoiceStatus`; her vises, at låsen
 * faktisk serialiserer to samtidige overgange, så kun én vinder.
 *
 * Racen gøres deterministisk med en "port": en tredje transaktion holder
 * fakturarækken (FOR UPDATE), mens begge mutationer læser og validerer
 * statussen uden for deres transaktion og derefter blokerer. Først når
 * Postgres melder to ventende backends, slippes porten.
 *
 * - Med låsen venter begge på rækken; den første skriver, den anden ser den
 *   nye status og afvises med CONFLICT.
 * - Uden låsen skriver begge oven på den samme forældede læsning: to
 *   udstedelser trækker hver sit nummer fra serien, og en sletning kan
 *   frigive tidsposterne på en faktura, der netop er udstedt.
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { invoices, timeEntries } from "@/lib/db/schema";
import { isDraftInvoiceNumber } from "@/lib/invoices/draft-number";
import {
  type Account,
  deviceCaller,
  seedAccount,
  webCaller,
} from "../ext/__tests__/fixture";

const enabled = process.env.TT_DB_TESTS === "1";

/** Kladde med to fakturerede tidsposter, oprettet som i token-API'et. */
async function seedDraft(acc: Account) {
  const api = deviceCaller().extension;
  const client = await api.clients.create({
    token: acc.token,
    data: { name: "Testkunde ApS", email: "faktura@example.com" },
  });
  const project = await api.projects.create({
    token: acc.token,
    data: { name: "Låseprojekt", clientId: client.id, hourlyRate: "850" },
  });
  const entryIds: string[] = [];
  for (const hours of [2, 1.5]) {
    const entry = await api.entries.create({
      token: acc.token,
      data: {
        projectId: project.id,
        clientId: client.id,
        description: `Arbejde ${hours} t`,
        hours,
        date: "2026-10-20",
      },
    });
    entryIds.push(entry.id);
  }
  const draft = await api.invoices.createDraft({
    token: acc.token,
    data: { clientId: client.id, timeEntryIds: entryIds },
  });
  expect(draft.invoice.status).toBe("draft");
  expect(isDraftInvoiceNumber(draft.invoice.invoiceNumber)).toBe(true);
  return { invoiceId: draft.invoice.id as string, entryIds };
}

/**
 * Backends, der venter på en lås i en forespørgsel mod fakturatabellen. Andre
 * låseventere i databasen (fx en hængende skrivning fra en tidligere test)
 * tælles ikke med, så porten ikke slippes, før begge racere er nået frem.
 */
async function lockWaiters(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND pid <> pg_backend_pid() AND query ILIKE '%"invoices"%'
  `);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Hold fakturarækken låst, start overgangene én ad gangen og vent hver gang,
 * til den står og venter på en lås i Postgres (dvs. har læst og valideret
 * statussen), og slip så porten. Ventende på samme række får låsen i den
 * rækkefølge, de kom i kø, så den første i `start` kommer først til.
 */
async function raceBehindGate(
  invoiceId: string,
  start: (() => Promise<unknown>)[],
): Promise<PromiseSettledResult<unknown>[]> {
  let release!: () => void;
  const released = new Promise<void>((r) => {
    release = r;
  });
  let held!: () => void;
  const isHeld = new Promise<void>((r) => {
    held = r;
  });
  const gate = db.transaction(async (tx) => {
    await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .for("update");
    held();
    await released;
  });
  await isHeld;

  const racers: Promise<unknown>[] = [];
  const settled = () => Promise.allSettled(racers);
  try {
    for (const run of start) {
      racers.push(run());
      const deadline = Date.now() + 10_000;
      while ((await lockWaiters()) < racers.length) {
        if (Date.now() > deadline) {
          throw new Error("overgangene blokerede ikke bag den låste række");
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  } finally {
    release();
    await gate;
  }
  return settled();
}

function outcome(results: PromiseSettledResult<unknown>[]) {
  const won = results.filter((r) => r.status === "fulfilled");
  const lost = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  return { won, lost };
}

async function readInvoice(invoiceId: string) {
  const [row] = await db
    .select({
      status: invoices.status,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  return row;
}

describe.skipIf(!enabled)(
  "fakturaovergange: rækkelåsen lader kun én samtidig overgang vinde (#1144)",
  () => {
    it("to samtidige udstedelser af samme kladde: én vinder, den anden får CONFLICT og trækker intet nummer", async () => {
      const acc = await seedAccount("solo");
      const { invoiceId } = await seedDraft(acc);
      const api = webCaller(acc);

      const results = await raceBehindGate(invoiceId, [
        () => api.invoices.transition({ id: invoiceId, newStatus: "sent" }),
        () => api.invoices.transition({ id: invoiceId, newStatus: "sent" }),
      ]);

      const { won, lost } = outcome(results);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0].reason as { code?: string }).code).toBe("CONFLICT");

      const winner = (
        won[0] as PromiseFulfilledResult<{ invoiceNumber: string }>
      ).value;
      const row = await readInvoice(invoiceId);
      expect(row.status).toBe("sent");
      expect(isDraftInvoiceNumber(row.invoiceNumber)).toBe(false);
      expect(row.invoiceNumber).toBe(winner.invoiceNumber);

      // Taberen rullede tilbage uden at bruge et nummer fra den lovpligtige
      // serie: den næste udstedelse får nummeret lige efter vinderens.
      const next = await seedDraft(acc);
      const issued = await api.invoices.transition({
        id: next.invoiceId,
        newStatus: "sent",
      });
      const seq = (n: string) => Number(n.match(/(\d+)$/)?.[1]);
      expect(seq(issued.invoiceNumber)).toBe(seq(winner.invoiceNumber) + 1);
    });

    async function raceDeleteAndIssue(first: "delete" | "issue") {
      const acc = await seedAccount("solo");
      const { invoiceId, entryIds } = await seedDraft(acc);
      const api = webCaller(acc);
      const del = () => api.invoices.delete({ id: invoiceId });
      const issue = () =>
        api.invoices.transition({ id: invoiceId, newStatus: "sent" });

      const results = await raceBehindGate(
        invoiceId,
        first === "delete" ? [del, issue] : [issue, del],
      );

      const { won, lost } = outcome(results);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0].reason as { code?: string }).code).toBe("CONFLICT");
      expect(results[0].status).toBe("fulfilled");

      const row = await readInvoice(invoiceId);
      const billed = await db
        .select({ id: timeEntries.id })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.invoiceId, invoiceId),
            eq(timeEntries.isBilled, true),
          ),
        );
      return { row, billed, entryIds };
    }

    it("udstedelse vinder over en samtidig sletning: tidsposterne forbliver fakturerede", async () => {
      const { row, billed, entryIds } = await raceDeleteAndIssue("issue");
      expect(row.status).toBe("sent");
      expect(isDraftInvoiceNumber(row.invoiceNumber)).toBe(false);
      // Den tabte sletning må ikke have frigivet posterne.
      expect(billed.map((e) => e.id).sort()).toEqual([...entryIds].sort());
    });

    it("sletning vinder over en samtidig udstedelse: posterne frigives, og intet nummer trækkes", async () => {
      const { row, billed } = await raceDeleteAndIssue("delete");
      expect(row.status).toBe("deleted");
      // Den tabte udstedelse må ikke have givet kladden et rigtigt nummer.
      expect(isDraftInvoiceNumber(row.invoiceNumber)).toBe(true);
      expect(billed).toHaveLength(0);
    });
  },
);
