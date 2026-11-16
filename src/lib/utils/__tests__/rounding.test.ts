import { describe, expect, it } from "vitest";
import { resolveRoundingConfig, roundHours } from "../rounding";

describe("roundHours", () => {
  it("rounds up to nearest 15 minutes", () => {
    expect(roundHours(1.38, { enabled: true, minutes: 15, method: "up" })).toBe(
      1.5,
    );
  });

  it("rounds down to nearest 15 minutes", () => {
    expect(
      roundHours(1.38, { enabled: true, minutes: 15, method: "down" }),
    ).toBe(1.25);
  });

  it("rounds to nearest 15 minutes", () => {
    expect(
      roundHours(1.38, { enabled: true, minutes: 15, method: "nearest" }),
    ).toBe(1.5);
    expect(
      roundHours(1.3, { enabled: true, minutes: 15, method: "nearest" }),
    ).toBe(1.25);
  });

  it("rounds up to nearest 30 minutes", () => {
    expect(roundHours(1.1, { enabled: true, minutes: 30, method: "up" })).toBe(
      1.5,
    );
  });

  it("rounds up to nearest 5 minutes", () => {
    expect(roundHours(0.18, { enabled: true, minutes: 5, method: "up" })).toBe(
      0.25,
    );
  });

  it("returns original when rounding disabled", () => {
    expect(
      roundHours(1.38, { enabled: false, minutes: 15, method: "up" }),
    ).toBe(1.38);
  });

  it("returns original when config is null", () => {
    expect(roundHours(1.38, null)).toBe(1.38);
  });

  it("never returns 0 for positive input when rounding up", () => {
    expect(roundHours(0.01, { enabled: true, minutes: 60, method: "up" })).toBe(
      1,
    );
  });
});

describe("resolveRoundingConfig", () => {
  const userConfig = {
    roundingEnabled: true,
    roundingMinutes: 15,
    roundingMethod: "up" as const,
  };
  const clientConfig = {
    roundingEnabled: true,
    roundingMinutes: 30,
    roundingMethod: "nearest" as const,
  };
  const projectConfig = {
    roundingEnabled: true,
    roundingMinutes: 5,
    roundingMethod: "down" as const,
  };
  const nullConfig = {
    roundingEnabled: null,
    roundingMinutes: null,
    roundingMethod: null,
  };

  it("uses project config when set", () => {
    const result = resolveRoundingConfig(
      userConfig,
      clientConfig,
      projectConfig,
    );
    expect(result).toEqual({ enabled: true, minutes: 5, method: "down" });
  });

  it("falls back to client when project is null", () => {
    const result = resolveRoundingConfig(userConfig, clientConfig, nullConfig);
    expect(result).toEqual({ enabled: true, minutes: 30, method: "nearest" });
  });

  it("falls back to user when client and project are null", () => {
    const result = resolveRoundingConfig(userConfig, nullConfig, nullConfig);
    expect(result).toEqual({ enabled: true, minutes: 15, method: "up" });
  });

  it("returns null when everything is null", () => {
    const result = resolveRoundingConfig(nullConfig, nullConfig, nullConfig);
    expect(result).toBeNull();
  });

  it("returns config with enabled false when user has rounding disabled", () => {
    const result = resolveRoundingConfig(
      { roundingEnabled: false, roundingMinutes: 15, roundingMethod: "up" },
      nullConfig,
      nullConfig,
    );
    expect(result).toEqual({ enabled: false, minutes: 15, method: "up" });
  });
});
