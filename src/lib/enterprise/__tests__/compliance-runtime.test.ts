import { describe, expect, it } from "vitest";
import {
  type ComplianceRuleSettings,
  calculate48hWeeklyAverage,
  type DatedTimeEntry,
  evaluateEntryCompliance,
  findLongDays,
  findWeeklyRestViolations,
  getComplianceStatus,
  sumHoursByDay,
} from "../compliance";

// Mandag 2/3-2026 (lokal tid)
const MON = "2026-03-02";

function at(date: string, hour: number, minute = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const out = new Date(y, m - 1, d + n);
  return `${out.getFullYear()}-${String(out.getMonth() + 1).padStart(2, "0")}-${String(out.getDate()).padStart(2, "0")}`;
}

/** Timeseddel-poster uden klokkeslæt: `hours` pr. dag i en uge (man-søn). */
function untimedWeek(weekStart: string, hours: number[]): DatedTimeEntry[] {
  return hours
    .map((h, i) => ({ date: addDays(weekStart, i), hours: h }))
    .filter((e) => e.hours > 0);
}

/** Poster med klokkeslæt: start kl. `startHour`, `hours` timer, man-fre. */
function timedWeek(
  weekStart: string,
  hours: number,
  startHour = 8,
  days = 5,
): DatedTimeEntry[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(weekStart, i);
    const start = at(date, startHour);
    return {
      date,
      hours,
      startTime: start,
      endTime: new Date(start.getTime() + hours * 3_600_000),
    };
  });
}

const allWarn: ComplianceRuleSettings = {
  rule48h: "warn",
  dailyRest: "warn",
  weeklyRest: "warn",
};
const allBlock: ComplianceRuleSettings = {
  rule48h: "block",
  dailyRest: "block",
  weeklyRest: "block",
};
const allOff: ComplianceRuleSettings = {
  rule48h: "off",
  dailyRest: "off",
  weeklyRest: "off",
};

describe("48 t-nævner: ISO-uger inklusive (kort historik)", () => {
  it("man–fre 5×8 t + 8 t næste mandag = 2 uger, 24 t/uge — ikke 48", () => {
    const entries = untimedWeek(MON, [8, 8, 8, 8, 8, 0, 0]);
    const nextMonday = addDays(MON, 7);
    const r = evaluateEntryCompliance({
      settings: allBlock,
      candidate: { date: nextMonday, hours: 8 },
      entries,
    });
    expect(r.allowed).toBe(true);
    expect(r.findings).toEqual([]);

    const avg = calculate48hWeeklyAverage([
      ...entries.map((e) => ({ hours: e.hours, startTime: at(e.date, 8) })),
      { hours: 8, startTime: at(nextMonday, 8) },
    ]);
    expect(avg.weeksInPeriod).toBe(2);
    expect(avg.averageHoursPerWeek).toBe(24);
  });

  it("søndag → mandag er 2 uger; samme uge er 1; årsskifte tæller rigtigt", () => {
    // Søndag 8/3 → mandag 9/3
    expect(
      calculate48hWeeklyAverage([
        { hours: 1, startTime: at(addDays(MON, 6), 8) },
        { hours: 1, startTime: at(addDays(MON, 7), 8) },
      ]).weeksInPeriod,
    ).toBe(2);
    expect(
      calculate48hWeeklyAverage([
        { hours: 1, startTime: at(MON, 8) },
        { hours: 1, startTime: at(addDays(MON, 6), 23) },
      ]).weeksInPeriod,
    ).toBe(1);
    // Man 29/12-2025 (uge 1/2026 starter tors 1/1? nej: ISO uge 1 = 29/12–4/1)
    // → man 12/1-2026 = 3 ISO-uger
    expect(
      calculate48hWeeklyAverage([
        { hours: 1, startTime: at("2025-12-29", 8) },
        { hours: 1, startTime: at("2026-01-12", 8) },
      ]).weeksInPeriod,
    ).toBe(3);
  });

  it("netto-timer (hours) vinder over start→slut-spændet i summer", () => {
    // 9 t på uret, 8 t netto efter pause
    const date = addDays(MON, 1);
    const totals = sumHoursByDay([
      { date, hours: 8, startTime: at(date, 8), endTime: at(date, 17) },
    ]);
    expect(totals[date]).toBe(8);
  });
});

describe("fravær i 48 t-gennemsnittet (neutralt, arbejdstidslovens § 4)", () => {
  /** Hverdage man–fre i ugen der starter `weekStart`. */
  const weekdays = (weekStart: string) =>
    Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));

  it("3 uger à 60 t + 1 uges ferie giver brud — ferien udvander ikke", () => {
    // Før #728: 180 t / 4 uger = 45 t → kun advarsel
    const entries = [
      ...timedWeek(MON, 12),
      ...timedWeek(addDays(MON, 7), 12),
      ...timedWeek(addDays(MON, 21), 12),
    ];
    const r = calculate48hWeeklyAverage(entries, {
      absenceDates: weekdays(addDays(MON, 14)),
    });
    expect(r.totalHours).toBe(180);
    expect(r.weeksInPeriod).toBe(3);
    expect(r.averageHoursPerWeek).toBe(60);
    expect(r.status).toBe("violation");
  });

  it("ferie man–søn neutraliserer også kun én uge", () => {
    const entries = [...timedWeek(MON, 12), ...timedWeek(addDays(MON, 14), 12)];
    const vacation = Array.from({ length: 7 }, (_, i) => addDays(MON, 7 + i));
    const r = calculate48hWeeklyAverage(entries, { absenceDates: vacation });
    expect(r.weeksInPeriod).toBe(2);
    expect(r.averageHoursPerWeek).toBe(60);
  });

  it("delvist fravær: 2 sygedage tager 2/5 af ugen ud af nævneren", () => {
    // 4 uger à 40 t + en uge med 3 × 8 t og 2 sygedage = normal takt (40)
    const entries = [
      ...timedWeek(MON, 8),
      ...timedWeek(addDays(MON, 7), 8),
      ...timedWeek(addDays(MON, 14), 8),
      ...timedWeek(addDays(MON, 21), 8),
      ...timedWeek(addDays(MON, 28), 8, 8, 3),
    ];
    const sick = [addDays(MON, 31), addDays(MON, 32)];
    const r = calculate48hWeeklyAverage(entries, { absenceDates: sick });
    expect(r.weeksInPeriod).toBe(4.6);
    expect(r.averageHoursPerWeek).toBe(40);

    // Højt tempo i de arbejdede dage giver brud trods sygedagene
    const heavy = calculate48hWeeklyAverage(
      [...timedWeek(MON, 12), ...timedWeek(addDays(MON, 7), 12, 8, 3)],
      { absenceDates: [addDays(MON, 10), addDays(MON, 11)] },
    );
    expect(heavy.averageHoursPerWeek).toBe(60); // 96 t / 1,6 uge
    expect(heavy.status).toBe("violation");
  });

  it("kun fravær i perioden: 0 t, ingen division med nul, ingen alarm", () => {
    const fourWeeks = [0, 7, 14, 21].flatMap((o) => weekdays(addDays(MON, o)));
    const r = calculate48hWeeklyAverage([], { absenceDates: fourWeeks });
    expect(r.averageHoursPerWeek).toBe(0);
    expect(Number.isFinite(r.averageHoursPerWeek)).toBe(true);
    expect(r.weeksInPeriod).toBe(0);
    expect(r.status).toBe("ok");
    expect(calculate48hWeeklyAverage([], { absenceDates: [MON] }).status).toBe(
      "ok",
    );
  });

  it("arbejde på en fraværsdag tæller — dagen er ikke neutral", () => {
    // Hele ugen er ferie, men der er registreret 8 t onsdag
    const r = calculate48hWeeklyAverage(
      [{ hours: 8, startTime: at(addDays(MON, 2), 8) }],
      { absenceDates: weekdays(MON) },
    );
    expect(r.weeksInPeriod).toBe(0.2);
    expect(r.averageHoursPerWeek).toBe(40);
    // Kun weekendarbejde i en ferieuge: aldrig division med nul
    const weekend = calculate48hWeeklyAverage(
      [{ hours: 5, startTime: at(addDays(MON, 5), 8) }],
      { absenceDates: weekdays(MON) },
    );
    expect(Number.isFinite(weekend.averageHoursPerWeek)).toBe(true);
    expect(weekend.weeksInPeriod).toBe(0.14); // 1/7 uge
    expect(weekend.averageHoursPerWeek).toBe(35);
  });

  it("afspadsering er ikke neutral: tæller som 0 t i nævneren", () => {
    // 2 uger à 50 t + en uges afspadsering → 100 / 3 ≈ 33,3
    const entries = [...timedWeek(MON, 10), ...timedWeek(addDays(MON, 7), 10)];
    const timeOff = weekdays(addDays(MON, 14));
    const r = calculate48hWeeklyAverage(entries, {
      absenceDates: timeOff,
      neutralAbsenceDates: [],
    });
    expect(r.weeksInPeriod).toBe(3);
    expect(r.averageHoursPerWeek).toBeCloseTo(33.33, 1);
    expect(r.status).toBe("ok");
  });

  it("uden fravær er gennemsnittet uændret (ikke-brud består)", () => {
    const entries = [...timedWeek(MON, 8), ...timedWeek(addDays(MON, 7), 8)];
    const r = calculate48hWeeklyAverage(entries);
    expect(r.weeksInPeriod).toBe(2);
    expect(r.averageHoursPerWeek).toBe(40);
    expect(r.status).toBe("ok");
  });

  it("evaluateEntryCompliance: afspadsering (ikke neutral) udvander stadig", () => {
    const entries = [
      ...untimedWeek(MON, [12, 12, 12, 12, 12, 0, 0]),
      ...untimedWeek(addDays(MON, 7), [12, 12, 12, 12, 12, 0, 0]),
      ...untimedWeek(addDays(MON, 21), [12, 12, 12, 12, 0, 0, 0]),
    ];
    const r = evaluateEntryCompliance({
      settings: { ...allOff, rule48h: "block" },
      candidate: { date: addDays(MON, 25), hours: 12 },
      entries,
      absenceDates: weekdays(addDays(MON, 14)),
      neutralAbsenceDates: [],
    });
    expect(r.allowed).toBe(true);
    expect(r.findings[0]).toMatchObject({ rule: "48h", severity: "warning" });
  });

  it("evaluateEntryCompliance: ferieuge i perioden skjuler ikke bruddet", () => {
    const entries = [
      ...untimedWeek(MON, [12, 12, 12, 12, 12, 0, 0]),
      ...untimedWeek(addDays(MON, 7), [12, 12, 12, 12, 12, 0, 0]),
      ...untimedWeek(addDays(MON, 21), [12, 12, 12, 12, 0, 0, 0]),
    ];
    const r = evaluateEntryCompliance({
      settings: { ...allOff, rule48h: "block" },
      candidate: { date: addDays(MON, 25), hours: 12 },
      entries,
      absenceDates: weekdays(addDays(MON, 14)),
    });
    expect(r.allowed).toBe(false);
    expect(r.findings[0]).toMatchObject({ rule: "48h", value: 60 });
  });
});

describe("fravær i ugehvile", () => {
  it("en hel fraværsdag i ugen tæller som hvile", () => {
    // 7 dage à 12 t (08–20): længste pause 12 t → overtrædelse …
    const week = timedWeek(MON, 12, 8, 7);
    expect(findWeeklyRestViolations(week)).toHaveLength(1);
    // … medmindre en dag i ugen er godkendt fravær
    expect(
      findWeeklyRestViolations(week, { absenceDates: [addDays(MON, 3)] }),
    ).toHaveLength(0);
  });
});

describe("dagsum-heuristik (> 13 t)", () => {
  it("sumHoursByDay + findLongDays", () => {
    const entries = untimedWeek(MON, [8, 14, 13, 13.5, 0, 0, 0]);
    const totals = sumHoursByDay(entries);
    expect(totals[MON]).toBe(8);
    expect(findLongDays(totals)).toEqual([
      { date: addDays(MON, 1), hours: 14 },
      { date: addDays(MON, 3), hours: 13.5 },
    ]);
    // Dage med dokumenteret hvile-overtrædelse springes over
    expect(findLongDays(totals, [addDays(MON, 1)])).toHaveLength(1);
  });

  it("getComplianceStatus rapporterer longDays og sætter violation", () => {
    const entries = untimedWeek(MON, [14, 7, 7, 7, 7, 0, 0]).map((e) => ({
      ...e,
      startTime: at(e.date, 0),
    }));
    const status = getComplianceStatus({ isSelfScheduler: false }, entries, {
      dayTotals: sumHoursByDay(entries),
    });
    expect(status.longDays).toEqual([{ date: MON, hours: 14 }]);
    expect(status.overallStatus).toBe("violation");
    expect(status.weeklyAverage.totalHours).toBe(42);
  });
});

describe("evaluateEntryCompliance — off/warn/block", () => {
  // 28 t + kandidat holder ugen under 45 t, så 48 t-reglen ikke blander sig
  const existing = untimedWeek(MON, [7, 7, 7, 7, 0, 0, 0]);

  it("14 t på en dag: warn → advarsel, block → afvist, off → intet", () => {
    const candidate = { date: addDays(MON, 4), hours: 14 };
    const warn = evaluateEntryCompliance({
      settings: allWarn,
      candidate,
      entries: existing,
    });
    expect(warn.allowed).toBe(true);
    expect(warn.blocked).toEqual([]);
    expect(warn.findings.map((f) => f.rule)).toEqual(["daily_rest"]);
    expect(warn.warnings[0]).toContain("14,0 t registreret 6/3");
    expect(warn.findings[0]).toMatchObject({
      date: addDays(MON, 4),
      value: 14,
      limit: 13,
      severity: "violation",
    });

    const block = evaluateEntryCompliance({
      settings: allBlock,
      candidate,
      entries: existing,
    });
    expect(block.allowed).toBe(false);
    expect(block.blocked).toHaveLength(1);
    expect(block.warnings).toEqual([]);

    const off = evaluateEntryCompliance({
      settings: allOff,
      candidate,
      entries: existing,
    });
    expect(off.findings).toEqual([]);
    expect(off.allowed).toBe(true);
  });

  it("kun den regel der er i block-tilstand blokerer", () => {
    const candidate = { date: addDays(MON, 4), hours: 14 };
    const r = evaluateEntryCompliance({
      settings: { rule48h: "block", dailyRest: "warn", weeklyRest: "block" },
      candidate,
      entries: existing,
    });
    expect(r.allowed).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it("13 t på en dag er tilladt (grænsen er > 13)", () => {
    const r = evaluateEntryCompliance({
      settings: allBlock,
      candidate: { date: addDays(MON, 4), hours: 13 },
      entries: existing,
    });
    expect(r.findings).toEqual([]);
  });

  it("selvtilrettelæggere (§2) er undtaget", () => {
    const r = evaluateEntryCompliance({
      settings: allBlock,
      isSelfScheduler: true,
      candidate: { date: MON, hours: 20 },
      entries: [],
    });
    expect(r.allowed).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("11 t hvile med klokkeslæt: sen aften + tidlig morgen", () => {
    const entries: DatedTimeEntry[] = [
      { date: MON, hours: 8, startTime: at(MON, 14), endTime: at(MON, 22) },
    ];
    const tue = addDays(MON, 1);
    const r = evaluateEntryCompliance({
      settings: allBlock,
      candidate: {
        date: tue,
        hours: 8,
        startTime: at(tue, 6),
        endTime: at(tue, 14),
      },
      entries,
    });
    expect(r.allowed).toBe(false);
    expect(r.findings[0]).toMatchObject({
      rule: "daily_rest",
      date: tue,
      value: 8,
      limit: 11,
    });
    expect(r.blocked[0]).toContain("kun 8,0 t hvile");
  });

  it("48 t: ugen over 48 t giver advarsel, gennemsnittet blokerer", () => {
    // Én uge på 50 t: gennemsnittet (1 uge) er 50 → violation
    const r = evaluateEntryCompliance({
      settings: allBlock,
      candidate: { date: addDays(MON, 4), hours: 10 },
      entries: untimedWeek(MON, [10, 10, 10, 10, 0, 0, 0]),
    });
    expect(r.allowed).toBe(false);
    expect(r.findings.map((f) => f.rule)).toEqual(["48h"]);
    expect(r.findings[0].value).toBe(50);

    // Samme uge, men tre foregående uger à 30 t → gennemsnit 35 → kun
    // "ugen er over 48 t"-advarsel (aldrig blokerende). Fraværsuger ville
    // være neutrale (§ 4) og ikke trække gennemsnittet ned (#728).
    const lighter = [-21, -14, -7].flatMap((o) =>
      untimedWeek(addDays(MON, o), [6, 6, 6, 6, 6, 0, 0]),
    );
    const r2 = evaluateEntryCompliance({
      settings: allBlock,
      candidate: { date: addDays(MON, 4), hours: 10 },
      entries: [...lighter, ...untimedWeek(MON, [10, 10, 10, 10, 0, 0, 0])],
    });
    expect(r2.allowed).toBe(true);
    expect(r2.findings[0]).toMatchObject({
      rule: "48h",
      severity: "warning",
      value: 50,
    });
    expect(r2.warnings[0]).toContain("ugen er nu på 50,0 t");
  });

  it("24 t ugehvile uden klokkeslæt: 7 arbejdsdage, medmindre fravær", () => {
    const six = untimedWeek(MON, [7, 7, 7, 7, 7, 7, 0]);
    const r = evaluateEntryCompliance({
      settings: { rule48h: "off", dailyRest: "off", weeklyRest: "block" },
      candidate: { date: addDays(MON, 6), hours: 2 },
      entries: six,
    });
    expect(r.allowed).toBe(false);
    expect(r.findings[0]).toMatchObject({ rule: "weekly_rest", date: MON });

    const withAbsence = evaluateEntryCompliance({
      settings: { rule48h: "off", dailyRest: "off", weeklyRest: "block" },
      candidate: { date: addDays(MON, 6), hours: 2 },
      entries: six,
      absenceDates: [addDays(MON, 2)],
    });
    expect(withAbsence.findings).toEqual([]);
  });

  it("ugevurdering uden kandidat (indsend) finder alle dage i ugen", () => {
    const r = evaluateEntryCompliance({
      settings: allWarn,
      weekStart: MON,
      entries: untimedWeek(MON, [14, 7, 15, 7, 7, 0, 0]),
    });
    expect(r.findings.filter((f) => f.rule === "daily_rest")).toHaveLength(2);
    // Fund fra andre uger tages ikke med
    const r2 = evaluateEntryCompliance({
      settings: allWarn,
      weekStart: addDays(MON, 7),
      entries: untimedWeek(MON, [14, 7, 15, 7, 7, 0, 0]),
    });
    expect(r2.findings.filter((f) => f.rule === "daily_rest")).toHaveLength(0);
  });
});
