import { describe, expect, it } from "vitest";
import {
  type CoverageEntry,
  coverageToDate,
  datesInRange,
  expectedByDate,
  isBelowCoverageThreshold,
  isoWeekdayOf,
  periodRange,
  resolveWorkSchedule,
  scheduleFromWorkingDays,
  scheduleHoursFor,
  shiftPeriod,
  summarizeCoverage,
  todayInTimeZone,
  weeklyScheduleTotal,
  workingDaysOf,
} from "../coverage";

const entry = (p: Partial<CoverageEntry>): CoverageEntry => ({
  date: "2026-09-28",
  hours: 1,
  isBillable: true,
  clientId: null,
  clientName: null,
  ...p,
});

describe("ugeskema", () => {
  it("standard er 37 t fordelt på man-fre", () => {
    const s = scheduleFromWorkingDays(null);
    expect(s).toEqual({
      "1": 7.4,
      "2": 7.4,
      "3": 7.4,
      "4": 7.4,
      "5": 7.4,
      "6": 0,
      "7": 0,
    });
    expect(weeklyScheduleTotal(s)).toBe(37);
  });

  it("genbruger brugerens arbejdsdage når intet skema er gemt", () => {
    const s = resolveWorkSchedule(null, ["1", "2", "3", "4"]);
    expect(workingDaysOf(s)).toEqual(["1", "2", "3", "4"]);
    expect(weeklyScheduleTotal(s)).toBe(29.6);
  });

  it("gemt skema vinder og saneres", () => {
    const s = resolveWorkSchedule(
      { "1": 8, "2": "6.5", "3": -2, "4": 30, "5": "x", "6": 0 },
      ["1", "2", "3", "4", "5"],
    );
    expect(s).toEqual({
      "1": 8,
      "2": 6.5,
      "3": 0,
      "4": 24,
      "5": 0,
      "6": 0,
      "7": 0,
    });
  });
});

describe("datoer og perioder", () => {
  it("ISO-ugedag", () => {
    expect(isoWeekdayOf("2026-09-28")).toBe("1"); // mandag
    expect(isoWeekdayOf("2026-10-04")).toBe("7"); // søndag
  });

  it("uge er mandag-søndag, også fra en søndag", () => {
    expect(periodRange("week", "2026-10-04")).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
    });
  });

  it("måned og skudår", () => {
    expect(periodRange("month", "2028-02-15")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });

  it("forskyder perioder", () => {
    expect(shiftPeriod("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftPeriod("week", "2026-09-30", -1)).toBe("2026-09-23");
    expect(shiftPeriod("day", "2026-12-31", 1)).toBe("2027-01-01");
  });

  it("dagens dato følger Europe/Copenhagen, ikke UTC", () => {
    // 22:30 UTC 30/9 = 00:30 dansk sommertid 1/10
    expect(
      todayInTimeZone("Europe/Copenhagen", new Date("2026-09-30T22:30:00Z")),
    ).toBe("2026-10-01");
    expect(todayInTimeZone("Ugyldig/Zone", new Date("2026-09-30T10:00Z"))).toBe(
      "2026-09-30",
    );
  });

  it("helligdage ignoreres bevidst", () => {
    // Juledag 2026 er en fredag — tæller som normal arbejdsdag
    const hoursFor = scheduleHoursFor(scheduleFromWorkingDays(null));
    expect(hoursFor("2026-12-25")).toBe(7.4);
  });
});

describe("summarizeCoverage", () => {
  const week = periodRange("week", "2026-09-28");
  const expected = expectedByDate(
    datesInRange(week.start, week.end),
    scheduleHoursFor(scheduleFromWorkingDays(null)),
  );

  it("dækningsgrad, fordeling og pr. kunde inkl. intern tid", () => {
    const s = summarizeCoverage(
      [
        entry({ hours: 10, clientId: "a", clientName: "Kunde A" }),
        entry({
          hours: 6,
          isBillable: false,
          clientId: "a",
          clientName: "Kunde A",
        }),
        entry({ hours: 5, clientId: "b", clientName: "Kunde B" }),
        entry({ hours: 4, isBillable: false }), // intern tid
        entry({ hours: 2, isBillable: null, clientId: "b" }), // NULL = fakturerbar
      ],
      expected,
    );
    expect(s.expectedHours).toBe(37);
    expect(s.loggedHours).toBe(27);
    expect(s.billableHours).toBe(17);
    expect(s.nonBillableHours).toBe(10);
    expect(s.coveragePct).toBe(73);
    expect(s.billableSharePct).toBe(63);
    expect(s.nonBillablePerBillableHour).toBe(0.59);

    const a = s.clients.find((c) => c.clientId === "a");
    expect(a).toMatchObject({
      billableHours: 10,
      nonBillableHours: 6,
      totalHours: 16,
      nonBillablePerBillableHour: 0.6,
    });
    const internal = s.clients.find((c) => c.clientId === null);
    expect(internal).toMatchObject({
      clientName: "Intern tid",
      nonBillableHours: 4,
      nonBillablePerBillableHour: null,
    });
    expect(s.clients[0].clientId).toBe("a"); // sorteret efter tid
  });

  it("kan overstige 100 % og har komplette dag-rækker", () => {
    const s = summarizeCoverage([entry({ hours: 45 })], expected);
    expect(s.coveragePct).toBe(121.6);
    expect(s.days).toHaveLength(7);
    expect(s.days[0]).toMatchObject({ loggedHours: 45, coveragePct: 608.1 });
    expect(s.days[6]).toMatchObject({ expectedHours: 0, coveragePct: null });
  });

  it("ingen arbejdstid giver null i stedet for division med 0", () => {
    const s = summarizeCoverage(
      [entry({ date: "2026-10-03", hours: 2 })],
      new Map([["2026-10-03", 0]]),
    );
    expect(s.coveragePct).toBeNull();
    expect(s.loggedHours).toBe(2);
  });

  it("tom periode", () => {
    const s = summarizeCoverage([], expected);
    expect(s.coveragePct).toBe(0);
    expect(s.billableSharePct).toBeNull();
    expect(s.clients).toEqual([]);
  });
});

describe("coverageToDate", () => {
  it("tæller kun dage til og med i dag i en igangværende uge", () => {
    const week = periodRange("week", "2026-09-30");
    const s = summarizeCoverage(
      [
        entry({ date: "2026-09-28", hours: 7.4 }),
        entry({ date: "2026-09-29", hours: 7.4 }),
        entry({ date: "2026-09-30", hours: 3.7 }),
      ],
      expectedByDate(
        datesInRange(week.start, week.end),
        scheduleHoursFor(scheduleFromWorkingDays(null)),
      ),
    );
    expect(s.coveragePct).toBe(50); // 18,5 af 37
    expect(coverageToDate(s.days, "2026-09-30")).toEqual({
      expectedHours: 22.2,
      loggedHours: 18.5,
      coveragePct: 83.3,
    });
  });
});

describe("påmindelses-tærskel", () => {
  it("er slået fra uden tærskel (eksisterende adfærd)", () => {
    expect(isBelowCoverageThreshold(0, 7.4, null)).toBe(false);
  });
  it("udløses under tærsklen, ikke på den", () => {
    expect(isBelowCoverageThreshold(5.9, 7.4, 80)).toBe(true);
    expect(isBelowCoverageThreshold(5.92, 7.4, 80)).toBe(false);
  });
  it("aldrig på fridage", () => {
    expect(isBelowCoverageThreshold(0, 0, 80)).toBe(false);
  });
});
