import { describe, expect, it } from "vitest";
import {
  CALENDAR_PALETTE_SIZE,
  clientColorIndex,
  clientColorVar,
} from "./calendar-colors";

describe("clientColorVar", () => {
  it("intern tid (ingen kunde) bruger brandfarven", () => {
    expect(clientColorVar(null)).toBe("var(--tt-gran)");
  });

  it("samme kunde får altid samme farve fra den faste palet", () => {
    const id = "c0a8f1d2-1111-4222-8333-944455556666";
    expect(clientColorVar(id)).toBe(clientColorVar(id));
    expect(clientColorVar(id)).toMatch(/^var\(--tt-kal-[1-8]\)$/);
  });

  it("fordeler kunder over hele paletten", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(clientColorIndex(`kunde-${i}`));
    expect(seen.size).toBe(CALENDAR_PALETTE_SIZE);
    for (const n of seen) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(CALENDAR_PALETTE_SIZE);
    }
  });
});
