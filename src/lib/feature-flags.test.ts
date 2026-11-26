import { describe, expect, it } from "vitest";
import { featureFlagDefault, resolveFeatureFlags } from "./feature-flags";

describe("resolveFeatureFlags", () => {
  it("slår Klippekort til på en ny installation uden rækker", () => {
    expect(resolveFeatureFlags([]).prepaidPackages).toBe(true);
  });

  it("lader øvrige flag uden række være slået fra som før", () => {
    const flags = resolveFeatureFlags([]);
    expect(flags.calendar ?? false).toBe(false);
    expect(flags.systemAiKey ?? false).toBe(false);
  });

  it("lader en administrators valg vinde over standarden", () => {
    const flags = resolveFeatureFlags([
      { key: "prepaidPackages", enabled: false },
      { key: "calendar", enabled: true },
    ]);
    expect(flags.prepaidPackages).toBe(false);
    expect(flags.calendar).toBe(true);
  });

  it("giver admin-listen standarden for et flag uden række", () => {
    expect(featureFlagDefault("prepaidPackages")).toBe(true);
    expect(featureFlagDefault("ai")).toBe(false);
  });
});
