import { describe, expect, it } from "vitest";
import { formatShortDate, historyDateLabel } from "./date";

describe("formatShortDate", () => {
  it("giver kort dansk dato med punktum efter dag og forkortet måned", () => {
    expect(formatShortDate("2026-10-12")).toBe("12. okt.");
    expect(formatShortDate("2026-05-03")).toBe("3. maj");
    expect(formatShortDate(new Date(2026, 0, 9))).toBe("9. jan.");
  });

  it("tåler et fuldt ISO-tidspunkt og ugyldig tekst", () => {
    expect(formatShortDate("2026-10-12T23:30:00.000Z")).toBe("12. okt.");
    expect(formatShortDate("ikke en dato")).toBe("ikke en dato");
  });
});

describe("historyDateLabel", () => {
  // Torsdag 15. oktober 2026, middag lokal tid
  const now = new Date(2026, 9, 15, 12, 0, 0);

  it("siger I dag og I går med æøå", () => {
    expect(historyDateLabel("2026-10-15", now)).toBe("I dag");
    expect(historyDateLabel("2026-10-14", now)).toBe("I går");
  });

  it("bruger ugedagens navn i denne uge, også weekend", () => {
    expect(historyDateLabel("2026-10-12", now)).toBe("Mandag");
    expect(historyDateLabel("2026-10-17", now)).toBe("Lørdag");
    expect(historyDateLabel("2026-10-18", now)).toBe("Søndag");
  });

  it("bruger kort dato før denne uge", () => {
    expect(historyDateLabel("2026-10-11", now)).toBe("11. okt.");
    expect(historyDateLabel("2026-09-03", now)).toBe("3. sep.");
  });

  it("mandag: i går er søndag i sidste uge", () => {
    const monday = new Date(2026, 9, 12, 9, 0, 0);
    expect(historyDateLabel("2026-10-11", monday)).toBe("I går");
    expect(historyDateLabel("2026-10-10", monday)).toBe("10. okt.");
  });
});
