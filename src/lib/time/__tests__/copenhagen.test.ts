import { describe, expect, it } from "vitest";
import {
  addDaysToDateStr,
  addMonthsToDateStr,
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenHour,
  copenhagenToday,
  copenhagenWallTime,
  dateAnchorFromStr,
  entryDateFromStr,
  isoWeekdayOfDateStr,
  localDateToEntryDate,
  localWallClockAsCopenhagen,
  monthStartDateStr,
  toCopenhagenDateStr,
  weekStartDateStr,
} from "../copenhagen";

// Køres i CI både med TZ=UTC (prod) og TZ=Europe/Copenhagen (udvikling);
// alle forventninger er absolutte og må ikke afhænge af processens TZ.

describe("toCopenhagenDateStr", () => {
  it("lægger 00:30 dansk sommertid på den danske dag, ikke UTC-dagen", () => {
    // 2026-09-30T22:30Z = 1. oktober 00:30 i København (CEST, +2)
    expect(toCopenhagenDateStr(new Date("2026-09-30T22:30:00Z"))).toBe(
      "2026-10-01",
    );
    expect(toCopenhagenDateStr(new Date("2026-09-30T21:59:59Z"))).toBe(
      "2026-09-30",
    );
  });

  it("bruger +1 i vintertid", () => {
    expect(toCopenhagenDateStr(new Date("2026-12-31T22:59:59Z"))).toBe(
      "2026-12-31",
    );
    expect(toCopenhagenDateStr(new Date("2026-12-31T23:00:00Z"))).toBe(
      "2027-01-01",
    );
  });

  it("copenhagenToday bruger det givne øjeblik", () => {
    expect(copenhagenToday(new Date("2026-03-28T23:30:00Z"))).toBe(
      "2026-03-29",
    );
  });

  it("copenhagenHour følger sommertidsskiftet", () => {
    // 29/3-2026 kl. 01:00Z: urene er netop stillet frem til 03:00
    expect(copenhagenHour(new Date("2026-03-29T00:59:00Z"))).toBe(1);
    expect(copenhagenHour(new Date("2026-03-29T01:00:00Z"))).toBe(3);
  });
});

describe("copenhagenDayStart / copenhagenDayEndExclusive", () => {
  it("sommertid: dansk midnat er 22:00Z dagen før", () => {
    expect(copenhagenDayStart("2026-10-01").toISOString()).toBe(
      "2026-09-30T22:00:00.000Z",
    );
  });

  it("vintertid: dansk midnat er 23:00Z dagen før", () => {
    expect(copenhagenDayStart("2026-11-15").toISOString()).toBe(
      "2026-11-14T23:00:00.000Z",
    );
  });

  it("dagen for skift til sommertid (sidste søndag i marts) er 23 timer", () => {
    const start = copenhagenDayStart("2026-03-29");
    const end = copenhagenDayEndExclusive("2026-03-29");
    expect(start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it("dagen for skift til vintertid (sidste søndag i oktober) er 25 timer", () => {
    const start = copenhagenDayStart("2026-10-25");
    const end = copenhagenDayEndExclusive("2026-10-25");
    expect(start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it("afviser andet end yyyy-MM-dd", () => {
    expect(() => copenhagenDayStart("2026-10-01T00:00")).toThrow();
  });
});

describe("dato-aritmetik på strenge", () => {
  it("addDaysToDateStr krydser måned, år og sommertid uden at skride", () => {
    expect(addDaysToDateStr("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDaysToDateStr("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDaysToDateStr("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDaysToDateStr("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateStr("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("addMonthsToDateStr klemmer til månedens sidste dag", () => {
    expect(addMonthsToDateStr("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateStr("2026-10-15", -1)).toBe("2026-09-15");
    expect(addMonthsToDateStr("2026-12-01", 1)).toBe("2027-01-01");
  });

  it("ugestart er mandag", () => {
    expect(isoWeekdayOfDateStr("2026-10-04")).toBe(7); // søndag
    expect(isoWeekdayOfDateStr("2026-09-28")).toBe(1); // mandag
    expect(weekStartDateStr("2026-10-04")).toBe("2026-09-28");
    expect(weekStartDateStr("2026-09-28")).toBe("2026-09-28");
    expect(weekStartDateStr("2026-10-01")).toBe("2026-09-28");
  });

  it("monthStartDateStr", () => {
    expect(monthStartDateStr("2026-10-31")).toBe("2026-10-01");
  });

  it("entryDateFromStr giver UTC-midnat (lagringskonventionen)", () => {
    expect(entryDateFromStr("2026-10-01").toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });
});

describe("lokalt byggede datoer → dansk tid", () => {
  it("copenhagenWallTime tager højde for sommer- og vintertid", () => {
    expect(copenhagenWallTime(2026, 7, 1, 9, 30).toISOString()).toBe(
      "2026-07-01T07:30:00.000Z",
    );
    expect(copenhagenWallTime(2026, 12, 1, 9, 30).toISOString()).toBe(
      "2026-12-01T08:30:00.000Z",
    );
    // dagen for skift til vintertid: 12:00 er CET
    expect(copenhagenWallTime(2026, 10, 25, 12).toISOString()).toBe(
      "2026-10-25T11:00:00.000Z",
    );
  });

  it("localWallClockAsCopenhagen læser de lokale felter som dansk vægur", () => {
    const local = new Date(2026, 8, 30, 23, 30); // 30/9 23:30 lokalt
    expect(localWallClockAsCopenhagen(local).toISOString()).toBe(
      "2026-09-30T21:30:00.000Z",
    );
  });

  it("localDateToEntryDate giver UTC-midnat på den lokale kalenderdato", () => {
    expect(localDateToEntryDate(new Date(2026, 9, 1)).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("dateAnchorFromStr giver datoen med lokale getters", () => {
    const a = dateAnchorFromStr("2026-10-01");
    expect([a.getFullYear(), a.getMonth() + 1, a.getDate()]).toEqual([
      2026, 10, 1,
    ]);
  });
});

describe("copenhagenWallTime ved skiftene", () => {
  it("hullet i marts rykkes frem, den dobbelte time i oktober giver vintertid", () => {
    expect(copenhagenWallTime(2026, 3, 29, 2, 30).toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(copenhagenWallTime(2026, 10, 25, 2, 30).toISOString()).toBe(
      "2026-10-25T01:30:00.000Z",
    );
  });
});
