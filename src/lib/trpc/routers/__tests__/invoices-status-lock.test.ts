import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * update/transition/delete validerer statussen på en læsning uden for
 * transaktionen. Testene her beviser, at alle tre mutationer tager
 * rækkelåsen (lockInvoiceStatus) i den skrivende transaktion, før de skriver,
 * og at intet skrives når låsen melder, at statussen er skiftet (#1110).
 */

const lock = vi.hoisted(() => ({
  mode: "ok" as "ok" | "conflict",
  calls: [] as { tx: unknown; id: string; expected: string | null }[],
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/invoices/lock-status", () => ({
  lockInvoiceStatus: vi.fn(
    async (tx: unknown, id: string, expected: string | null) => {
      lock.calls.push({ tx, id, expected });
      if (lock.mode === "conflict") {
        throw new TRPCError({ code: "CONFLICT", message: "status skiftet" });
      }
      return { id, invoiceNumber: "INV-007", status: expected };
    },
  ),
}));

import { invoicesRouter } from "@/lib/trpc/routers/invoices";
import { router } from "@/lib/trpc/trpc";

const USER_ID = "user-invoice-lock";
const INVOICE_ID = "55555555-5555-4555-8555-555555555555";

function invoiceRow(status: string) {
  return {
    id: INVOICE_ID,
    userId: USER_ID,
    organizationId: "lock-org",
    clientId: null,
    invoiceNumber: status === "draft" ? "UDKAST-1" : "INV-007",
    status,
    amount: "1000.00",
    paidDate: null,
    notes: null,
  };
}

function withEmptyTables<T extends object>(known: T): T {
  return new Proxy(known, {
    get(target, key) {
      if (key in target) return target[key as keyof T];
      return {
        findFirst: async () => undefined,
        findMany: async () => [],
      };
    },
  });
}

function makeDb(status: string) {
  const tx = {
    update: vi.fn(() => {
      return {
        set: (values: Record<string, unknown>) => ({
          where: () =>
            Object.assign(Promise.resolve(undefined), {
              returning: async () => [{ ...invoiceRow(status), ...values }],
            }),
        }),
      };
    }),
  };
  const forbiddenWrite = () => {
    throw new Error("skrivning uden for transaktionen");
  };
  const db = {
    query: withEmptyTables({
      users: { findFirst: async () => ({ role: "admin" }) },
      sessions: { findFirst: async () => undefined },
      members: {
        findFirst: async () => ({
          id: "lock-member",
          organizationId: "lock-org",
          userId: USER_ID,
          role: "owner",
        }),
      },
      organizationModules: { findMany: async () => [] },
      invoices: { findFirst: async () => invoiceRow(status) },
    }),
    update: vi.fn(forbiddenWrite),
    insert: vi.fn(forbiddenWrite),
    delete: vi.fn(forbiddenWrite),
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx };
}

const testRouter = router({ invoices: invoicesRouter });

function caller(db: unknown) {
  return testRouter.createCaller({
    session: { user: { id: USER_ID, email: "lock@example.com" } },
    db,
    headers: null,
  } as never).invoices;
}

async function expectConflict(p: Promise<unknown>) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe("CONFLICT");
}

describe("fakturamutationer låser rækken før statusskift (#1110)", () => {
  beforeEach(() => {
    lock.mode = "ok";
    lock.calls.length = 0;
  });

  it("delete låser kladden i transaktionen før tidsposterne frigives", async () => {
    const { db, tx } = makeDb("draft");
    tx.update.mockImplementationOnce(() => {
      // Første skrivning må først ske efter låsen.
      expect(lock.calls).toHaveLength(1);
      return {
        set: () => ({ where: () => Promise.resolve(undefined) }),
      } as never;
    });

    await caller(db).delete({ id: INVOICE_ID });

    expect(lock.calls).toEqual([{ tx, id: INVOICE_ID, expected: "draft" }]);
  });

  it("delete skriver intet når kladden er udstedt i mellemtiden", async () => {
    lock.mode = "conflict";
    const { db, tx } = makeDb("draft");

    await expectConflict(caller(db).delete({ id: INVOICE_ID }));

    expect(lock.calls).toHaveLength(1);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("transition låser rækken med den validerede status", async () => {
    const { db, tx } = makeDb("sent");

    await caller(db).transition({ id: INVOICE_ID, newStatus: "overdue" });

    expect(lock.calls).toEqual([{ tx, id: INVOICE_ID, expected: "sent" }]);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("transition til deleted frigiver ikke tidsposter ved statuskonflikt", async () => {
    lock.mode = "conflict";
    const { db, tx } = makeDb("draft");

    await expectConflict(
      caller(db).transition({ id: INVOICE_ID, newStatus: "deleted" }),
    );

    expect(lock.calls).toHaveLength(1);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("update låser rækken med den validerede status", async () => {
    const { db, tx } = makeDb("sent");

    await caller(db).update({ id: INVOICE_ID, status: "overdue" });

    expect(lock.calls).toEqual([{ tx, id: INVOICE_ID, expected: "sent" }]);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("update skriver intet ved statuskonflikt", async () => {
    lock.mode = "conflict";
    const { db, tx } = makeDb("sent");

    await expectConflict(
      caller(db).update({ id: INVOICE_ID, status: "overdue" }),
    );

    expect(tx.update).not.toHaveBeenCalled();
  });
});
