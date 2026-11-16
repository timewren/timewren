import { describe, expect, it } from "vitest";
import {
  beregnHaandvaerkerTimepris,
  maanedsloenTilTimeloen,
  timeloenTilMaanedsloen,
  timerPrMaaned,
} from "./loen";

describe("timeløn og månedsløn", () => {
  it("bruger 160,33 timer pr. måned ved 37 timer om ugen", () => {
    expect(timerPrMaaned(37)).toBeCloseTo(160.33, 2);
    expect(timerPrMaaned(0)).toBe(0);
  });

  it("omregner månedsløn til timeløn", () => {
    expect(maanedsloenTilTimeloen(35000, 37)).toBeCloseTo(218.3, 1);
    expect(maanedsloenTilTimeloen(17500, 18.5)).toBeCloseTo(218.3, 1);
    expect(maanedsloenTilTimeloen(35000, 0)).toBeNull();
  });

  it("omregner timeløn til månedsløn og tilbage igen", () => {
    const maaned = timeloenTilMaanedsloen(200, 37);
    expect(maaned).toBeCloseTo(32066.67, 2);
    expect(maanedsloenTilTimeloen(maaned, 37)).toBeCloseTo(200, 6);
  });
});

describe("håndværker-timepris", () => {
  const eksempel = {
    timeloen: 220,
    loentillaegPct: 25,
    betalteTimerPrAar: 1650,
    fakturerbarAndelPct: 80,
    fasteOmkostningerPrAar: 150000,
    avancePct: 15,
  };

  it("fordeler løn og faste omkostninger på de fakturerbare timer", () => {
    const r = beregnHaandvaerkerTimepris(eksempel);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.loenomkostningPrTime).toBe(275);
    expect(r.fakturerbareTimer).toBe(1320);
    expect(r.loenPrFakturerbarTime).toBeCloseTo(343.75, 2);
    expect(r.fastePrFakturerbarTime).toBeCloseTo(113.64, 2);
    expect(r.kostprisPrTime).toBeCloseTo(457.39, 2);
    expect(r.timeprisEksMoms).toBeCloseTo(525.99, 2);
    expect(r.timeprisInklMoms).toBeCloseTo(657.49, 2);
    expect(r.avanceAfTimepris).toBeCloseTo(13.04, 2);
  });

  it("lavere fakturerbar andel løfter kostprisen (eksemplet på siden)", () => {
    const r = beregnHaandvaerkerTimepris({
      ...eksempel,
      fakturerbarAndelPct: 70,
    });
    expect(r?.kostprisPrTime).toBeCloseTo(522.73, 2);
  });

  it("giver null uden fakturerbare timer", () => {
    expect(
      beregnHaandvaerkerTimepris({ ...eksempel, fakturerbarAndelPct: 0 }),
    ).toBeNull();
    expect(
      beregnHaandvaerkerTimepris({ ...eksempel, betalteTimerPrAar: 0 }),
    ).toBeNull();
  });

  it("uden avance er timeprisen lig kostprisen og avancen 0", () => {
    const r = beregnHaandvaerkerTimepris({ ...eksempel, avancePct: 0 });
    expect(r?.timeprisEksMoms).toBeCloseTo(r?.kostprisPrTime ?? 0, 6);
    expect(r?.avanceAfTimepris).toBeCloseTo(0, 6);
  });
});
