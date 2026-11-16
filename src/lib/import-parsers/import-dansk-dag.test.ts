import { describe, expect, it } from "vitest";
import { parseDanishDate } from "@/lib/csv-parser";
import {
  localDateToEntryDate,
  localWallClockAsCopenhagen,
} from "@/lib/time/copenhagen";
import { parseClockifyCSV } from "./clockify";
import { parseFlexDate } from "./date-parser";
import { parseHarvestCSV } from "./harvest";
import { parseTogglCSV } from "./toggl";

/**
 * CSV-importerne på den danske dag (#650-klassen).
 *
 * Parserne bygger lokale datoer (`new Date(y, m - 1, d)`, `setHours`), og
 * importen i integrations.ts gør dem til lagringsværdier med
 * `localDateToEntryDate` (UTC-midnat på dagen) og `localWallClockAsCopenhagen`
 * (klokkeslættet som dansk vægur). Testene kører i CI både med TZ=UTC og
 * TZ=Europe/Copenhagen og læser kun UTC-værdier, så kæden skal give samme
 * resultat i begge.
 */

const stored = (d: Date | null | undefined) =>
  d ? localDateToEntryDate(d).toISOString() : null;
const instant = (d: Date | null | undefined) =>
  d ? localWallClockAsCopenhagen(d).toISOString() : null;

describe("parseFlexDate", () => {
  it("giver den skrevne kalenderdag som lagringsværdi", () => {
    expect(stored(parseFlexDate("2026-07-16", "YYYY-MM-DD"))).toBe(
      "2026-07-16T00:00:00.000Z",
    );
    expect(stored(parseFlexDate("16.07.2026", "DD.MM.YYYY"))).toBe(
      "2026-07-16T00:00:00.000Z",
    );
    expect(stored(parseFlexDate("07/16/2026", "MM/DD/YYYY"))).toBe(
      "2026-07-16T00:00:00.000Z",
    );
    expect(stored(parseFlexDate("2026-01-16", "YYYY-MM-DD"))).toBe(
      "2026-01-16T00:00:00.000Z",
    );
  });

  it("afviser en dag der ikke findes i stedet for at rulle stille over", () => {
    expect(parseFlexDate("2026-02-31", "YYYY-MM-DD")).toBeNull();
    expect(parseFlexDate("31.02.2026", "DD.MM.YYYY")).toBeNull();
    expect(parseFlexDate("2026-04-31", "YYYY-MM-DD")).toBeNull();
  });

  it("afviser stadig formateringsfejl og tal uden for kalenderen", () => {
    expect(parseFlexDate("2026-13-01", "YYYY-MM-DD")).toBeNull();
    expect(parseFlexDate("ikke en dato", "YYYY-MM-DD")).toBeNull();
  });
});

describe("parseDanishDate", () => {
  it("giver den skrevne kalenderdag som lagringsværdi", () => {
    expect(stored(parseDanishDate("16.07.2026"))).toBe(
      "2026-07-16T00:00:00.000Z",
    );
  });

  it("afviser en dag der ikke findes", () => {
    expect(parseDanishDate("31.02.2026")).toBeNull();
  });
});

const TOGGL_HEADER =
  "Client,Project,Description,Task,Tags,Start date,Start time,End date,End time,Duration,Billable";

describe("parseTogglCSV", () => {
  it("læser Start/End time som dansk vægur (sommertid)", () => {
    const csv = [
      TOGGL_HEADER,
      "Acme,Website,Arbejde,Task,,2026-07-16,09:00:00,2026-07-16,17:00:00,08:00:00,yes",
    ].join("\n");
    const [entry] = parseTogglCSV(csv, "YYYY-MM-DD");
    expect(stored(entry.date)).toBe("2026-07-16T00:00:00.000Z");
    expect(instant(entry.startTime)).toBe("2026-07-16T07:00:00.000Z");
    expect(instant(entry.endTime)).toBe("2026-07-16T15:00:00.000Z");
  });

  it("læser vintertid og DST-skiftet 29. marts 2026", () => {
    const csv = [
      TOGGL_HEADER,
      "Acme,Website,Vinter,Task,,2026-01-16,09:00:00,2026-01-16,17:00:00,08:00:00,yes",
      "Acme,Website,Skift,Task,,2026-03-29,09:00:00,2026-03-29,17:00:00,08:00:00,yes",
    ].join("\n");
    const [winter, shift] = parseTogglCSV(csv, "YYYY-MM-DD");
    expect(instant(winter.startTime)).toBe("2026-01-16T08:00:00.000Z");
    expect(instant(shift.startTime)).toBe("2026-03-29T07:00:00.000Z");
    expect(stored(shift.date)).toBe("2026-03-29T00:00:00.000Z");
  });
});

describe("parseClockifyCSV", () => {
  it("giver dagen og klokkeslættet på dansk tid", () => {
    const csv = [
      "Client,Project,Description,Task,Tags,Start Date,Start Time,End Date,End Time,Duration (decimal),Billable Rate (DKK),Billable",
      "Acme,Website,Opsætning,Deploy,dev,2026-07-16,09:00:00,2026-07-16,17:30:00,8.5,850,yes",
    ].join("\n");
    const [entry] = parseClockifyCSV(csv, "YYYY-MM-DD");
    expect(stored(entry.date)).toBe("2026-07-16T00:00:00.000Z");
    expect(instant(entry.startTime)).toBe("2026-07-16T07:00:00.000Z");
    expect(instant(entry.endTime)).toBe("2026-07-16T15:30:00.000Z");
  });
});

describe("parseHarvestCSV", () => {
  it("giver den skrevne kalenderdag som lagringsværdi", () => {
    const csv = [
      "Client,Project,Task,Notes,Hours,Date,Billable?,Invoiced?,Billable Rate,External Reference URL",
      "Acme,Website,Deploy,,8,2026-07-16,yes,no,850,https://harvestapp.com/x",
    ].join("\n");
    const [entry] = parseHarvestCSV(csv);
    expect(stored(entry.date)).toBe("2026-07-16T00:00:00.000Z");
  });
});
