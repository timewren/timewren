import { describe, expect, it } from "vitest";
import { canPreviewRate, PREVIEW_RATE_MIN_HOURS } from "../preview-rate";

describe("canPreviewRate (#938)", () => {
  it("slukker for timetal under serverens minimum", () => {
    expect(canPreviewRate(0)).toBe(false);
    expect(canPreviewRate(10 / 3600)).toBe(false);
    expect(canPreviewRate(Number.NaN)).toBe(false);
  });

  it("tillader minimum og derover", () => {
    expect(canPreviewRate(PREVIEW_RATE_MIN_HOURS)).toBe(true);
    expect(canPreviewRate(0.5)).toBe(true);
  });
});
