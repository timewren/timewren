import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

import { reconcileMergedPrepaid } from "../same-session-merge";

/**
 * Savepoint-semantik som drizzle: kaster callbacken, rulles KUN savepointet
 * tilbage, og fejlen bobler op til kalderen.
 */
function fakeTx() {
  const log: string[] = [];
  const tx = {
    log,
    async transaction<T>(fn: (sp: unknown) => Promise<T>): Promise<T> {
      log.push("savepoint");
      try {
        return await fn(tx);
      } catch (error) {
        log.push("rollback-to-savepoint");
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
  clientId: "client-a",
  projectId: null,
};

const makeDeduct = () =>
  vi.fn(async (..._args: unknown[]) => ({
    packageName: "Kort A",
    remainingHours: 4,
    hoursDeducted: 1.5,
    overflowedToInvoice: false,
  }));

describe("reconcileMergedPrepaid", () => {
  it("samme kort: reversér og træk det nye timetal i et savepoint", async () => {
    const tx = fakeTx();
    const reverse = vi.fn(async (..._args: unknown[]) => 1);
    const okDeduct = makeDeduct();
    const result = await reconcileMergedPrepaid(
      tx as never,
      {
        userId: "u",
        orgId: null,
        existing: prepaidEntry,
        newHours: 1.5,
        hoursChanged: true,
        prepaidPackageId: null,
        prepaidHoursOverride: undefined,
        incomingClientId: "client-a",
      },
      { reverse, deduct: okDeduct } as never,
    );
    expect(tx.log).toEqual(["savepoint"]);
    expect(reverse).toHaveBeenCalledWith(tx, "entry-1", "pkg-a");
    expect(okDeduct).toHaveBeenLastCalledWith(
      tx,
      "u",
      null,
      expect.objectContaining({
        packageId: "pkg-a",
        hours: 1.5,
        // Re-deduktion på samme kort skal stadig sende postens egen kunde
        // til deductHoursCores kunde-tjek (CodeRabbit, PR #858) — ikke
        // undefined, selv om pakken allerede sad på posten.
        clientId: "client-a",
      }),
    );
    expect(result.patch).toEqual({
      isPrepaid: true,
      prepaidPackageId: "pkg-a",
    });
  });

  it("blok-kort uden saldo vælter ALDRIG stoppet: savepointet rulles tilbage og det oprindelige træk bevares", async () => {
    const tx = fakeTx();
    const reverse = vi.fn(async (..._args: unknown[]) => 1);
    const deduct = vi.fn(async (..._args: unknown[]) => {
      throw new Error("Ikke nok timer på klippekortet");
    });
    const result = await reconcileMergedPrepaid(
      tx as never,
      {
        userId: "u",
        orgId: null,
        existing: prepaidEntry,
        newHours: 3,
        hoursChanged: true,
        prepaidPackageId: null,
        prepaidHoursOverride: undefined,
        incomingClientId: "client-a",
      },
      { reverse, deduct } as never,
    );
    expect(tx.log).toEqual(["savepoint", "rollback-to-savepoint"]);
    // Ingen ændring af postens kort-felter: det oprindelige træk står.
    expect(result).toEqual({ patch: null, deduction: null });
  });

  it("brugerens valgte klippekort-timer (prepaidHoursOverride) bruges som trækket", async () => {
    const tx = fakeTx();
    const deduct = makeDeduct();
    await reconcileMergedPrepaid(
      tx as never,
      {
        userId: "u",
        orgId: null,
        existing: { ...prepaidEntry, isPrepaid: false, prepaidPackageId: null },
        newHours: 1.5,
        hoursChanged: true,
        prepaidPackageId: "pkg-a",
        prepaidHoursOverride: 1,
        incomingClientId: "client-a",
      },
      { reverse: vi.fn(), deduct } as never,
    );
    expect(deduct).toHaveBeenLastCalledWith(
      tx,
      "u",
      null,
      expect.objectContaining({
        packageId: "pkg-a",
        hours: 1,
        clientId: "client-a",
      }),
    );
  });

  it("uændret timetal på kort-posten: intet træk", async () => {
    const tx = fakeTx();
    const deduct = makeDeduct();
    const result = await reconcileMergedPrepaid(
      tx as never,
      {
        userId: "u",
        orgId: null,
        existing: prepaidEntry,
        newHours: 1.5,
        hoursChanged: false,
        prepaidPackageId: "pkg-a",
        prepaidHoursOverride: undefined,
        incomingClientId: "client-a",
      },
      { reverse: vi.fn(), deduct } as never,
    );
    expect(deduct).not.toHaveBeenCalled();
    expect(result).toEqual({ patch: null, deduction: null });
  });
});
