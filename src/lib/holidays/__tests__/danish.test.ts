import { describe, expect, it } from "vitest";
import {
  createDayOffLookup,
  DEFAULT_DAY_OFF_CONFIG,
  danishPublicHolidays,
  daysOffForYear,
  daysOffInRange,
  easterSunday,
  isPayrollHoliday,
  normalizeDayOffConfig,
  optionalDayDate,
  workShareOn,
} from "../danish";

describe("easterSunday", () => {
  it.each([
    [2019, "2019-04-21"],
    [2023, "2023-04-09"],
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2028, "2028-04-16"],
    [2029, "2029-04-01"],
    [2030, "2030-04-21"],
    [2038, "2038-04-25"], // senest mulige
    [2285, "2285-03-22"], // tidligst mulige
  ])("%i → %s", (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

function byName(year: number): Record<string, string> {
  return Object.fromEntries(
    danishPublicHolidays(year).map((h) => [h.name, h.date]),
  );
}

describe("danishPublicHolidays", () => {
  it("2027: de bevægelige helligdage følger påsken", () => {
    expect(byName(2027)).toEqual({
      Nytårsdag: "2027-01-01",
      Skærtorsdag: "2027-03-25",
      Langfredag: "2027-03-26",
      Påskedag: "2027-03-28",
      "2. påskedag": "2027-03-29",
      "Kristi himmelfartsdag": "2027-05-06",
      Pinsedag: "2027-05-16",
      "2. pinsedag": "2027-05-17",
      Juledag: "2027-12-25",
      "2. juledag": "2027-12-26",
    });
  });

  it("2029 og 2030", () => {
    expect(byName(2029)).toMatchObject({
      Skærtorsdag: "2029-03-29",
      Langfredag: "2029-03-30",
      "2. påskedag": "2029-04-02",
      "Kristi himmelfartsdag": "2029-05-10",
      "2. pinsedag": "2029-05-21",
    });
    expect(byName(2030)).toMatchObject({
      Skærtorsdag: "2030-04-18",
      Langfredag: "2030-04-19",
      "2. påskedag": "2030-04-22",
      "Kristi himmelfartsdag": "2030-05-30",
      "2. pinsedag": "2030-06-10",
    });
  });

  it("store bededag findes til og med 2023 og er afskaffet fra 2024", () => {
    expect(byName(2023)["Store bededag"]).toBe("2023-05-05");
    for (const year of [2024, 2025, 2026, 2027, 2028, 2029, 2030]) {
      const holidays = danishPublicHolidays(year);
      expect(holidays).toHaveLength(10);
      expect(holidays.some((h) => h.name === "Store bededag")).toBe(false);
    }
  });

  it("er sorteret efter dato", () => {
    const dates = danishPublicHolidays(2028).map((h) => h.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe("forudindstillinger", () => {
  it("almindelig privat virksomhed: kun helligdagene som standard", () => {
    const days = daysOffForYear(DEFAULT_DAY_OFF_CONFIG, 2026);
    expect(days.map((d) => d.date)).not.toContain("2026-12-24");
    expect(days.map((d) => d.date)).not.toContain("2026-06-05");
    expect(days.every((d) => d.source === "public" && !d.isHalfDay)).toBe(true);
  });

  it("OK24: halv 1. maj og grundlovsdag, hel juleaften og nytårsaften", () => {
    const lookup = createDayOffLookup(
      normalizeDayOffConfig({ preset: "ok24" }),
    );
    expect(lookup("2027-05-01")).toMatchObject({ isHalfDay: true });
    expect(lookup("2027-06-05")).toMatchObject({
      name: "Grundlovsdag",
      isHalfDay: true,
    });
    expect(lookup("2027-03-27")).toMatchObject({
      name: "Påskelørdag",
      isHalfDay: false,
    });
    expect(lookup("2027-12-24")).toMatchObject({ isHalfDay: false });
    expect(lookup("2027-12-31")).toMatchObject({ isHalfDay: false });
    expect(lookup("2027-05-07")).toBeNull(); // fredag efter himmelfart
  });

  it("valgfri dage kan overstyre forudindstillingen", () => {
    const config = normalizeDayOffConfig({
      preset: "private",
      optionalDays: { christmasEve: "full", dayAfterAscension: "full" },
    });
    expect(config.optionalDays.christmasEve).toBe("full");
    expect(config.optionalDays.may1).toBe("work");
    const lookup = createDayOffLookup(config);
    expect(lookup("2026-12-24")?.name).toBe("Juleaftensdag");
    expect(lookup("2026-05-15")?.name).toBe("Fredag efter Kristi himmelfart");
  });

  it("fredag efter Kristi himmelfart er dagen efter himmelfart", () => {
    for (const year of [2026, 2027, 2028, 2029, 2030]) {
      const ascension = byName(year)["Kristi himmelfartsdag"];
      const friday = optionalDayDate("dayAfterAscension", year);
      expect(friday > ascension).toBe(true);
      expect(new Date(`${friday}T12:00:00Z`).getUTCDay()).toBe(5);
    }
  });

  it("hel helligdag vinder over halv valgfri dag på samme dato (2028)", () => {
    // 2. pinsedag 2028 falder på grundlovsdag
    const lookup = createDayOffLookup(
      normalizeDayOffConfig({ preset: "ok24" }),
    );
    expect(lookup("2028-06-05")).toMatchObject({
      name: "2. pinsedag",
      isHalfDay: false,
    });
  });
});

describe("egne fridage", () => {
  const config = normalizeDayOffConfig({
    preset: "private",
    customDays: [
      { date: "2026-08-14", name: "Sommerfest", isHalfDay: true },
      { date: "2026-02-30", name: "Ugyldig", isHalfDay: false },
      { date: "2026-12-23", name: "", isHalfDay: false },
      "skrald",
    ],
  });

  it("ugyldige datoer springes over, tomt navn bliver 'Fridag'", () => {
    expect(config.customDays).toEqual([
      { date: "2026-08-14", name: "Sommerfest", isHalfDay: true },
      { date: "2026-12-23", name: "Fridag", isHalfDay: false },
    ]);
  });

  it("indgår i opslag og interval", () => {
    const lookup = createDayOffLookup(config, [
      { date: "2026-08-14", name: "Ældre liste", isHalfDay: false },
    ]);
    // ekstra (ældre) hel fridag vinder over den halve egne fridag
    expect(lookup("2026-08-14")).toMatchObject({ isHalfDay: false });
    expect(
      daysOffInRange(lookup, "2026-12-20", "2026-12-31").map((d) => d.date),
    ).toEqual(["2026-12-23", "2026-12-25", "2026-12-26"]);
  });

  it("workShareOn: 1 / 0,5 / 0", () => {
    const lookup = createDayOffLookup(config);
    expect(workShareOn(lookup, "2026-08-13")).toBe(1);
    expect(workShareOn(lookup, "2026-08-14")).toBe(0.5);
    expect(workShareOn(lookup, "2026-12-25")).toBe(0);
  });
});

describe("normalizeDayOffConfig", () => {
  it("ukendt preset og skrald giver standardkonfigurationen", () => {
    expect(
      normalizeDayOffConfig({
        preset: "org-a",
        optionalDays: ["x"],
        customDays: "nej",
      }),
    ).toEqual(DEFAULT_DAY_OFF_CONFIG);
  });
});

describe("isPayrollHoliday (#742)", () => {
  // Løn-"helligdag": de lovbestemte helligdage + de valgfri dage, som
  // kalenderen udtrykkeligt giver fri (overenskomstens fridage). Egne
  // firmafridage er ikke helligdage i lønnen.
  const lookup = createDayOffLookup(
    normalizeDayOffConfig({
      preset: "ok24",
      customDays: [
        { date: "2026-08-14", name: "Sommerfest", isHalfDay: false },
      ],
    }),
    [{ date: "2026-10-09", name: "Ældre firmadag", isHalfDay: false }],
  );

  it("officielle helligdage tæller", () => {
    expect(isPayrollHoliday(lookup("2026-04-03"))).toBe(true); // langfredag
    expect(isPayrollHoliday(lookup("2026-12-25"))).toBe(true);
  });

  it("valgfri dage tæller, når kalenderen giver fri (hel eller halv)", () => {
    expect(isPayrollHoliday(lookup("2026-12-24"))).toBe(true);
    expect(isPayrollHoliday(lookup("2026-06-05"))).toBe(true); // halv
  });

  it("valgfri dage, der er arbejdsdage, tæller ikke", () => {
    const priv = createDayOffLookup(DEFAULT_DAY_OFF_CONFIG);
    expect(isPayrollHoliday(priv("2026-12-24"))).toBe(false);
  });

  it("egne fridage og den ældre liste tæller ikke", () => {
    expect(lookup("2026-08-14")).not.toBeNull();
    expect(isPayrollHoliday(lookup("2026-08-14"))).toBe(false);
    expect(isPayrollHoliday(lookup("2026-10-09"))).toBe(false);
  });

  it("egen heldag oven på en halv valgfri dag forbliver løn-helligdag", () => {
    const ok24 = createDayOffLookup(
      normalizeDayOffConfig({
        preset: "ok24",
        customDays: [
          { date: "2026-05-01", name: "Hel 1. maj", isHalfDay: false },
        ],
      }),
    );
    expect(ok24("2026-05-01")?.isHalfDay).toBe(false);
    expect(isPayrollHoliday(ok24("2026-05-01"))).toBe(true);
  });

  it("almindelig dag er ikke helligdag", () => {
    expect(isPayrollHoliday(lookup("2026-03-03"))).toBe(false);
    expect(isPayrollHoliday(null)).toBe(false);
  });
});
