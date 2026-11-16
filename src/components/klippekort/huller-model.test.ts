import { describe, expect, it } from "vitest";
import { formatTimer, klippekortModel } from "./huller-model";

const count = (holes: string[], s: string) =>
  holes.filter((h) => h === s).length;

describe("klippekortModel: skaleringsregler", () => {
  it("1 hul = 1 t op til og med 20 t", () => {
    const m = klippekortModel(20, 7);
    expect(m.hoursPerHole).toBe(1);
    expect(m.holes).toHaveLength(20);
    expect(count(m.holes, "brugt")).toBe(13);
    expect(count(m.holes, "tom")).toBe(7);
    expect(m.note).toBeNull();
    expect(m.label).toBe("7 t tilbage af 20");
  });

  it("over 20 t: 1 hul = 5 t med note", () => {
    const m = klippekortModel(21, 21);
    expect(m.hoursPerHole).toBe(5);
    expect(m.holes).toHaveLength(5); // 21 / 5 = 4,2 -> 5 huller
    expect(m.note).toBe("1 hul = 5 t");
    expect(count(m.holes, "tom")).toBe(5);
  });

  it("50 t med 17,5 tilbage: 6 brugte huller og et halvt", () => {
    const m = klippekortModel(50, 17.5); // 32,5 brugt = 6,5 huller
    expect(m.holes).toHaveLength(10);
    expect(count(m.holes, "brugt")).toBe(6);
    expect(m.holes[6]).toBe("halv");
    expect(count(m.holes, "tom")).toBe(3);
    expect(m.label).toBe("17,5 t tilbage af 50");
  });

  it("rest under et helt hul vises som halvfyldt (1 t-huller)", () => {
    const m = klippekortModel(10, 7.5); // 2,5 brugt
    expect(m.holes.slice(0, 3)).toEqual(["brugt", "brugt", "halv"]);
    expect(count(m.holes, "tom")).toBe(7);
  });

  it("delvist forbrug af et 5 t-hul giver ét halvt hul, uanset hvor lidt", () => {
    const m = klippekortModel(40, 39); // 1 t brugt af første 5 t-hul
    expect(m.holes[0]).toBe("halv");
    expect(count(m.holes, "brugt")).toBe(0);
  });

  it("overtræk: alle huller brugt, saldo 0 og overtræk i teksten", () => {
    const m = klippekortModel(20, -2);
    expect(count(m.holes, "brugt")).toBe(20);
    expect(m.remainingHours).toBe(0);
    expect(m.overdraftHours).toBe(2);
    expect(m.label).toBe("0 t tilbage af 20, 2 t overtrukket");
  });

  it("tomt kort (0 t) giver ingen huller og ingen division med nul", () => {
    const m = klippekortModel(0, 0);
    expect(m.holes).toHaveLength(0);
    expect(m.usedFraction).toBe(0);
    expect(m.label).toBe("0 t tilbage af 0");
  });

  it("et opbrugt kort med et kort sidste hul er helt udfyldt", () => {
    expect(count(klippekortModel(7.5, 0).holes, "brugt")).toBe(8);
    expect(count(klippekortModel(21, 0).holes, "brugt")).toBe(5);
    expect(count(klippekortModel(21, -3).holes, "brugt")).toBe(5);
  });

  it("det korte sidste hul er tomt, når kun det står tilbage", () => {
    const a = klippekortModel(21, 1); // 20 brugt = 4 hele 5 t-huller
    expect(count(a.holes, "brugt")).toBe(4);
    expect(a.holes[4]).toBe("tom");
    const b = klippekortModel(7.5, 0.5);
    expect(count(b.holes, "brugt")).toBe(7);
    expect(b.holes[7]).toBe("tom");
  });

  it("ubrugt kort: alle huller tomme", () => {
    const m = klippekortModel(20, 20);
    expect(count(m.holes, "tom")).toBe(20);
  });

  it("flydende-komma-støj giver ikke et ekstra hul", () => {
    const m = klippekortModel(0.1 + 0.2 + 19.7, 0.1 + 0.2);
    expect(m.holes).toHaveLength(20);
    expect(m.hoursPerHole).toBe(1);
  });

  it("meget store kort (over 200 t) falder tilbage til bjælke", () => {
    expect(klippekortModel(200, 100).useBar).toBe(false);
    const m = klippekortModel(205, 100);
    expect(m.useBar).toBe(true);
    expect(m.holes).toHaveLength(0);
    expect(m.usedFraction).toBeCloseTo(105 / 205);
  });

  it("ugyldige tal behandles som 0", () => {
    const m = klippekortModel(Number.NaN, Number.NaN);
    expect(m.holes).toHaveLength(0);
  });
});

describe("formatTimer", () => {
  it("bruger dansk decimalkomma", () => {
    expect(formatTimer(7.5)).toBe("7,5");
    expect(formatTimer(2.25)).toBe("2,25");
    expect(formatTimer(20)).toBe("20");
  });
});
