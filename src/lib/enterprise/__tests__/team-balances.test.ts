import { describe, expect, it } from "vitest";
import { type AggregateInput, aggregateTeamBalances } from "../team-balances";

const base = (over: Partial<AggregateInput> = {}): AggregateInput => ({
  userIds: ["anna", "bo"],
  vacationLedgerRows: [],
  flexDeltaByUser: new Map(),
  earnedOvertimeByUser: new Map(),
  overtimeByUser: new Map(),
  overtimeEnabled: false,
  ...over,
});

describe("aggregateTeamBalances", () => {
  it("returnerer en række pr. bruger — også uden data", () => {
    const out = aggregateTeamBalances(base());
    expect(Object.keys(out).sort()).toEqual(["anna", "bo"]);
    expect(out.anna).toEqual({
      vacation: null,
      extraDays: null,
      flexHours: 0,
      overtimeHours: null,
    });
  });

  it("projicerer ferie og feriefridage fra ledger-summer pr. bruger", () => {
    const out = aggregateTeamBalances(
      base({
        vacationLedgerRows: [
          { userId: "anna", pool: "vacation", entryType: "earned", days: "25" },
          { userId: "anna", pool: "vacation", entryType: "used", days: "7.5" },
          {
            userId: "anna",
            pool: "vacation",
            entryType: "reversed",
            days: "1",
          },
          { userId: "anna", pool: "extra", entryType: "earned", days: "5" },
          { userId: "anna", pool: "extra", entryType: "used", days: 2 },
          // Bo har kun feriefridage — ferie-puljen er tom men ikke null
          { userId: "bo", pool: "extra", entryType: "earned", days: "5" },
        ],
      }),
    );
    expect(out.anna.vacation).toEqual({
      earned: 25,
      used: 6.5,
      remaining: 18.5,
    });
    expect(out.anna.extraDays).toEqual({ earned: 5, used: 2, remaining: 3 });
    expect(out.bo.vacation).toEqual({ earned: 0, used: 0, remaining: 0 });
    expect(out.bo.extraDays?.remaining).toBe(5);
  });

  it("flex = sum af deltaer minus optjent overtid (som Flex-siden)", () => {
    const out = aggregateTeamBalances(
      base({
        flexDeltaByUser: new Map([
          ["anna", 12.345],
          ["bo", -3.2],
        ]),
        earnedOvertimeByUser: new Map([["anna", 4]]),
      }),
    );
    expect(out.anna.flexHours).toBe(8.35);
    expect(out.bo.flexHours).toBe(-3.2);
  });

  it("afspadsering skjules (null) når overtid ikke er slået til og saldo er 0", () => {
    const out = aggregateTeamBalances(
      base({
        overtimeByUser: new Map([["bo", 2.5]]),
        overtimeEnabled: false,
      }),
    );
    expect(out.anna.overtimeHours).toBeNull();
    expect(out.bo.overtimeHours).toBe(2.5);
  });

  it("afspadsering vises som 0 når org'en har overtid slået til", () => {
    const out = aggregateTeamBalances(base({ overtimeEnabled: true }));
    expect(out.anna.overtimeHours).toBe(0);
  });

  it("ignorerer ledger-rækker for brugere uden for holdet", () => {
    const out = aggregateTeamBalances(
      base({
        vacationLedgerRows: [
          { userId: "zed", pool: "vacation", entryType: "earned", days: "25" },
        ],
      }),
    );
    expect(out.zed).toBeUndefined();
    expect(out.anna.vacation).toBeNull();
  });
});
