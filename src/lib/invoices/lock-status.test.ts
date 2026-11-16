import { TRPCError } from "@trpc/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { lockInvoiceStatus } from "./lock-status";

const dialect = new PgDialect();

// Fake tx der optager forespørgslen, så testen kan se FOR UPDATE og WHERE.
function fakeTx(row: { id: string; invoiceNumber: string; status: string }[]) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const builder = {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-SQL i testen
    where: (w: any) => {
      const q = dialect.sqlToQuery(w);
      seen.push({ sql: q.sql, params: q.params });
      return builder;
    },
    for: async (strength: string) => {
      seen.push({ sql: `FOR ${strength.toUpperCase()}`, params: [] });
      return row;
    },
  };
  const tx = { select: () => ({ from: () => builder }) };
  return { tx, seen };
}

describe("lockInvoiceStatus", () => {
  it("låser rækken (FOR UPDATE) og returnerer den låste faktura", async () => {
    const { tx, seen } = fakeTx([
      { id: "inv-1", invoiceNumber: "UDKAST-X", status: "draft" },
    ]);

    const locked = await lockInvoiceStatus(tx, "inv-1", "draft");

    expect(locked.invoiceNumber).toBe("UDKAST-X");
    expect(seen.map((s) => s.sql)).toContain("FOR UPDATE");
    expect(seen[0].params).toContain("inv-1");
  });

  it("afviser med CONFLICT når statussen er ændret siden valideringen", async () => {
    // Kladden blev udstedt (sendt) mellem læsning og sletning: sletningen må
    // hverken frigive de fakturerede tidsposter eller markere den slettet.
    const { tx } = fakeTx([
      { id: "inv-1", invoiceNumber: "INV-007", status: "sent" },
    ]);

    const err = await lockInvoiceStatus(tx, "inv-1", "draft").catch((e) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("CONFLICT");
  });

  it("melder NOT_FOUND når fakturaen er væk", async () => {
    const { tx } = fakeTx([]);

    const err = await lockInvoiceStatus(tx, "inv-1", "draft").catch((e) => e);

    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
});
