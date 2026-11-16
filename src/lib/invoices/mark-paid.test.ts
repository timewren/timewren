import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/webhooks/events", () => ({
  emitWebhookEvent: (p: Record<string, unknown>) => emitted.push(p),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { markInvoicePaid } from "./mark-paid";

const dialect = new PgDialect();

type Row = {
  id: string;
  userId: string;
  organizationId: string | null;
  clientId: string;
  status: string | null;
  paidDate: Date | null;
};

// Minimal db: UPDATE rammer rækken når id og status-vagterne i WHERE holder
// (status <> 'paid' og status = forventet), ligesom Postgres ville.
function fakeDb(rows: Row[]) {
  const updates: { set: Record<string, unknown>; sql: string }[] = [];
  const db = {
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: async () => {
            const q = dialect.sqlToQuery(where);
            updates.push({ set, sql: q.sql });
            const guarded = /"status" <> \$\d/.test(q.sql);
            const expected = /"status" = \$(\d)/.exec(q.sql);
            const wantsNull = /"status" is null/.test(q.sql);
            const hit = rows.filter(
              (r) =>
                q.params.includes(r.id) &&
                (!guarded || (r.status !== null && r.status !== "paid")) &&
                (!wantsNull || r.status === null) &&
                (!expected || r.status === q.params[Number(expected[1]) - 1]),
            );
            for (const r of hit) Object.assign(r, set);
            return hit.map((r) => ({ ...r }));
          },
        }),
      }),
    }),
  };
  return {
    db: db as unknown as Parameters<typeof markInvoicePaid>[0],
    updates,
  };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "inv-1",
  userId: "user-1",
  organizationId: "org-1",
  clientId: "client-1",
  status: "sent",
  paidDate: null,
  ...over,
});

describe("markInvoicePaid", () => {
  beforeEach(() => {
    emitted.length = 0;
  });

  it("markerer fakturaen betalt og sender invoice.paid", async () => {
    const r = row({ status: "overdue" });
    const { db } = fakeDb([r]);
    const paidDate = new Date("2026-11-01T00:00:00Z");

    const updated = await markInvoicePaid(db, {
      invoiceId: "inv-1",
      paidDate,
      previousStatus: "overdue",
    });

    expect(updated?.status).toBe("paid");
    expect(r.paidDate).toEqual(paidDate);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      userId: "user-1",
      orgId: "org-1",
      eventType: "invoice.paid",
      eventId: "inv-1",
      clientId: "client-1",
      data: { previousStatus: "overdue" },
    });
  });

  it("sender ikke igen når fakturaen allerede er betalt (sync + webhook samtidig)", async () => {
    const r = row({ status: "paid" });
    const { db } = fakeDb([r]);

    const updated = await markInvoicePaid(db, {
      invoiceId: "inv-1",
      paidDate: new Date(),
      previousStatus: "sent",
    });

    expect(updated).toBeNull();
    expect(emitted).toHaveLength(0);
  });

  it("bruger fakturaens ejer og org, ikke kalderens", async () => {
    const r = row({ userId: "owner-2", organizationId: null });
    const { db } = fakeDb([r]);

    await markInvoicePaid(db, {
      invoiceId: "inv-1",
      paidDate: new Date(),
      previousStatus: "sent",
    });

    expect(emitted[0]).toMatchObject({ userId: "owner-2", orgId: null });
  });

  it("rører ikke en faktura hvis status er skiftet siden læsningen", async () => {
    // Cron læste "sent", men brugeren slettede fakturaen mens regnskabs-
    // kaldet kørte: den må hverken blive betalt eller annonceres.
    const r = row({ status: "deleted" });
    const { db } = fakeDb([r]);

    const updated = await markInvoicePaid(db, {
      invoiceId: "inv-1",
      paidDate: new Date(),
      previousStatus: "sent",
    });

    expect(updated).toBeNull();
    expect(r.status).toBe("deleted");
    expect(emitted).toHaveLength(0);
  });

  it("markerer en faktura uden status (NULL) betalt", async () => {
    const r = row({ status: null });
    const { db } = fakeDb([r]);

    const updated = await markInvoicePaid(db, {
      invoiceId: "inv-1",
      paidDate: new Date(),
      previousStatus: null,
    });

    expect(updated?.status).toBe("paid");
    expect(emitted).toHaveLength(1);
  });
});
