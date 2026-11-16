import { describe, expect, it } from "vitest";
import { parseTaskText } from "@/lib/task-parser";
import {
  formatTaskMinutes,
  getTaskTimeProgress,
  parseEstimate,
} from "./time-progress";

describe("parseEstimate", () => {
  it.each([
    ["Design forside ~4t", 240, "Design forside"],
    ["Design forside 4t", 240, "Design forside"],
    ["Skriv tilbud 2 timer", 120, "Skriv tilbud"],
    ["Skriv tilbud 1 time", 60, "Skriv tilbud"],
    ["Review 1,5t", 90, "Review"],
    ["Review 1.5h", 90, "Review"],
    ["Ring til kunde 30 min", 30, "Ring til kunde"],
    ["Ring til kunde 20 minutter", 20, "Ring til kunde"],
    ["Opsætning 1t30m", 90, "Opsætning"],
    ["Opsætning 1t 30 min", 90, "Opsætning"],
    ["~3t ryd op i DNS", 180, "ryd op i DNS"],
    ["Fix bug 2t, haster", 120, "Fix bug, haster"],
  ])("%s → %i min", (text, minutes, rest) => {
    expect(parseEstimate(text)).toEqual({ minutes, rest });
  });

  it.each([
    "Ring til 2 kunder",
    "Køb 3 m stof",
    "Køb 5m kabel",
    "~4t",
    "Opdater Q4t-rapport",
    "Møde kl 14",
    "0t pause",
    "Projekt 1000t",
    "",
  ])("finder intet estimat i %j", (text) => {
    expect(parseEstimate(text)).toBeNull();
  });
});

describe("parseTaskText", () => {
  it("udtrækker estimat sammen med deadline og prioritet", () => {
    const parsed = parseTaskText("Design forside ~4t i morgen haster");
    expect(parsed.title).toBe("Design forside");
    expect(parsed.estimatedMinutes).toBe(240);
    expect(parsed.priority).toBe("high");
    expect(parsed.deadline).not.toBeNull();
  });

  it("giver null-estimat uden enhed", () => {
    expect(parseTaskText("Ring til 2 kunder").estimatedMinutes).toBeNull();
  });
});

describe("getTaskTimeProgress", () => {
  it("uden estimat: ingen procent eller status", () => {
    expect(getTaskTimeProgress(90, null)).toEqual({
      trackedMinutes: 90,
      estimatedMinutes: null,
      percentage: null,
      status: null,
    });
  });

  it("grøn under 80 %, gul fra 80 %, rød fra 100 %", () => {
    expect(getTaskTimeProgress(60, 120).status).toBe("green");
    expect(getTaskTimeProgress(96, 120).status).toBe("yellow");
    expect(getTaskTimeProgress(120, 120).status).toBe("red");
    expect(getTaskTimeProgress(210, 120)).toMatchObject({
      percentage: 175,
      status: "red",
    });
  });

  it("behandler manglende tid som 0", () => {
    expect(getTaskTimeProgress(undefined, 60)).toMatchObject({
      trackedMinutes: 0,
      percentage: 0,
      status: "green",
    });
  });
});

describe("formatTaskMinutes", () => {
  it.each([
    [0, "0m"],
    [45, "45m"],
    [60, "1t"],
    [90, "1,5t"],
    [100, "1,7t"],
    [180, "3t"],
  ])("%i → %s", (minutes, label) => {
    expect(formatTaskMinutes(minutes)).toBe(label);
  });
});
