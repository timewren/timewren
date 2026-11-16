import { afterEach, describe, expect, it, vi } from "vitest";
import { generateLicenseKey } from "@/lib/desktop-auth";

// Licensnøglen er selve adgangsbeviset, så den skal komme fra en
// kryptografisk kilde, ikke Math.random (#1103).
describe("generateLicenseKey", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("har formatet TT-XXXX-XXXX-XXXX-XXXX uden forvekslelige tegn", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateLicenseKey()).toMatch(
        /^TT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
      );
    }
  });

  it("bruger ikke Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    const a = generateLicenseKey();
    const b = generateLicenseKey();
    expect(spy).not.toHaveBeenCalled();
    expect(a).not.toBe(b);
  });
});
