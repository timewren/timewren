import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMESHEET_VALIDATION_SETTINGS,
  descriptionToNote,
  formatDayLabel,
  isRollingLocked,
  noteToDescription,
  rollingLockBoundary,
  rollingLockMessage,
  type TimesheetWeekForValidation,
  validateTimesheetWeek,
} from "../timesheet-validation";

// Uge 36 2026: mandag 31/8 – søndag 6/9
const DAYS = [
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-05",
  "2026-09-06",
];
const WORKDAYS = DAYS.slice(0, 5);

type MutableWeek = TimesheetWeekForValidation & {
  totals: Record<string, number>;
  norms: Record<string, number>;
};

function week(overrides: Partial<MutableWeek> = {}): MutableWeek {
  const totals: Record<string, number> = {};
  const norms: Record<string, number> = {};
  for (const d of DAYS) {
    norms[d] = WORKDAYS.includes(d) ? 8 : 0;
    totals[d] = WORKDAYS.includes(d) ? 8 : 0;
  }
  return {
    days: DAYS,
    totals,
    norms,
    weeklyNorm: 40,
    workingDates: new Set(WORKDAYS),
    absenceDates: new Set(),
    ...overrides,
  };
}

describe("validateTimesheetWeek", () => {
  it("en fuld normal uge giver hverken fejl eller advarsler", () => {
    expect(validateTimesheetWeek(week())).toEqual({ errors: [], warnings: [] });
  });

  it("dag over normen advarer med dansk dagnavn og timer", () => {
    const w = week();
    w.totals["2026-09-02"] = 9.5;
    const { errors, warnings } = validateTimesheetWeek(w);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "Onsdag 2/9: 9,5 t er over din norm på 8,0 t",
      "Ugen: 41,5 t er over din ugenorm på 40,0 t",
    ]);
  });

  it("ugen over ugenormen advarer selv når ingen enkelt dag er over", () => {
    const w = week({ weeklyNorm: 37 });
    const { warnings } = validateTimesheetWeek(w);
    expect(warnings).toEqual(["Ugen: 40,0 t er over din ugenorm på 37,0 t"]);
  });

  it("warnOverNorm=false slår norm-advarsler fra", () => {
    const w = week({ weeklyNorm: 37 });
    w.totals["2026-09-02"] = 12;
    const result = validateTimesheetWeek(w, {
      ...DEFAULT_TIMESHEET_VALIDATION_SETTINGS,
      warnOverNorm: false,
    });
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it("dag over maks pr. dag er en blokerende fejl (ikke også en advarsel)", () => {
    const w = week();
    w.totals["2026-09-03"] = 13;
    const { errors, warnings } = validateTimesheetWeek(w, {
      ...DEFAULT_TIMESHEET_VALIDATION_SETTINGS,
      maxHoursPerDay: 12,
    });
    expect(errors).toEqual([
      "Torsdag 3/9: 13,0 t overstiger maks. 12,0 t pr. dag",
    ]);
    // Dagen er fejl — ikke desuden en over-norm-advarsel; ugen advarer stadig
    expect(warnings).toEqual(["Ugen: 45,0 t er over din ugenorm på 40,0 t"]);
  });

  it("tom arbejdsdag uden fravær advarer som standard", () => {
    const w = week();
    w.totals["2026-09-04"] = 0;
    const { errors, warnings } = validateTimesheetWeek(w);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "Fredag 4/9 er en arbejdsdag uden registreringer eller fravær",
    ]);
  });

  it("tom arbejdsdag blokerer når blockEmptyWorkdays er slået til", () => {
    const w = week();
    w.totals["2026-09-04"] = 0;
    const { errors, warnings } = validateTimesheetWeek(w, {
      ...DEFAULT_TIMESHEET_VALIDATION_SETTINGS,
      blockEmptyWorkdays: true,
    });
    expect(errors).toEqual([
      "Fredag 4/9 er en arbejdsdag uden registreringer eller fravær",
    ]);
    expect(warnings).toEqual([]);
  });

  it("tom dag med fravær, helligdag eller fridag er ikke tom arbejdsdag", () => {
    const w = week({
      absenceDates: new Set(["2026-09-04"]),
      // Torsdag er helligdag → ikke arbejdsdato og norm 0
      workingDates: new Set(["2026-08-31", "2026-09-01", "2026-09-02"]),
    });
    w.totals["2026-09-03"] = 0;
    w.norms["2026-09-03"] = 0;
    w.totals["2026-09-04"] = 0;
    w.norms["2026-09-04"] = 0;
    // Lørdag/søndag er allerede 0 og ikke arbejdsdage
    expect(
      validateTimesheetWeek(w, {
        ...DEFAULT_TIMESHEET_VALIDATION_SETTINGS,
        blockEmptyWorkdays: true,
        warnOverNorm: false,
      }),
    ).toEqual({ errors: [], warnings: [] });
  });

  it("halv fraværsdag med timer over den halve norm advarer", () => {
    const w = week({ absenceDates: new Set(["2026-09-01"]) });
    w.norms["2026-09-01"] = 4;
    w.totals["2026-09-01"] = 5;
    const { warnings } = validateTimesheetWeek(w);
    expect(warnings[0]).toBe("Tirsdag 1/9: 5,0 t er over din norm på 4,0 t");
  });

  it("tåler manglende totals/norms for en dato", () => {
    const w = week({ totals: {}, norms: {} });
    const { errors, warnings } = validateTimesheetWeek(w);
    expect(errors).toEqual([]);
    // Alle fem arbejdsdage er tomme
    expect(warnings).toHaveLength(5);
  });
});

describe("formatDayLabel", () => {
  it("giver dansk dagnavn og d/m uden foranstillede nuller", () => {
    expect(formatDayLabel("2026-09-02")).toBe("Onsdag 2/9");
    expect(formatDayLabel("2026-12-06")).toBe("Søndag 6/12");
  });
});

describe("rullende lås", () => {
  // Onsdag 2/9 2026 — indeværende uge starter mandag 31/8
  const today = new Date(2026, 8, 2, 14, 30);

  it("ingen grænse uden indstilling", () => {
    expect(rollingLockBoundary(today, null)).toBeNull();
    expect(rollingLockBoundary(today, undefined)).toBeNull();
    expect(rollingLockBoundary(today, -1)).toBeNull();
    expect(isRollingLocked("2000-01-01", today, null)).toBe(false);
  });

  it("N=0 låser alt før indeværende uges mandag", () => {
    const boundary = rollingLockBoundary(today, 0);
    expect(boundary?.getTime()).toBe(new Date(2026, 7, 31).getTime());
    expect(isRollingLocked("2026-08-30", today, 0)).toBe(true);
    expect(isRollingLocked("2026-08-31", today, 0)).toBe(false);
    expect(isRollingLocked("2026-09-02", today, 0)).toBe(false);
  });

  it("N=2 holder de to foregående hele uger åbne", () => {
    // Mandag 17/8 er grænsen: 17/8 og frem er åben, 16/8 og før er låst
    expect(rollingLockBoundary(today, 2)?.getTime()).toBe(
      new Date(2026, 7, 17).getTime(),
    );
    expect(isRollingLocked("2026-08-16", today, 2)).toBe(true);
    expect(isRollingLocked("2026-08-17", today, 2)).toBe(false);
    expect(isRollingLocked(new Date(2026, 7, 23, 23, 59), today, 2)).toBe(
      false,
    );
  });

  it("søndag som 'i dag' regnes til den igangværende ISO-uge", () => {
    const sunday = new Date(2026, 8, 6);
    expect(rollingLockBoundary(sunday, 0)?.getTime()).toBe(
      new Date(2026, 7, 31).getTime(),
    );
  });

  it("ignorerer klokkeslæt på datoen der tjekkes", () => {
    expect(isRollingLocked(new Date(2026, 7, 30, 23, 59), today, 0)).toBe(true);
    expect(isRollingLocked(new Date(2026, 7, 31, 0, 0), today, 0)).toBe(false);
  });

  it("fejlbesked bøjer uger korrekt", () => {
    expect(rollingLockMessage(1)).toContain("ældre end 1 uge ");
    expect(rollingLockMessage(3)).toContain("ældre end 3 uger ");
  });
});

describe("cellenote ↔ description (bagudkompatibilitet)", () => {
  it("tom note bliver til den gamle standardbeskrivelse", () => {
    expect(noteToDescription(undefined)).toBe("Timeseddel");
    expect(noteToDescription(null)).toBe("Timeseddel");
    expect(noteToDescription("")).toBe("Timeseddel");
    expect(noteToDescription("   ")).toBe("Timeseddel");
  });

  it("note gemmes trimmet", () => {
    expect(noteToDescription("  Kursus i Aarhus ")).toBe("Kursus i Aarhus");
  });

  it("gamle 'Timeseddel'-poster vises uden note", () => {
    expect(descriptionToNote("Timeseddel")).toBeNull();
    expect(descriptionToNote("")).toBeNull();
    expect(descriptionToNote(null)).toBeNull();
    expect(descriptionToNote(undefined)).toBeNull();
  });

  it("rigtige beskrivelser vises som note", () => {
    expect(descriptionToNote("Kursus i Aarhus")).toBe("Kursus i Aarhus");
    expect(descriptionToNote(noteToDescription("Møde"))).toBe("Møde");
  });
});
