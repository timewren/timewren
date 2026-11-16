import { afterEach, describe, expect, it, vi } from "vitest";
import { brandize } from "../brandize";

const messages = {
  a: "Velkommen til TimeTrack",
  nested: { b: "TimeTrack Cloud og TimeTrack Desktop", list: ["TimeTrack"] },
};

afterEach(() => vi.unstubAllEnvs());

describe("brandize", () => {
  it("bruger TimeWren som standard, men bevarer TimeTrack Cloud", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "");
    expect(brandize(messages)).toEqual({
      a: "Velkommen til TimeWren",
      nested: { b: "TimeTrack Cloud og TimeWren Desktop", list: ["TimeWren"] },
    });
  });

  it("lader teksten stå, når brandet er TimeTrack", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    expect(brandize(messages)).toBe(messages);
  });
});
