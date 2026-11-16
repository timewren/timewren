import { describe, expect, it } from "vitest";
import {
  resolveHidePrepaidValue,
  sortUsageByDisplayDate,
  usageDisplayDate,
} from "./usage-view";

describe("usageDisplayDate", () => {
  it("bruger tidspostens dato, ikke hvornår trækket blev registreret", () => {
    const usage = {
      createdAt: new Date("2026-09-01T11:54:00Z"),
      timeEntry: { date: "2026-07-03" },
    };
    expect(usageDisplayDate(usage).toISOString().slice(0, 10)).toBe(
      "2026-07-03",
    );
  });

  it("falder tilbage til createdAt for manuelle træk uden tidspost", () => {
    const createdAt = new Date("2026-09-01T11:54:00Z");
    expect(usageDisplayDate({ createdAt, timeEntry: null }).getTime()).toBe(
      createdAt.getTime(),
    );
  });
});

describe("sortUsageByDisplayDate", () => {
  it("sorterer nyeste tidspost først selvom alle blev importeret samtidig", () => {
    const importedAt = new Date("2026-09-01T11:54:00Z");
    const input = [
      { id: "a", createdAt: importedAt, timeEntry: { date: "2026-07-03" } },
      { id: "b", createdAt: importedAt, timeEntry: { date: "2026-08-20" } },
      { id: "c", createdAt: importedAt, timeEntry: null },
      { id: "d", createdAt: importedAt, timeEntry: { date: "2026-08-05" } },
    ];
    const sorted = sortUsageByDisplayDate(input);
    expect(sorted.map((u) => u.id)).toEqual(["c", "b", "d", "a"]);
    // Muterer ikke input
    expect(input.map((u) => u.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("resolveHidePrepaidValue", () => {
  it("viser beløb som standard", () => {
    expect(resolveHidePrepaidValue(null, null)).toBe(false);
    expect(resolveHidePrepaidValue(undefined, undefined)).toBe(false);
  });

  it("følger brugerens globale standard når kunden arver", () => {
    expect(resolveHidePrepaidValue(null, true)).toBe(true);
    expect(resolveHidePrepaidValue(null, false)).toBe(false);
  });

  it("lader kundens valg vinde over den globale standard", () => {
    expect(resolveHidePrepaidValue(false, true)).toBe(false);
    expect(resolveHidePrepaidValue(true, false)).toBe(true);
  });
});
