import { describe, expect, it } from "vitest";
import {
  belaegningForOmsaetning,
  beregnBelaegning,
  beregnDaekning,
  parseDanskTal,
  prisForDaekningsgrad,
} from "./noegletal";
import {
  decimalTilTimerOgMinutter,
  forkertKommaTimer,
  formatDecimaltimer,
  minutterTilDecimal,
} from "./tidsomregning";

describe("tidsomregning", () => {
  it("omregner minutter til decimaltimer med to decimaler", () => {
    expect(minutterTilDecimal(45)).toBe(0.75);
    expect(minutterTilDecimal(20)).toBe(0.33);
    expect(minutterTilDecimal(444)).toBe(7.4);
    expect(minutterTilDecimal(0)).toBe(0);
    expect(minutterTilDecimal(-5)).toBe(0);
  });

  it("omregner decimaltimer tilbage til timer og minutter", () => {
    expect(decimalTilTimerOgMinutter(2.3)).toEqual({ timer: 2, minutter: 18 });
    expect(decimalTilTimerOgMinutter(7.4)).toEqual({ timer: 7, minutter: 24 });
    expect(decimalTilTimerOgMinutter(0.999)).toEqual({ timer: 1, minutter: 0 });
  });

  it("viser den klassiske kommafejl", () => {
    expect(forkertKommaTimer(105)).toBe(1.45);
    expect(minutterTilDecimal(105) - forkertKommaTimer(105)).toBeCloseTo(0.3);
  });

  it("formaterer med dansk komma", () => {
    expect(formatDecimaltimer(7.4)).toBe("7,40");
  });
});

describe("dækningsgrad", () => {
  it("beregner DB, DG, resultat og nulpunkt", () => {
    const r = beregnDaekning({
      omsaetning: 800_000,
      variableOmkostninger: 320_000,
      fasteOmkostninger: 180_000,
    });
    expect(r.daekningsbidrag).toBe(480_000);
    expect(r.daekningsgrad).toBe(60);
    expect(r.resultat).toBe(300_000);
    expect(r.nulpunktsomsaetning).toBe(300_000);
  });

  it("håndterer nul omsætning", () => {
    const r = beregnDaekning({
      omsaetning: 0,
      variableOmkostninger: 0,
      fasteOmkostninger: 1000,
    });
    expect(r.daekningsgrad).toBeNull();
    expect(r.nulpunktsomsaetning).toBeNull();
  });

  it("finder salgsprisen for en ønsket dækningsgrad", () => {
    expect(prisForDaekningsgrad(450, 40)).toBe(750);
    expect(prisForDaekningsgrad(450, 100)).toBeNull();
  });
});

describe("belægningsgrad", () => {
  it("beregner belægning og værdien af et procentpoint", () => {
    const r = beregnBelaegning({
      normtidPrUge: 37,
      fravaersuger: 7,
      fakturerbareTimerPrUge: 25.9,
      timepris: 800,
    });
    expect(r.disponibleTimer).toBe(1665);
    expect(r.belaegningsgrad).toBeCloseTo(70);
    expect(r.vaerdiPrProcentpoint).toBeCloseTo(13_320);
  });

  it("regner baglæns fra en mål-omsætning", () => {
    expect(
      belaegningForOmsaetning({
        maalOmsaetning: 999_000,
        disponibleTimer: 1665,
        timepris: 800,
      }),
    ).toBeCloseTo(75);
    expect(
      belaegningForOmsaetning({
        maalOmsaetning: 1,
        disponibleTimer: 0,
        timepris: 800,
      }),
    ).toBeNull();
  });
});

describe("parseDanskTal", () => {
  it("læser danske og engelske talformater", () => {
    expect(parseDanskTal("1.234,5")).toBe(1234.5);
    expect(parseDanskTal("1.200")).toBe(1200);
    expect(parseDanskTal("800.000")).toBe(800000);
    expect(parseDanskTal("37,5")).toBe(37.5);
    expect(parseDanskTal("12.5")).toBe(12.5);
    expect(parseDanskTal("")).toBe(0);
    expect(parseDanskTal("abc")).toBe(0);
    expect(parseDanskTal("-5")).toBe(0);
  });

  it("kommafejlen runder minutter før timerne deles ud", () => {
    expect(forkertKommaTimer(119.6)).toBe(2);
  });
});
