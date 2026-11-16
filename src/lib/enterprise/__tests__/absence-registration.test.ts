import { describe, expect, it } from "vitest";
import {
  absenceCoversDate,
  allowsOpenPeriod,
  annualCapMessage,
  canSeeAbsenceType,
  effectiveEndDate,
  evaluateAnnualCap,
  MASKED_ABSENCE,
  maskAbsenceType,
  partialAbsenceDays,
  roundToQuarterDay,
  toAbsenceCategory,
} from "../absence-registration";

describe("allowsOpenPeriod / toAbsenceCategory", () => {
  it("kun sygdom og orlov må være åbne", () => {
    expect(allowsOpenPeriod("sickness")).toBe(true);
    expect(allowsOpenPeriod("leave")).toBe(true);
    expect(allowsOpenPeriod("vacation")).toBe(false);
    expect(allowsOpenPeriod("other")).toBe(false);
    expect(allowsOpenPeriod(null)).toBe(false);
  });

  it("ukendte kategorier falder tilbage til other", () => {
    expect(toAbsenceCategory("banana")).toBe("other");
    expect(toAbsenceCategory(undefined)).toBe("other");
    expect(toAbsenceCategory("sickness")).toBe("sickness");
  });
});

describe("effectiveEndDate / absenceCoversDate (åben periode)", () => {
  it("bruger registreret slutdato når den findes", () => {
    expect(effectiveEndDate("2026-08-20", "2026-08-22", "2026-08-27")).toBe(
      "2026-08-22",
    );
  });

  it("åben periode løber til og med i dag", () => {
    expect(effectiveEndDate("2026-08-20", null, "2026-08-27")).toBe(
      "2026-08-27",
    );
  });

  it("åben periode der starter i fremtiden tæller fra startdatoen", () => {
    expect(effectiveEndDate("2026-09-01", null, "2026-08-27")).toBe(
      "2026-09-01",
    );
  });

  it("dækker dage fra start til i dag, men ikke fremtiden", () => {
    const req = { startDate: "2026-08-20", endDate: null };
    expect(absenceCoversDate(req, "2026-08-19", "2026-08-27")).toBe(false);
    expect(absenceCoversDate(req, "2026-08-20", "2026-08-27")).toBe(true);
    expect(absenceCoversDate(req, "2026-08-27", "2026-08-27")).toBe(true);
    expect(absenceCoversDate(req, "2026-08-28", "2026-08-27")).toBe(false);
  });

  it("lukket periode ignorerer i dag", () => {
    const req = { startDate: "2026-08-20", endDate: "2026-08-21" };
    expect(absenceCoversDate(req, "2026-08-22", "2026-08-27")).toBe(false);
    expect(absenceCoversDate(req, "2026-08-21", "2026-08-27")).toBe(true);
  });
});

describe("partialAbsenceDays (delvis sygdom i timer)", () => {
  it("3 timer af 7,4 → 0,5 dag pr. dag efter kvart-afrunding", () => {
    // 3/7.4 = 0.405 → 0.5 (nærmeste kvarte)
    expect(
      partialAbsenceDays({ workingDays: 1, hoursPerDay: 3, dailyNorm: 7.4 }),
    ).toBe(0.5);
  });

  it("5 dage à 2 timer af 8 → 1,25 dage", () => {
    expect(
      partialAbsenceDays({ workingDays: 5, hoursPerDay: 2, dailyNorm: 8 }),
    ).toBe(1.25);
  });

  it("timer ≥ dagsnorm giver hele dage", () => {
    expect(
      partialAbsenceDays({ workingDays: 3, hoursPerDay: 9, dailyNorm: 7.4 }),
    ).toBe(3);
  });

  it("0 arbejdsdage, 0 timer eller ugyldig norm giver 0", () => {
    expect(
      partialAbsenceDays({ workingDays: 0, hoursPerDay: 3, dailyNorm: 7.4 }),
    ).toBe(0);
    expect(
      partialAbsenceDays({ workingDays: 2, hoursPerDay: 0, dailyNorm: 7.4 }),
    ).toBe(0);
    expect(
      partialAbsenceDays({ workingDays: 2, hoursPerDay: 3, dailyNorm: 0 }),
    ).toBe(0);
  });

  it("roundToQuarterDay afrunder til 0,25", () => {
    expect(roundToQuarterDay(0.3)).toBe(0.25);
    expect(roundToQuarterDay(0.38)).toBe(0.5);
    expect(roundToQuarterDay(1.87)).toBe(1.75);
  });
});

describe("evaluateAnnualCap (årsloft pr. type)", () => {
  it("intet loft → altid tilladt", () => {
    expect(
      evaluateAnnualCap({ capDays: null, usedDays: 99, requestedDays: 5 }),
    ).toEqual({ allowed: true, remaining: null });
  });

  it("barns 1. sygedag: 2 dage/år — anden dag ok, tredje afvises", () => {
    expect(
      evaluateAnnualCap({ capDays: 2, usedDays: 1, requestedDays: 1 }),
    ).toEqual({ allowed: true, remaining: 1 });
    expect(
      evaluateAnnualCap({ capDays: 2, usedDays: 2, requestedDays: 1 }),
    ).toEqual({ allowed: false, remaining: 0 });
    expect(
      evaluateAnnualCap({ capDays: 2, usedDays: 1, requestedDays: 2 }),
    ).toEqual({ allowed: false, remaining: 1 });
  });

  it("halve dage tælles med og flydende tal tolereres", () => {
    expect(
      evaluateAnnualCap({ capDays: 2, usedDays: 1.5, requestedDays: 0.5 })
        .allowed,
    ).toBe(true);
    expect(
      evaluateAnnualCap({ capDays: 2, usedDays: 0.1 + 0.2, requestedDays: 1.7 })
        .allowed,
    ).toBe(true);
  });

  it("dansk fejlbesked", () => {
    expect(
      annualCapMessage({
        typeName: "Barns 1. sygedag",
        capDays: 2,
        remaining: 0,
        year: 2026,
      }),
    ).toBe("Barns 1. sygedag er brugt op for 2026 (loft 2 dage pr. år)");
    expect(
      annualCapMessage({
        typeName: "Barns 1. sygedag",
        capDays: 2,
        remaining: 0.5,
        year: 2026,
      }),
    ).toBe("Kun 0,5 af 2 barns 1. sygedag-dage er tilbage i 2026");
  });
});

describe("synlighedsmaskering (kolleger må ikke se Sygdom)", () => {
  const sickness = {
    id: "t1",
    name: "Sygdom",
    color: "#ef4444",
    visibleToColleagues: false,
  };
  const vacation = {
    id: "t2",
    name: "Ferie",
    color: "#3b82f6",
    visibleToColleagues: true,
  };

  it("kollega ser neutral 'Fravær' for skjulte typer", () => {
    const viewer = {
      viewerUserId: "kollega",
      isPrivileged: false,
      managedUserIds: new Set<string>(),
    };
    expect(maskAbsenceType(viewer, "rasmus", sickness)).toEqual({
      ...sickness,
      name: MASKED_ABSENCE.name,
      color: MASKED_ABSENCE.color,
    });
    expect(canSeeAbsenceType(viewer, "rasmus", false)).toBe(false);
  });

  it("synlige typer maskeres aldrig", () => {
    const viewer = {
      viewerUserId: "kollega",
      isPrivileged: false,
      managedUserIds: new Set<string>(),
    };
    expect(maskAbsenceType(viewer, "rasmus", vacation)).toBe(vacation);
  });

  it("medarbejderen selv, dennes leder og admin ser typen", () => {
    const self = {
      viewerUserId: "rasmus",
      isPrivileged: false,
      managedUserIds: new Set<string>(),
    };
    const manager = {
      viewerUserId: "mette",
      isPrivileged: false,
      managedUserIds: new Set(["rasmus"]),
    };
    const admin = {
      viewerUserId: "owner",
      isPrivileged: true,
      managedUserIds: new Set<string>(),
    };
    expect(maskAbsenceType(self, "rasmus", sickness)).toBe(sickness);
    expect(maskAbsenceType(manager, "rasmus", sickness)).toBe(sickness);
    expect(maskAbsenceType(admin, "rasmus", sickness)).toBe(sickness);
  });

  it("en leder ser ikke sygdom for andres referencer", () => {
    const otherManager = {
      viewerUserId: "anden-leder",
      isPrivileged: false,
      managedUserIds: new Set(["someone-else"]),
    };
    expect(maskAbsenceType(otherManager, "rasmus", sickness).name).toBe(
      "Fravær",
    );
  });
});
