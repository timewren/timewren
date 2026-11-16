import { describe, expect, it } from "vitest";
import { estimateTeamPrice } from "./team-pris";

const opt = (users: number, tier: string, needsHr = false) =>
  estimateTeamPrice(users, needsHr).options.find((o) => o.tier === tier);

describe("estimateTeamPrice", () => {
  it("prissætter Team pr. bruger ud over de 2 inkluderede (8 brugere)", () => {
    const team = opt(8, "team");
    // 98 + 6 × 49 = 392 pr. md; årligt 980 + 6 × 490 = 3.920
    expect(team?.monthlyTotal).toBe(392);
    expect(team?.yearlyTotal).toBe(3920);
    expect(team?.yearlyPerMonth).toBe(327);
    expect(team?.perUserMonthly).toBe(49);
    expect(team?.billedSeats).toBe(8);
  });

  it("prissætter Virksomhed pr. bruger ud over de 5 inkluderede (8 brugere)", () => {
    const business = opt(8, "business");
    // 345 + 3 × 69 = 552 pr. md; årligt 3.450 + 3 × 690 = 5.520
    expect(business?.monthlyTotal).toBe(552);
    expect(business?.yearlyTotal).toBe(5520);
    expect(business?.perUserMonthly).toBe(69);
  });

  it("fakturerer planens minimum når teamet er mindre", () => {
    expect(opt(1, "team")?.billedSeats).toBe(2);
    expect(opt(1, "team")?.monthlyTotal).toBe(98);
    expect(opt(3, "business")?.billedSeats).toBe(5);
    expect(opt(3, "business")?.monthlyTotal).toBe(345);
  });

  it("Gratis dækker op til 3 brugere og koster 0", () => {
    expect(opt(3, "free")?.available).toBe(true);
    expect(opt(3, "free")?.monthlyTotal).toBe(0);
    expect(opt(4, "free")?.available).toBe(false);
  });

  it("anbefaler Team op til 25 brugere og Virksomhed derover", () => {
    expect(estimateTeamPrice(25).recommended).toBe("team");
    expect(estimateTeamPrice(26).recommended).toBe("business");
    expect(opt(26, "team")?.available).toBe(false);
    // 345 + 21 × 69 = 1.794
    expect(opt(26, "business")?.monthlyTotal).toBe(1794);
  });

  it("anbefaler Virksomhed ved behov for ferie, fravær og godkendelser", () => {
    expect(estimateTeamPrice(4, true).recommended).toBe("business");
  });

  it("anbefaler ingen plan over 50 brugere (kontakt os)", () => {
    expect(estimateTeamPrice(51).recommended).toBeNull();
    expect(estimateTeamPrice(51, true).recommended).toBeNull();
  });

  it("normaliserer ugyldigt antal til mindst 1 hel bruger", () => {
    expect(estimateTeamPrice(0).users).toBe(1);
    expect(estimateTeamPrice(4.7).users).toBe(4);
    expect(estimateTeamPrice(Number.NaN).users).toBe(1);
    expect(opt(Number.NaN, "team")?.monthlyTotal).toBe(98);
  });
});
