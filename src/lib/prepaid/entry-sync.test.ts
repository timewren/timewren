import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

import {
  applySegmentHours,
  insertRecurringTimeEntry,
  reconcilePrepaidAfterEdit,
  refundPrepaidForDeletion,
  sortForPackageLock,
  withPrepaidSavepoint,
} from "./entry-sync";

const CLIENT_A = "client-a";
const CLIENT_B = "client-b";

/** Minimal tx: logger delete-kald og kører savepoints/transaktioner inline. */
function fakeTx() {
  const log: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const tx = {
    log,
    inserted,
    delete: (_table: unknown) => ({
      where: async (_cond: unknown) => {
        log.push("delete-usage");
      },
    }),
    updates: [] as Record<string, unknown>[],
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (_cond: unknown) => {
          tx.updates.push(values);
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          returning: async () => [{ id: "entry-new", ...values }],
        };
      },
    }),
    async transaction<T>(fn: (inner: unknown) => Promise<T>): Promise<T> {
      log.push("transaction");
      try {
        return await fn(tx);
      } catch (error) {
        log.push("rollback");
        throw error;
      }
    },
  };
  return tx;
}

const prepaidEntry = {
  id: "entry-1",
  isPrepaid: true,
  prepaidPackageId: "pkg-a",
  hours: 1,
  clientId: CLIENT_A,
  projectId: null,
};

const okDeduct = () =>
  vi.fn(async (..._args: unknown[]) => ({
    packageName: "Kort A",
    remainingHours: 4,
    hoursDeducted: 1.5,
    overflowedToInvoice: false,
  }));

describe("reconcilePrepaidAfterEdit", () => {
  it("nye timer på samme kunde: reversér og træk det nye timetal", async () => {
    const tx = fakeTx();
    const reverse = vi.fn(async (..._args: unknown[]) => 1);
    const deduct = okDeduct();
    const result = await reconcilePrepaidAfterEdit(
      tx as never,
      {
        userId: "u",
        orgId: "org",
        entry: prepaidEntry,
        oldClient: { clientId: CLIENT_A, projectClientId: null },
        newClient: { clientId: CLIENT_A, projectClientId: null },
        newHours: 2.5,
      },
      { reverse, deduct } as never,
    );
    expect(reverse).toHaveBeenCalledWith(tx, "entry-1", "pkg-a");
    expect(deduct).toHaveBeenCalledWith(
      tx,
      "u",
      "org",
      expect.objectContaining({
        packageId: "pkg-a",
        hours: 2.5,
        timeEntryId: "entry-1",
        allowInactive: false,
      }),
    );
    expect(result.patch).toEqual({
      isPrepaid: true,
      prepaidPackageId: "pkg-a",
    });
  });

  it("nedskrivning må ikke blokeres af et udløbet kort (allowInactive)", async () => {
    const tx = fakeTx();
    const deduct = okDeduct();
    await reconcilePrepaidAfterEdit(
      tx as never,
      {
        userId: "u",
        orgId: null,
        entry: prepaidEntry,
        oldClient: { clientId: CLIENT_A, projectClientId: null },
        newClient: { clientId: CLIENT_A, projectClientId: null },
        newHours: 0.5,
      },
      { reverse: vi.fn(), deduct } as never,
    );
    expect(deduct).toHaveBeenCalledWith(
      tx,
      "u",
      null,
      expect.objectContaining({ allowInactive: true }),
    );
  });

  it("kundeskift: trækket gives tilbage og posten bliver almindelig tid", async () => {
    const tx = fakeTx();
    const reverse = vi.fn(async (..._args: unknown[]) => 1);
    const deduct = okDeduct();
    const result = await reconcilePrepaidAfterEdit(
      tx as never,
      {
        userId: "u",
        orgId: null,
        entry: prepaidEntry,
        oldClient: { clientId: CLIENT_A, projectClientId: null },
        newClient: { clientId: null, projectClientId: CLIENT_B },
        newHours: 1,
      },
      { reverse, deduct } as never,
    );
    expect(reverse).toHaveBeenCalledWith(tx, "entry-1", "pkg-a");
    expect(deduct).not.toHaveBeenCalled();
    expect(result.patch).toEqual({ isPrepaid: false, prepaidPackageId: null });
  });

  it("samme effektive kunde og samme timer: rører ikke kortet", async () => {
    const reverse = vi.fn();
    const deduct = vi.fn();
    const result = await reconcilePrepaidAfterEdit(
      fakeTx() as never,
      {
        userId: "u",
        orgId: null,
        entry: prepaidEntry,
        oldClient: { clientId: CLIENT_A, projectClientId: CLIENT_A },
        newClient: { clientId: null, projectClientId: CLIENT_A },
        newHours: 1,
      },
      { reverse, deduct } as never,
    );
    expect(reverse).not.toHaveBeenCalled();
    expect(deduct).not.toHaveBeenCalled();
    expect(result.patch).toBeNull();
  });

  it("ikke-prepaid post: intet sker", async () => {
    const reverse = vi.fn();
    const deduct = vi.fn();
    const result = await reconcilePrepaidAfterEdit(
      fakeTx() as never,
      {
        userId: "u",
        orgId: null,
        entry: { id: "e", isPrepaid: false, prepaidPackageId: null, hours: 1 },
        oldClient: { clientId: CLIENT_A, projectClientId: null },
        newClient: { clientId: CLIENT_B, projectClientId: null },
        newHours: 3,
      },
      { reverse, deduct } as never,
    );
    expect(reverse).not.toHaveBeenCalled();
    expect(deduct).not.toHaveBeenCalled();
    expect(result.patch).toBeNull();
  });

  it("invoice-overløb: posten forbliver fakturerbar uden kort", async () => {
    const deduct = vi.fn(async () => ({
      packageName: "Kort A",
      remainingHours: 0,
      hoursDeducted: 0,
      overflowedToInvoice: true,
    }));
    const result = await reconcilePrepaidAfterEdit(
      fakeTx() as never,
      {
        userId: "u",
        orgId: null,
        entry: prepaidEntry,
        oldClient: { clientId: CLIENT_A, projectClientId: null },
        newClient: { clientId: CLIENT_A, projectClientId: null },
        newHours: 9,
      },
      { reverse: vi.fn(), deduct } as never,
    );
    expect(result.patch).toEqual({ isPrepaid: false, prepaidPackageId: null });
  });
});

describe("refundPrepaidForDeletion", () => {
  it("reverserer hver prepaid-post via den fælles reversal og sletter usage-rækker", async () => {
    const tx = fakeTx();
    const reverse = vi.fn(async (..._args: unknown[]) => 1);
    await refundPrepaidForDeletion(
      tx as never,
      [
        { id: "e2", isPrepaid: true, prepaidPackageId: "pkg-b" },
        { id: "e1", isPrepaid: true, prepaidPackageId: "pkg-a" },
        { id: "e3", isPrepaid: false, prepaidPackageId: null },
      ],
      { reverse } as never,
    );
    // Deterministisk låserækkefølge (pakke-id) mod deadlocks i bulk
    expect(reverse.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["e1", "pkg-a"],
      ["e2", "pkg-b"],
    ]);
    // Også efterladte usage-rækker på ikke-prepaid poster ryddes (FK uden
    // ON DELETE i prod)
    expect(tx.log).toContain("delete-usage");
  });

  it("ingen poster: ingen kald", async () => {
    const tx = fakeTx();
    const reverse = vi.fn();
    await refundPrepaidForDeletion(tx as never, [], { reverse } as never);
    expect(reverse).not.toHaveBeenCalled();
    expect(tx.log).toEqual([]);
  });
});

describe("insertRecurringTimeEntry", () => {
  const base = {
    userId: "u",
    organizationId: null,
    projectId: null,
    clientId: CLIENT_A,
    description: "Fast opgave",
    hours: "1.00",
    date: new Date("2026-10-02T00:00:00Z"),
  };

  it("indsætter posten som almindelig tid; kun et lykket træk gør den prepaid", async () => {
    const db = fakeTx();
    const deduct = okDeduct();
    const result = await insertRecurringTimeEntry(
      db as never,
      { values: base, prepaid: { packageId: "pkg-a", hours: 1 } },
      { deduct } as never,
    );
    expect(db.inserted[0]).toMatchObject({
      isPrepaid: false,
      prepaidPackageId: null,
    });
    expect(deduct).toHaveBeenCalledWith(
      db,
      "u",
      null,
      expect.objectContaining({ packageId: "pkg-a", timeEntryId: "entry-new" }),
    );
    expect(result.deduction).not.toBeNull();
  });

  it("fejlet træk (tomt blok-kort) efterlader en fakturerbar post, ikke en spøgelses-prepaid", async () => {
    const db = fakeTx();
    const deduct = vi.fn(async () => {
      throw new Error("Ikke nok timer tilbage på klippekortet");
    });
    const result = await insertRecurringTimeEntry(
      db as never,
      { values: base, prepaid: { packageId: "pkg-a", hours: 1 } },
      { deduct } as never,
    );
    expect(db.inserted[0]).toMatchObject({
      isPrepaid: false,
      prepaidPackageId: null,
    });
    expect(result.entry.id).toBe("entry-new");
    expect(result.deduction).toBeNull();
    expect(result.deductionError).toBeInstanceOf(Error);
  });
});

describe("applySegmentHours (A1 P2-1)", () => {
  it("nyt segment på en klippekort-post trækker de ekstra timer på kortet", async () => {
    const tx = fakeTx();
    const reverse = vi.fn(async (..._args: unknown[]) => 1);
    const deduct = okDeduct();
    await applySegmentHours(
      tx as never,
      { userId: "u", orgId: null, entry: prepaidEntry, newHours: 1.5 },
      { reverse, deduct } as never,
    );
    expect(reverse).toHaveBeenCalledWith(tx, "entry-1", "pkg-a");
    expect(deduct).toHaveBeenCalledWith(
      tx,
      "u",
      null,
      expect.objectContaining({ packageId: "pkg-a", hours: 1.5 }),
    );
    expect(tx.updates[0]).toMatchObject({
      hours: "1.50",
      isPrepaid: true,
      prepaidPackageId: "pkg-a",
    });
  });

  it("uændret sum rører ikke kortet", async () => {
    const tx = fakeTx();
    const reverse = vi.fn();
    const deduct = vi.fn();
    await applySegmentHours(
      tx as never,
      { userId: "u", orgId: null, entry: prepaidEntry, newHours: 1 },
      { reverse, deduct } as never,
    );
    expect(reverse).not.toHaveBeenCalled();
    expect(deduct).not.toHaveBeenCalled();
    expect(tx.updates[0]).toEqual({ hours: "1.00" });
  });

  it("almindelig post: kun timerne skrives", async () => {
    const tx = fakeTx();
    const deduct = vi.fn();
    await applySegmentHours(
      tx as never,
      {
        userId: "u",
        orgId: null,
        entry: {
          id: "e",
          isPrepaid: false,
          prepaidPackageId: null,
          hours: 1,
          clientId: null,
          projectId: null,
        },
        newHours: 0.5,
      },
      { reverse: vi.fn(), deduct } as never,
    );
    expect(deduct).not.toHaveBeenCalled();
    expect(tx.updates[0]).toEqual({ hours: "0.50" });
  });
});

describe("applySegmentHours — timer-stop må aldrig fejle på kortet (review P1)", () => {
  it("neverFail: blok-kort uden saldo ruller kun savepointet tilbage; timerne skrives og det oprindelige træk bevares", async () => {
    const tx = fakeTx();
    const reverse = vi.fn(async (..._args: unknown[]) => 1);
    const deduct = vi.fn(async () => {
      throw new Error("Ikke nok timer tilbage på klippekortet");
    });
    await applySegmentHours(
      tx as never,
      {
        userId: "u",
        orgId: null,
        entry: prepaidEntry,
        newHours: 1.5,
        neverFail: true,
      },
      { reverse, deduct } as never,
    );
    expect(tx.log).toEqual(["transaction", "rollback"]);
    // Ingen prepaid-patch: posten står stadig på kortet med det gamle træk
    expect(tx.updates[0]).toEqual({ hours: "1.50" });
  });

  it("uden neverFail (ret/slet segment) afvises gemningen som i time.update", async () => {
    const tx = fakeTx();
    const deduct = vi.fn(async () => {
      throw new Error("Ikke nok timer tilbage på klippekortet");
    });
    await expect(
      applySegmentHours(
        tx as never,
        { userId: "u", orgId: null, entry: prepaidEntry, newHours: 1.5 },
        { reverse: vi.fn(), deduct } as never,
      ),
    ).rejects.toThrow("Ikke nok timer");
    expect(tx.updates).toEqual([]);
  });
});

describe("withPrepaidSavepoint", () => {
  it("returnerer resultatet ved succes", async () => {
    const tx = fakeTx();
    const result = await withPrepaidSavepoint(
      tx as never,
      async () => 42,
      "test",
    );
    expect(result).toBe(42);
  });

  it("sluger fejlen og returnerer null efter rollback af savepointet", async () => {
    const tx = fakeTx();
    const result = await withPrepaidSavepoint(
      tx as never,
      async () => {
        throw new Error("Klippekortet er udløbet");
      },
      "test",
    );
    expect(result).toBeNull();
    expect(tx.log).toEqual(["transaction", "rollback"]);
  });
});

describe("sortForPackageLock (review P3)", () => {
  it("sorterer på pakke-id og derefter post-id, uden at ændre input", () => {
    const input = [
      { id: "e3", prepaidPackageId: "pkg-b" },
      { id: "e2", prepaidPackageId: "pkg-a" },
      { id: "e1", prepaidPackageId: "pkg-b" },
    ];
    expect(sortForPackageLock(input).map((e) => e.id)).toEqual([
      "e2",
      "e1",
      "e3",
    ]);
    expect(input.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });
});
