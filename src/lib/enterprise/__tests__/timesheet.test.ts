import { describe, expect, it } from "vitest";
import {
  applyUnpaidBreak,
  buildAbsenceRows,
  calculateDailyNorm,
  calculateWeeklyNorm,
  DEFAULT_ORG_WORK_SETTINGS,
  formatHours,
  formatHoursInput,
  formatTotal,
  hoursToAbsenceDays,
  nextFocusCell,
  type OrgWorkSettings,
  overtimeDeductionForAbsence,
  parseHours,
  pickAbsenceCellRequest,
  resolveBreakMinutes,
  unpaidBreakDeduction,
} from "../timesheet";

const FIVE_DAYS = ["1", "2", "3", "4", "5"];

/** kunde C: 8 t/dag fordi pausen er betalt og inkluderet (#449). */
const SCHOOL_ORG: OrgWorkSettings = {
  ...DEFAULT_ORG_WORK_SETTINGS,
  defaultWeeklyHours: 37,
  dailyNormHours: 8,
  breakMinutesPerDay: 30,
  breakPolicy: "paid_included",
};

describe("calculateDailyNorm", () => {
  it("deler ugetimer på arbejdsdage uden org-indstillinger (uændret)", () => {
    expect(
      calculateDailyNorm({ weeklyHours: 37, workingDays: FIVE_DAYS }),
    ).toBe(7.4);
    expect(
      calculateDailyNorm({
        weeklyHours: 30,
        workingDays: ["1", "2", "3", "4"],
      }),
    ).toBe(7.5);
    expect(
      calculateDailyNorm({ weeklyHours: 37, workingDays: ["1", "2", "3"] }),
    ).toBe(12.33);
    // Eksplicitte defaults og strenge fra pg giver samme resultat
    expect(
      calculateDailyNorm(
        { weeklyHours: "37.0", workingDays: FIVE_DAYS },
        DEFAULT_ORG_WORK_SETTINGS,
      ),
    ).toBe(7.4);
    expect(
      calculateDailyNorm({ weeklyHours: 37, workingDays: FIVE_DAYS }, null),
    ).toBe(7.4);
  });

  it("giver 0 uden arbejdsdage", () => {
    expect(calculateDailyNorm({ weeklyHours: 37, workingDays: [] })).toBe(0);
    expect(
      calculateDailyNorm({ weeklyHours: 37, workingDays: [] }, SCHOOL_ORG),
    ).toBe(0);
  });

  it("bruger org'ens dagsnorm for fuldtid (8,0/dag, 40,0/uge)", () => {
    const profile = { weeklyHours: 37, workingDays: FIVE_DAYS };
    expect(calculateDailyNorm(profile, SCHOOL_ORG)).toBe(8);
    expect(calculateWeeklyNorm(profile, SCHOOL_ORG)).toBe(40);
  });

  it("skalerer org-dagsnormen for deltid (30 t/uge → 6,5)", () => {
    expect(
      calculateDailyNorm(
        { weeklyHours: "30.0", workingDays: FIVE_DAYS },
        SCHOOL_ORG,
      ),
    ).toBe(6.5);
    // 4-dages uge med 30 t: samme dagsnorm, kortere ugenorm
    expect(
      calculateWeeklyNorm(
        { weeklyHours: 30, workingDays: ["1", "2", "3", "4"] },
        SCHOOL_ORG,
      ),
    ).toBe(26);
  });

  it("profil-override vinder over org-dagsnorm og fallback", () => {
    expect(
      calculateDailyNorm(
        { weeklyHours: 37, workingDays: FIVE_DAYS, dailyNormHours: "7.5" },
        SCHOOL_ORG,
      ),
    ).toBe(7.5);
    expect(
      calculateDailyNorm({
        weeklyHours: 37,
        workingDays: FIVE_DAYS,
        dailyNormHours: 6,
      }),
    ).toBe(6);
    // null-override = arv
    expect(
      calculateDailyNorm(
        { weeklyHours: 37, workingDays: FIVE_DAYS, dailyNormHours: null },
        SCHOOL_ORG,
      ),
    ).toBe(8);
  });

  it("ugenorm uden org-indstillinger er ugetimerne", () => {
    expect(
      calculateWeeklyNorm({ weeklyHours: 37, workingDays: FIVE_DAYS }),
    ).toBe(37);
  });
});

describe("hoursToAbsenceDays med org-dagsnorm", () => {
  it("sygdom på 8 t er en hel dag når dagsnormen er 8,0", () => {
    const norm = calculateDailyNorm(
      { weeklyHours: 37, workingDays: FIVE_DAYS },
      SCHOOL_ORG,
    );
    expect(hoursToAbsenceDays(8, norm)).toEqual({ days: 1, halfDay: false });
    expect(hoursToAbsenceDays(7.4, norm)).toEqual({ days: 0.5, halfDay: true });
  });
});

describe("resolveBreakMinutes", () => {
  it("profil-override vinder, ellers org", () => {
    expect(resolveBreakMinutes({ breakMinutes: 45 }, SCHOOL_ORG)).toBe(45);
    expect(resolveBreakMinutes({ breakMinutes: 0 }, SCHOOL_ORG)).toBe(0);
    expect(resolveBreakMinutes({ breakMinutes: null }, SCHOOL_ORG)).toBe(30);
    expect(resolveBreakMinutes(null, SCHOOL_ORG)).toBe(30);
    expect(resolveBreakMinutes(undefined, DEFAULT_ORG_WORK_SETTINGS)).toBe(0);
  });
});

describe("applyUnpaidBreak", () => {
  it("trækker intet fra på dage ≤ 6 t", () => {
    expect(applyUnpaidBreak(30, 6)).toBe(6);
    expect(applyUnpaidBreak(30, 5.5)).toBe(5.5);
    expect(unpaidBreakDeduction(30, 6)).toBe(0);
  });

  it("trækker pausen fra på dage > 6 t", () => {
    expect(applyUnpaidBreak(30, 8)).toBe(7.5);
    expect(applyUnpaidBreak(30, 6.25)).toBe(5.75);
    expect(applyUnpaidBreak(45, 7)).toBe(6.25);
    expect(unpaidBreakDeduction(30, 8)).toBe(0.5);
  });

  it("er aldrig negativ og ignorerer pause på 0", () => {
    expect(applyUnpaidBreak(600, 6.5)).toBe(0);
    expect(applyUnpaidBreak(0, 8)).toBe(8);
    expect(applyUnpaidBreak(30, 0)).toBe(0);
    expect(applyUnpaidBreak(30, -2)).toBe(0);
    expect(unpaidBreakDeduction(600, 6.5)).toBe(6.5);
  });
});

describe("hoursToAbsenceDays", () => {
  it("timer ≥ dagsnorm er en hel dag", () => {
    expect(hoursToAbsenceDays(7.4, 7.4)).toEqual({ days: 1, halfDay: false });
    expect(hoursToAbsenceDays(8, 7.4)).toEqual({ days: 1, halfDay: false });
    // Afrundingsstøj fra "7,4" må ikke give en halv dag
    expect(hoursToAbsenceDays(7.399, 7.4)).toEqual({
      days: 1,
      halfDay: false,
    });
  });

  it("0 < timer < dagsnorm er en halv dag", () => {
    expect(hoursToAbsenceDays(3.7, 7.4)).toEqual({ days: 0.5, halfDay: true });
    expect(hoursToAbsenceDays(0.5, 7.4)).toEqual({ days: 0.5, halfDay: true });
    expect(hoursToAbsenceDays(7, 7.4)).toEqual({ days: 0.5, halfDay: true });
  });

  it("0 timer rydder cellen", () => {
    expect(hoursToAbsenceDays(0, 7.4)).toEqual({ days: 0, halfDay: false });
    expect(hoursToAbsenceDays(-1, 7.4)).toEqual({ days: 0, halfDay: false });
  });

  it("uden dagsnorm tæller enhver indtastning som hel dag", () => {
    expect(hoursToAbsenceDays(1, 0)).toEqual({ days: 1, halfDay: false });
  });
});

describe("buildAbsenceRows — lukkeperioder (#436)", () => {
  const days = [
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
  ];
  const workingDates = new Set(days.slice(0, 5));
  const types = [
    {
      id: "vac",
      name: "Ferie",
      color: "#00f",
      requiresApproval: true,
      isDefault: true,
    },
  ];

  it("markerer celler fra en lukkeperiode som closure (kun arbejdsdage)", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [
        {
          id: "r1",
          absenceTypeId: "vac",
          startDate: "2026-10-12",
          endDate: "2026-10-18",
          halfDayStart: false,
          halfDayEnd: false,
          status: "approved",
          source: "closure",
        },
      ],
      days,
      dailyNorm: 7.4,
      workingDates,
    });
    const vac = rows[0];
    expect(Object.keys(vac.days)).toEqual(days.slice(0, 5));
    for (const d of days.slice(0, 5)) {
      expect(vac.days[d]).toMatchObject({
        hours: 7.4,
        status: "approved",
        multiDay: true,
        closure: true,
      });
    }
  });

  it("én-dags lukkeperiode er også closure og springer helligdage over", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [
        {
          id: "r2",
          absenceTypeId: "vac",
          startDate: "2026-10-14",
          endDate: "2026-10-14",
          halfDayStart: false,
          halfDayEnd: false,
          status: "approved",
          source: "closure",
        },
      ],
      days,
      dailyNorm: 7.4,
      workingDates: new Set(["2026-10-12", "2026-10-13"]), // 14/10 = helligdag
    });
    expect(rows[0].days["2026-10-14"]).toBeUndefined();
  });

  it("manuelle anmodninger har closure=false", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [
        {
          id: "r3",
          absenceTypeId: "vac",
          startDate: "2026-10-13",
          endDate: "2026-10-13",
          halfDayStart: false,
          halfDayEnd: false,
          status: "pending",
        },
      ],
      days,
      dailyNorm: 7.4,
      workingDates,
    });
    expect(rows[0].days["2026-10-13"]).toMatchObject({
      closure: false,
      multiDay: false,
    });
  });
});

describe("buildAbsenceRows", () => {
  const days = [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ];
  const workingDates = new Set(days.slice(0, 5));
  const types = [
    {
      id: "sick",
      name: "Sygdom",
      color: "#f00",
      requiresApproval: false,
      isDefault: false,
    },
    {
      id: "vac",
      name: "Ferie",
      color: null,
      requiresApproval: true,
      isDefault: true,
    },
    {
      id: "care",
      name: "Barns 1. sygedag",
      color: "#0f0",
      requiresApproval: false,
      isDefault: false,
    },
  ];

  it("sorterer isDefault først, derefter navn", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [],
      days,
      dailyNorm: 7.4,
      workingDates,
    });
    expect(rows.map((r) => r.name)).toEqual([
      "Ferie",
      "Barns 1. sygedag",
      "Sygdom",
    ]);
    expect(rows[0].color).toBe("#6b7280");
    expect(rows[0].days).toEqual({});
  });

  it("omregner 1-dags anmodninger til timer (hel/halv dag)", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [
        {
          id: "r1",
          absenceTypeId: "sick",
          startDate: "2026-08-26",
          endDate: "2026-08-26",
          halfDayStart: false,
          halfDayEnd: false,
          status: "approved",
        },
        {
          id: "r2",
          absenceTypeId: "vac",
          startDate: "2026-08-27",
          endDate: "2026-08-27",
          halfDayStart: true,
          halfDayEnd: false,
          status: "pending",
        },
      ],
      days,
      dailyNorm: 7.4,
      workingDates,
    });
    const sick = rows.find((r) => r.absenceTypeId === "sick");
    expect(sick?.days["2026-08-26"]).toEqual({
      hours: 7.4,
      status: "approved",
      requestId: "r1",
      multiDay: false,
      closure: false,
    });
    const vac = rows.find((r) => r.absenceTypeId === "vac");
    expect(vac?.days["2026-08-27"]).toEqual({
      hours: 3.7,
      status: "pending",
      requestId: "r2",
      multiDay: false,
      closure: false,
    });
  });

  it("springer fridage over også for 1-dags anmodninger (#452)", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [
        {
          id: "r-sat",
          absenceTypeId: "sick",
          startDate: "2026-08-29",
          endDate: "2026-08-29",
          halfDayStart: false,
          halfDayEnd: false,
          status: "approved",
        },
        {
          id: "r-wed",
          absenceTypeId: "sick",
          startDate: "2026-08-26",
          endDate: "2026-08-26",
          halfDayStart: false,
          halfDayEnd: false,
          status: "approved",
        },
      ],
      days,
      dailyNorm: 7.4,
      workingDates,
    });
    const sick = rows.find((r) => r.absenceTypeId === "sick");
    expect(Object.keys(sick?.days ?? {})).toEqual(["2026-08-26"]);
  });

  it("markerer flerdages perioder som read-only og springer fridage over", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [
        {
          id: "r3",
          absenceTypeId: "vac",
          startDate: "2026-08-20",
          endDate: "2026-09-02",
          halfDayStart: false,
          halfDayEnd: false,
          status: "approved",
        },
      ],
      days,
      dailyNorm: 7.4,
      workingDates,
    });
    const vac = rows.find((r) => r.absenceTypeId === "vac");
    expect(Object.keys(vac?.days ?? {})).toEqual(days.slice(0, 5));
    expect(vac?.days["2026-08-24"]?.multiDay).toBe(true);
    expect(vac?.days["2026-08-29"]).toBeUndefined();
  });

  it("ignorerer afviste/annullerede og ukendte typer", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [
        {
          id: "r4",
          absenceTypeId: "sick",
          startDate: "2026-08-26",
          endDate: "2026-08-26",
          halfDayStart: false,
          halfDayEnd: false,
          status: "rejected",
        },
        {
          id: "r5",
          absenceTypeId: "archived-type",
          startDate: "2026-08-26",
          endDate: "2026-08-26",
          halfDayStart: false,
          halfDayEnd: false,
          status: "approved",
        },
      ],
      days,
      dailyNorm: 7.4,
      workingDates,
    });
    expect(rows.every((r) => Object.keys(r.days).length === 0)).toBe(true);
  });
});

describe("parseHours", () => {
  it("accepterer dansk kommaformat", () => {
    expect(parseHours("7,4")).toBe(7.4);
    expect(parseHours("0,25")).toBe(0.25);
    expect(parseHours("2,5")).toBe(2.5);
  });

  it("accepterer punktum-format og hele tal", () => {
    expect(parseHours("7.4")).toBe(7.4);
    expect(parseHours("2.5")).toBe(2.5);
    expect(parseHours("8")).toBe(8);
    expect(parseHours("2")).toBe(2);
  });

  it("komma/punktum er decimal — ikke minutter", () => {
    expect(parseHours("2,37")).toBe(2.37);
    expect(parseHours("2.37")).toBe(2.37);
    expect(parseHours("2,30")).toBe(2.3);
  });

  it("kolon betyder timer:minutter", () => {
    expect(parseHours("2:30")).toBe(2.5);
    expect(parseHours("2:15")).toBe(2.25);
    expect(parseHours("7:24")).toBe(7.4);
    expect(parseHours("0:30")).toBe(0.5);
    expect(parseHours("2:00")).toBe(2);
    expect(parseHours("2:5")).toBe(2.08);
  });

  it("accepterer t/h-notation med og uden minutter", () => {
    expect(parseHours("2t30")).toBe(2.5);
    expect(parseHours("2h30")).toBe(2.5);
    expect(parseHours("2T30")).toBe(2.5);
    expect(parseHours("2t30m")).toBe(2.5);
    expect(parseHours("2t")).toBe(2);
    expect(parseHours("2h")).toBe(2);
    expect(parseHours("7t")).toBe(7);
    expect(parseHours("2 t 30 m")).toBe(2.5);
  });

  it("accepterer rene minutter", () => {
    expect(parseHours("30m")).toBe(0.5);
    expect(parseHours("90m")).toBe(1.5);
    expect(parseHours("45M")).toBe(0.75);
  });

  it("tom streng betyder 0 (ryd cellen)", () => {
    expect(parseHours("")).toBe(0);
    expect(parseHours("   ")).toBe(0);
    expect(parseHours("0")).toBe(0);
  });

  it("afviser ugyldigt input", () => {
    expect(parseHours("abc")).toBeNull();
    expect(parseHours("7,4,5")).toBeNull();
    expect(parseHours("2:")).toBeNull();
    expect(parseHours(":30")).toBeNull();
    expect(parseHours("2:60")).toBeNull();
    expect(parseHours("2t60")).toBeNull();
    expect(parseHours("2x30")).toBeNull();
    expect(parseHours("2,5t")).toBeNull();
    expect(parseHours("2:30:00")).toBeNull();
  });

  it("afviser negative og over 24 timer", () => {
    expect(parseHours("-2")).toBeNull();
    expect(parseHours("-2:30")).toBeNull();
    expect(parseHours("25")).toBeNull();
    expect(parseHours("24,5")).toBeNull();
    expect(parseHours("24:30")).toBeNull();
    expect(parseHours("25t")).toBeNull();
    expect(parseHours("1500m")).toBeNull();
    expect(parseHours("24")).toBe(24);
    expect(parseHours("24:00")).toBe(24);
    expect(parseHours("1440m")).toBe(24);
  });

  it("afrunder til to decimaler", () => {
    expect(parseHours("7,333333")).toBe(7.33);
    expect(parseHours("1:20")).toBe(1.33);
    expect(parseHours("10m")).toBe(0.17);
  });
});

describe("formatHoursInput", () => {
  it("viser tom streng for 0", () => {
    expect(formatHoursInput(0)).toBe("");
  });

  it("trimmer overflødige nuller og bruger komma", () => {
    expect(formatHoursInput(2.5)).toBe("2,5");
    expect(formatHoursInput(7.4)).toBe("7,4");
    expect(formatHoursInput(8)).toBe("8");
    expect(formatHoursInput(0.25)).toBe("0,25");
    expect(formatHoursInput(2.37)).toBe("2,37");
  });

  it("formatHours er samme funktion (bagudkompatibilitet)", () => {
    expect(formatHours(7.4)).toBe(formatHoursInput(7.4));
  });

  it("round-trip: parse → format → parse er stabil", () => {
    for (const raw of ["2:30", "7,4", "2t15", "30m", "8"]) {
      const parsed = parseHours(raw);
      expect(parsed).not.toBeNull();
      expect(parseHours(formatHoursInput(parsed as number))).toBe(parsed);
    }
  });
});

describe("formatTotal", () => {
  it("viser altid én decimal med komma", () => {
    expect(formatTotal(37)).toBe("37,0");
    expect(formatTotal(7.4)).toBe("7,4");
    expect(formatTotal(-14.8)).toBe("-14,8");
  });
});

describe("overtimeDeductionForAbsence (#452)", () => {
  it("giver negativ post = dage × dagsnorm med dansk note", () => {
    expect(
      overtimeDeductionForAbsence({
        days: 1,
        dailyNorm: 7.4,
        startDate: "2026-08-26",
        endDate: "2026-08-26",
      }),
    ).toEqual({ hours: "-7.40", note: "Afspadsering 2026-08-26 (1,00 dage)" });
  });

  it("halv dag og flerdages periode", () => {
    expect(
      overtimeDeductionForAbsence({
        days: 0.5,
        dailyNorm: 7.4,
        startDate: "2026-08-26",
        endDate: "2026-08-26",
      }),
    ).toEqual({ hours: "-3.70", note: "Afspadsering 2026-08-26 (0,50 dage)" });
    expect(
      overtimeDeductionForAbsence({
        days: 2,
        dailyNorm: 8,
        startDate: "2026-08-26",
        endDate: "2026-08-27",
      }),
    ).toEqual({
      hours: "-16.00",
      note: "Afspadsering 2026-08-26 – 2026-08-27 (2,00 dage)",
    });
  });

  it("deltid dobbelt-skaleres ikke: 22,5 t/uge ⇒ 1 kalenderdag = 4,5 t", () => {
    const profile = {
      weeklyHours: 22.5,
      workingDays: ["1", "2", "3", "4", "5"],
    };
    const dailyNorm = calculateDailyNorm(profile, DEFAULT_ORG_WORK_SETTINGS);
    expect(dailyNorm).toBe(4.5);
    // Kalderen SKAL sende kalender-arbejdsdage (1), ikke FTE-skalerede
    // deductedDays (37/22,5 ≈ 1,64) — ellers ville fradraget blive 7,4 t.
    expect(
      overtimeDeductionForAbsence({
        days: 1,
        dailyNorm,
        startDate: "2026-08-26",
        endDate: "2026-08-26",
      }),
    ).toEqual({ hours: "-4.50", note: "Afspadsering 2026-08-26 (1,00 dage)" });
  });

  it("null når der intet er at trække", () => {
    expect(
      overtimeDeductionForAbsence({
        days: 0,
        dailyNorm: 7.4,
        startDate: "2026-08-26",
        endDate: "2026-08-26",
      }),
    ).toBeNull();
    expect(
      overtimeDeductionForAbsence({
        days: 1,
        dailyNorm: 0,
        startDate: "2026-08-26",
        endDate: "2026-08-26",
      }),
    ).toBeNull();
  });
});

describe("buildAbsenceRows — norm pr. dag (#457)", () => {
  const days = ["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24"];
  const workingDates = new Set(days);
  const types = [
    {
      id: "vac",
      name: "Ferie",
      color: "#00f",
      requiresApproval: true,
      isDefault: true,
    },
  ];
  // 24/12 er halvdags-helligdag → norm 3.7 (setAbsenceCell: effectiveNorm)
  const norms = {
    "2026-12-21": 7.4,
    "2026-12-22": 7.4,
    "2026-12-23": 7.4,
    "2026-12-24": 3.7,
  };
  const req = (id: string, date: string, half = false) => ({
    id,
    absenceTypeId: "vac",
    startDate: date,
    endDate: date,
    halfDayStart: half,
    halfDayEnd: false,
    status: "approved",
    source: "timesheet",
  });

  it("heldag på halvdags-helligdag viser den halve norm, ikke dagsnormen", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [req("a", "2026-12-23"), req("b", "2026-12-24")],
      days,
      dailyNorm: 7.4,
      norms,
      workingDates,
    });
    expect(rows[0].days["2026-12-23"].hours).toBe(7.4);
    expect(rows[0].days["2026-12-24"].hours).toBe(3.7);
  });

  it("halv dag er halvdelen af dagens norm", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [req("a", "2026-12-24", true)],
      days,
      dailyNorm: 7.4,
      norms,
      workingDates,
    });
    expect(rows[0].days["2026-12-24"].hours).toBe(1.85);
  });

  it("falder tilbage til dailyNorm uden opslag for dagen", () => {
    const rows = buildAbsenceRows({
      types,
      requests: [req("a", "2026-12-22")],
      days,
      dailyNorm: 8,
      norms: {},
      workingDates,
    });
    expect(rows[0].days["2026-12-22"].hours).toBe(8);
  });
});

describe("pickAbsenceCellRequest (#457)", () => {
  const ts = { id: "t", absenceTypeId: "vac", source: "timesheet" };
  const manual = { id: "m", absenceTypeId: "vac", source: "manual" };
  const legacy = { id: "l", absenceTypeId: "vac" };
  const closure = { id: "c", absenceTypeId: "vac", source: "closure" };
  const otherTs = { id: "o", absenceTypeId: "sick", source: "timesheet" };

  it("tom dag: hverken eksisterende eller fremmed", () => {
    expect(pickAbsenceCellRequest([], "vac")).toEqual({
      existing: undefined,
      foreign: undefined,
    });
  });

  it("grid'ets egen post af samme type kan overtages", () => {
    const r = pickAbsenceCellRequest([ts], "vac");
    expect(r.existing).toBe(ts);
    expect(r.foreign).toBeUndefined();
  });

  it("manuel anmodning af samme type er fremmed — aldrig existing", () => {
    const r = pickAbsenceCellRequest([manual], "vac");
    expect(r.existing).toBeUndefined();
    expect(r.foreign).toBe(manual);
  });

  it("manglende source tolkes som manuel", () => {
    expect(pickAbsenceCellRequest([legacy], "vac").foreign).toBe(legacy);
  });

  it("lukkeperiode og anden type er fremmede", () => {
    expect(pickAbsenceCellRequest([closure], "vac").foreign).toBe(closure);
    expect(pickAbsenceCellRequest([otherTs], "vac").foreign).toBe(otherTs);
  });

  it("egen post + fremmed på samme dag: begge rapporteres", () => {
    const r = pickAbsenceCellRequest([ts, manual], "vac");
    expect(r.existing).toBe(ts);
    expect(r.foreign).toBe(manual);
  });
});

describe("nextFocusCell — tastaturnavigation", () => {
  const shape = { rowCount: 3, colCount: 7 };
  const pos = { row: 1, col: 3 };

  it("pil ned og Enter flytter én række ned", () => {
    expect(nextFocusCell(pos, "ArrowDown", shape)).toEqual({
      row: 2,
      col: 3,
    });
    expect(nextFocusCell(pos, "Enter", shape)).toEqual({ row: 2, col: 3 });
  });

  it("pil op flytter én række op", () => {
    expect(nextFocusCell(pos, "ArrowUp", shape)).toEqual({ row: 0, col: 3 });
  });

  it("stopper ved nederste/øverste kant", () => {
    expect(nextFocusCell({ row: 2, col: 3 }, "ArrowDown", shape)).toBeNull();
    expect(nextFocusCell({ row: 0, col: 3 }, "ArrowUp", shape)).toBeNull();
  });

  it("pil højre/venstre flytter dag når caret står i kanten", () => {
    expect(nextFocusCell(pos, "ArrowRight", shape, false, true)).toEqual({
      row: 1,
      col: 4,
    });
    expect(nextFocusCell(pos, "ArrowLeft", shape, true, false)).toEqual({
      row: 1,
      col: 2,
    });
  });

  it("lader caret flytte sig indeni feltet (ingen hop)", () => {
    expect(nextFocusCell(pos, "ArrowRight", shape, false, false)).toBeNull();
    expect(nextFocusCell(pos, "ArrowLeft", shape, false, false)).toBeNull();
  });

  it("stopper ved sidste dag/første dag", () => {
    expect(
      nextFocusCell({ row: 1, col: 6 }, "ArrowRight", shape, true, true),
    ).toBeNull();
    expect(
      nextFocusCell({ row: 1, col: 0 }, "ArrowLeft", shape, true, true),
    ).toBeNull();
  });

  it("tom celle navigerer med venstre/højre (caret på begge kanter)", () => {
    expect(nextFocusCell(pos, "ArrowRight", shape, true, true)).toEqual({
      row: 1,
      col: 4,
    });
    expect(nextFocusCell(pos, "ArrowLeft", shape, true, true)).toEqual({
      row: 1,
      col: 2,
    });
  });

  it("ignorerer andre taster", () => {
    expect(nextFocusCell(pos, "Tab", shape)).toBeNull();
    expect(nextFocusCell(pos, "a", shape)).toBeNull();
  });
});
