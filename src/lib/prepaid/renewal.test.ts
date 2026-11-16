import { describe, expect, it } from "vitest";
import { calcRenewal, computeNextRenewal } from "./renewal";

// Fornyelsesdatoen er den danske kalenderdag gemt som UTC-midnat (samme
// konvention som expiry_date og time_entries.date). Testene køres både
// under TZ=UTC og TZ=Europe/Copenhagen i CI (#758).
const iso = (d: Date) => d.toISOString();

describe("computeNextRenewal", () => {
  it("lægger en måned til", () => {
    expect(
      iso(computeNextRenewal(new Date("2026-01-15T00:00:00Z"), "monthly")),
    ).toBe("2026-02-15T00:00:00.000Z");
  });
  it("lægger et kvartal til", () => {
    expect(
      iso(computeNextRenewal(new Date("2026-01-15T00:00:00Z"), "quarterly")),
    ).toBe("2026-04-15T00:00:00.000Z");
  });
  it("lægger et år til", () => {
    expect(
      iso(computeNextRenewal(new Date("2026-01-15T00:00:00Z"), "yearly")),
    ).toBe("2027-01-15T00:00:00.000Z");
  });

  it("klemmer den 31. til månedens sidste dag", () => {
    const jan31 = new Date("2026-01-31T00:00:00Z");
    expect(iso(computeNextRenewal(jan31, "monthly"))).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(
      iso(computeNextRenewal(new Date("2026-03-31T00:00:00Z"), "monthly")),
    ).toBe("2026-04-30T00:00:00.000Z");
    expect(
      iso(computeNextRenewal(new Date("2026-08-31T00:00:00Z"), "quarterly")),
    ).toBe("2026-11-30T00:00:00.000Z");
    expect(
      iso(computeNextRenewal(new Date("2028-02-29T00:00:00Z"), "yearly")),
    ).toBe("2029-02-28T00:00:00.000Z");
  });

  it("krydser års- og månedsskifte", () => {
    expect(
      iso(computeNextRenewal(new Date("2026-12-15T00:00:00Z"), "monthly")),
    ).toBe("2027-01-15T00:00:00.000Z");
    expect(
      iso(computeNextRenewal(new Date("2026-11-30T00:00:00Z"), "quarterly")),
    ).toBe("2027-02-28T00:00:00.000Z");
  });

  it("krydser skiftet til sommertid og vintertid uden at forskyde dagen", () => {
    // Vintertid → sommertid (29/3-2026)
    expect(
      iso(computeNextRenewal(new Date("2026-03-15T00:00:00Z"), "monthly")),
    ).toBe("2026-04-15T00:00:00.000Z");
    // Sommertid → vintertid (25/10-2026)
    expect(
      iso(computeNextRenewal(new Date("2026-10-15T00:00:00Z"), "monthly")),
    ).toBe("2026-11-15T00:00:00.000Z");
    expect(
      iso(computeNextRenewal(new Date("2026-09-01T00:00:00Z"), "quarterly")),
    ).toBe("2026-12-01T00:00:00.000Z");
  });

  it("bruger den danske dato for et tidspunkt (aktivering 'nu')", () => {
    // 1/10 23:30 dansk sommertid = 1/10 21:30Z → dansk dato 1/10
    expect(
      iso(computeNextRenewal(new Date("2026-10-01T21:30:00Z"), "monthly")),
    ).toBe("2026-11-01T00:00:00.000Z");
    // 1/10 00:30 dansk = 30/9 22:30Z → dansk dato 1/10
    expect(
      iso(computeNextRenewal(new Date("2026-09-30T22:30:00Z"), "monthly")),
    ).toBe("2026-11-01T00:00:00.000Z");
    // 31/12 23:30Z = 1/1-2027 00:30 dansk vintertid
    expect(
      iso(computeNextRenewal(new Date("2026-12-31T23:30:00Z"), "monthly")),
    ).toBe("2027-02-01T00:00:00.000Z");
  });

  it("kæden af fornyelser bliver på UTC-midnat", () => {
    let d = new Date("2026-01-10T00:00:00Z");
    for (let i = 0; i < 12; i++) d = computeNextRenewal(d, "monthly");
    expect(iso(d)).toBe("2027-01-10T00:00:00.000Z");
  });
});

describe("calcRenewal", () => {
  it("none: frisk periode på grundtimer", () => {
    const r = calcRenewal({
      baseHours: 10,
      oldRemaining: 4,
      oldOverdraft: 0,
      rollover: "none",
    });
    expect(r).toEqual({
      newTotalHours: 10,
      newRemainingHours: 10,
      settledOverdraft: 0,
      carriedHours: 0,
    });
  });

  it("carry: restklip overføres oveni grundtimerne", () => {
    const r = calcRenewal({
      baseHours: 10,
      oldRemaining: 4,
      oldOverdraft: 0,
      rollover: "carry",
    });
    expect(r.newTotalHours).toBe(14);
    expect(r.newRemainingHours).toBe(14);
    expect(r.carriedHours).toBe(4);
  });

  it("overtræk (#93) modregnes i den nye periode — også ved none", () => {
    const r = calcRenewal({
      baseHours: 10,
      oldRemaining: 0,
      oldOverdraft: 3,
      rollover: "none",
    });
    expect(r.newTotalHours).toBe(10);
    expect(r.newRemainingHours).toBe(7);
    expect(r.settledOverdraft).toBe(3);
  });

  it("overtræk større end ny periode: remaining bunder i 0", () => {
    const r = calcRenewal({
      baseHours: 5,
      oldRemaining: 0,
      oldOverdraft: 8,
      rollover: "none",
    });
    expect(r.newRemainingHours).toBe(0);
    expect(r.settledOverdraft).toBe(5);
  });

  it("carry + overtræk samtidigt (rest og gæld kan ikke begge være > 0 i praksis, men regnestykket skal være robust)", () => {
    const r = calcRenewal({
      baseHours: 10,
      oldRemaining: 2,
      oldOverdraft: 1,
      rollover: "carry",
    });
    expect(r.newTotalHours).toBe(12);
    expect(r.newRemainingHours).toBe(11);
  });

  it("negativ/NaN-agtige input klampes ikke til negative resultater", () => {
    const r = calcRenewal({
      baseHours: 10,
      oldRemaining: -2,
      oldOverdraft: -1,
      rollover: "carry",
    });
    expect(r.carriedHours).toBe(0);
    expect(r.settledOverdraft).toBe(0);
    expect(r.newRemainingHours).toBe(10);
  });
});
