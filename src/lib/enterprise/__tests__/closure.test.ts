import { describe, expect, it } from "vitest";
import {
  CLOSURE_SKIP_LABELS,
  closureLengthDays,
  closureWorkingDates,
  type EmployeeClosureResult,
  MAX_CLOSURE_DAYS,
  skippedClosures,
} from "../closure";

describe("closureLengthDays", () => {
  it("tæller begge ender med", () => {
    expect(closureLengthDays("2026-10-12", "2026-10-12")).toBe(1);
    expect(closureLengthDays("2026-10-12", "2026-10-18")).toBe(7);
    expect(closureLengthDays("2026-12-21", "2027-01-03")).toBe(14);
  });

  it("maks. 31 dage pr. periode", () => {
    expect(MAX_CLOSURE_DAYS).toBe(31);
    expect(closureLengthDays("2026-07-01", "2026-07-31")).toBe(31);
    expect(closureLengthDays("2026-07-01", "2026-08-01")).toBe(32);
  });
});

describe("closureWorkingDates", () => {
  const monFri = ["1", "2", "3", "4", "5"];

  it("uge 42: 5 arbejdsdage for man–fre-profil", () => {
    expect(closureWorkingDates("2026-10-12", "2026-10-18", monFri, [])).toEqual(
      ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"],
    );
  });

  it("springer helligdage og ikke-arbejdsdage over", () => {
    // Jul 2026: 24/12 (tor) – 1/1 (fre); helligdage 24/12, 25/12, 31/12, 1/1
    expect(
      closureWorkingDates("2026-12-24", "2027-01-01", monFri, [
        "2026-12-24",
        "2026-12-25",
        "2026-12-31",
        "2027-01-01",
      ]),
    ).toEqual(["2026-12-28", "2026-12-29", "2026-12-30"]);
  });

  it("deltidsprofil med man/ons/fre", () => {
    expect(
      closureWorkingDates("2026-10-12", "2026-10-18", ["1", "3", "5"], []),
    ).toEqual(["2026-10-12", "2026-10-14", "2026-10-16"]);
  });

  it("tom når perioden kun rammer weekend", () => {
    expect(closureWorkingDates("2026-10-17", "2026-10-18", monFri, [])).toEqual(
      [],
    );
  });
});

describe("CLOSURE_SKIP_LABELS", () => {
  it("har dansk tekst for alle årsager", () => {
    expect(Object.keys(CLOSURE_SKIP_LABELS).sort()).toEqual([
      "balance",
      "error",
      "no_working_days",
      "overlap",
    ]);
  });
});

describe("skippedClosures", () => {
  it("returnerer kun de perioder der ikke blev materialiseret, med besked", () => {
    const results: EmployeeClosureResult[] = [
      {
        periodId: "p1",
        periodName: "Efterårsferie",
        result: { status: "created", requestId: "r1", totalDays: 5 },
      },
      {
        periodId: "p2",
        periodName: "Juleferie",
        result: {
          status: "skipped",
          reason: "overlap",
          message: CLOSURE_SKIP_LABELS.overlap,
        },
      },
      {
        periodId: "p3",
        periodName: "Vinterferie",
        result: {
          status: "skipped",
          reason: "balance",
          message: "Ikke nok feriedage …",
        },
      },
    ];
    expect(skippedClosures(results)).toEqual([
      {
        periodId: "p2",
        periodName: "Juleferie",
        message: CLOSURE_SKIP_LABELS.overlap,
      },
      {
        periodId: "p3",
        periodName: "Vinterferie",
        message: "Ikke nok feriedage …",
      },
    ]);
    expect(skippedClosures([])).toEqual([]);
  });
});
