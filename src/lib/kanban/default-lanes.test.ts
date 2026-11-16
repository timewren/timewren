import { describe, expect, it } from "vitest";
import {
  GENERAL_DEFAULT_LANES,
  mapLegacyStatusToLaneName,
  PROJECT_DEFAULT_LANES,
} from "./default-lanes";

describe("default lane catalogs", () => {
  it("general defaults: Backlog, Todo, I gang, Afsluttet", () => {
    expect(GENERAL_DEFAULT_LANES.map((l) => l.name)).toEqual([
      "Backlog",
      "Todo",
      "I gang",
      "Afsluttet",
    ]);
  });

  it("general defaults have ascending order starting at 0", () => {
    expect(GENERAL_DEFAULT_LANES.map((l) => l.order)).toEqual([0, 1, 2, 3]);
  });

  it("only 'Afsluttet' is archive on general defaults", () => {
    const archives = GENERAL_DEFAULT_LANES.filter((l) => l.isArchive);
    expect(archives).toHaveLength(1);
    expect(archives[0].name).toBe("Afsluttet");
  });

  it("project defaults: Todo, I gang, Afsluttet — no Backlog", () => {
    expect(PROJECT_DEFAULT_LANES.map((l) => l.name)).toEqual([
      "Todo",
      "I gang",
      "Afsluttet",
    ]);
  });

  it("project defaults have ascending order starting at 0", () => {
    expect(PROJECT_DEFAULT_LANES.map((l) => l.order)).toEqual([0, 1, 2]);
  });

  it("all lane colors are valid 7-char hex", () => {
    const all = [...GENERAL_DEFAULT_LANES, ...PROJECT_DEFAULT_LANES];
    for (const lane of all) {
      expect(lane.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("mapLegacyStatusToLaneName", () => {
  it.each([
    ["backlog", "Backlog"],
    ["todo", "Todo"],
    ["in_progress", "I gang"],
    ["done", "Afsluttet"],
  ])("%s → %s", (legacy, danish) => {
    expect(mapLegacyStatusToLaneName(legacy)).toBe(danish);
  });

  it("returns null for unknown status", () => {
    expect(mapLegacyStatusToLaneName("cancelled")).toBeNull();
  });
});
