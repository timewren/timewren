import { describe, expect, it } from "vitest";
import { calculateNextDue, nextRecurringDateStr } from "../recurring-next-due";

describe("nextRecurringDateStr (#734)", () => {
  const today = "2026-10-01"; // torsdag

  it("daglig: i morgen", () => {
    expect(nextRecurringDateStr("daily", today, today)).toBe("2026-10-02");
  });

  it("ugentlig med ugedag: næste forekomst af ugedagen efter i dag", () => {
    expect(nextRecurringDateStr("weekly", today, today, 1)).toBe("2026-10-05");
    // Samme ugedag som i dag → om en uge
    expect(nextRecurringDateStr("weekly", today, today, 4)).toBe("2026-10-08");
    expect(nextRecurringDateStr("weekly", today, today, 0)).toBe("2026-10-04");
  });

  it("ugentlig uden ugedag: +7 dage", () => {
    expect(nextRecurringDateStr("weekly", today, today)).toBe("2026-10-08");
  });

  it("månedlig med dag: klemmes til korte måneder", () => {
    expect(
      nextRecurringDateStr("monthly", "2026-01-31", "2026-01-31", null, 31),
    ).toBe("2026-02-28");
    expect(nextRecurringDateStr("monthly", today, today, null, 15)).toBe(
      "2026-11-15",
    );
  });

  it("månedlig uden dag: fra startdatoen, uden at dagen glider", () => {
    expect(nextRecurringDateStr("monthly", "2026-01-31", "2026-03-05")).toBe(
      "2026-03-31",
    );
  });

  it("startdato i fremtiden bruges som den er", () => {
    expect(nextRecurringDateStr("daily", "2026-10-10", today)).toBe(
      "2026-10-10",
    );
    expect(nextRecurringDateStr("weekly", "2026-10-10", today, 1)).toBe(
      "2026-10-12",
    );
  });

  it("startdato i fortiden rulles frem forbi i dag", () => {
    expect(nextRecurringDateStr("weekly", "2026-09-01", today)).toBe(
      "2026-10-06",
    );
  });

  it("ukendt frekvens: +1 dag", () => {
    expect(nextRecurringDateStr("yearly", today, today)).toBe("2026-10-02");
  });
});

describe("calculateNextDue", () => {
  it("bruger dansk dato mellem kl. 00 og 02 og returnerer dansk midnat", () => {
    // Torsdag 1/10 kl. 00:30 dansk = onsdag 30/9 22:30Z
    const now = new Date("2026-09-30T22:30:00Z");
    const next = calculateNextDue("daily", now, null, null, now);
    expect(next.toISOString()).toBe("2026-10-01T22:00:00.000Z"); // 2/10 00:00 dansk
  });

  it("ugentlig mandag over skift til vintertid", () => {
    const now = new Date("2026-10-22T10:00:00Z"); // torsdag 22/10
    const next = calculateNextDue("weekly", now, 1, null, now);
    expect(next.toISOString()).toBe("2026-10-25T23:00:00.000Z"); // mandag 26/10 00:00 dansk
  });

  it("startdato gemt som UTC-midnat giver samme danske dato", () => {
    const now = new Date("2026-10-01T08:00:00Z");
    const next = calculateNextDue(
      "monthly",
      new Date("2026-10-20T00:00:00Z"),
      null,
      20,
      now,
    );
    expect(next.toISOString()).toBe("2026-10-19T22:00:00.000Z");
  });
});
