import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isDateStr } from "../copenhagen";
import {
  weekClosureDateStr,
  weekClosureKey,
  weekClosureStreak,
} from "../week-closure";

/**
 * Den gamle `closeWeek` gemte `parseLocalDateStr(weekStart)` +
 * `setHours(0, 0, 0, 0)` — lokal midnat i processens TZ. Køres her i en
 * separat Node-proces med den ønskede TZ, så testen viser hvad der faktisk
 * ligger i databasen fra før skiftet.
 */
function legacyStoredWeekStart(weekStart: string, tz: string): Date {
  const script = `const [y,m,d]=process.argv[1].split("-").map(Number);const dt=new Date(y,m-1,d);dt.setHours(0,0,0,0);process.stdout.write(dt.toISOString());`;
  const iso = execFileSync(process.execPath, ["-e", script, weekStart], {
    env: { ...process.env, TZ: tz },
  }).toString();
  return new Date(iso);
}

describe("weekClosureKey (#734)", () => {
  it("er UTC-midnat på mandagen uanset proces-TZ", () => {
    expect(weekClosureKey("2026-09-28").toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    expect(weekClosureKey("2026-12-28").toISOString()).toBe(
      "2026-12-28T00:00:00.000Z",
    );
  });

  it("matcher en ugeafslutning gemt mens prod kørte i UTC — også efter skift til Europe/Copenhagen", () => {
    for (const monday of ["2026-09-28", "2026-03-30", "2026-10-26"]) {
      const storedUnderUtc = legacyStoredWeekStart(monday, "UTC");
      // Opslaget (eq) i getWeekReview bruger weekClosureKey i den
      // nuværende proces-TZ (CI kører både UTC og Europe/Copenhagen)
      expect(weekClosureKey(monday).getTime()).toBe(storedUnderUtc.getTime());
      expect(weekClosureDateStr(storedUnderUtc)).toBe(monday);
    }
  });

  it("læser også rækker gemt ved dansk midnat som samme mandag", () => {
    const storedUnderCph = legacyStoredWeekStart(
      "2026-09-28",
      "Europe/Copenhagen",
    );
    expect(storedUnderCph.toISOString()).toBe("2026-09-27T22:00:00.000Z");
    expect(weekClosureDateStr(storedUnderCph)).toBe("2026-09-28");
    expect(weekClosureDateStr(new Date("2026-12-27T23:00:00Z"))).toBe(
      "2026-12-28",
    );
  });
});

describe("weekClosureStreak", () => {
  const key = weekClosureKey;

  it("tæller sammenhængende uger der ender i denne uge", () => {
    const closures = [key("2026-09-28"), key("2026-09-21"), key("2026-09-14")];
    expect(weekClosureStreak(closures, "2026-10-01")).toBe(3);
  });

  it("stopper ved et hul", () => {
    const closures = [key("2026-09-28"), key("2026-09-14")];
    expect(weekClosureStreak(closures, "2026-10-01")).toBe(1);
  });

  it("tæller når seneste lukning er sidste uge", () => {
    expect(weekClosureStreak([key("2026-09-21")], "2026-10-04")).toBe(1);
  });

  it("er 0 når seneste lukning er ældre end sidste uge", () => {
    expect(weekClosureStreak([key("2026-09-14")], "2026-10-01")).toBe(0);
    expect(weekClosureStreak([], "2026-10-01")).toBe(0);
  });

  it("bruger dansk dato — mandag kl. 00:30 dansk tid er ny uge", () => {
    // 2026-10-05 00:30 dansk = 2026-10-04T22:30Z; sidste uge = 28/9
    expect(weekClosureStreak([key("2026-09-28")], "2026-10-05")).toBe(1);
    expect(weekClosureStreak([key("2026-09-21")], "2026-10-05")).toBe(0);
  });

  it("blander gamle (dansk midnat) og nye (UTC-midnat) rækker over sommertidsskift", () => {
    const closures = [
      key("2026-11-02"),
      new Date("2026-10-25T23:00:00Z"), // mandag 26/10 ved dansk midnat (vintertid)
      new Date("2026-10-18T22:00:00Z"), // mandag 19/10 ved dansk midnat (sommertid)
    ];
    expect(weekClosureStreak(closures, "2026-11-03")).toBe(3);
  });
});

describe("isDateStr", () => {
  it("accepterer gyldige og afviser ugyldige datoer", () => {
    expect(isDateStr("2026-09-28")).toBe(true);
    expect(isDateStr("2026-02-30")).toBe(false);
    expect(isDateStr("2026-9-28")).toBe(false);
    expect(isDateStr("2026-09-28T00:00:00Z")).toBe(false);
  });
});
