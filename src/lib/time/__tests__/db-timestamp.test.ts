import { describe, expect, it } from "vitest";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";

// Regression (2/10-2026): prod kører TZ=Europe/Copenhagen, og en nøgen
// timestamp-streng fra rå SQL blev læst som lokal tid → 2 timer for tidligt.
describe("parseDbTimestamp", () => {
  it("læser en nøgen timestamp-streng som UTC", () => {
    expect(parseDbTimestamp("2026-10-02 08:15:00.123")?.toISOString()).toBe(
      "2026-10-02T08:15:00.123Z",
    );
    expect(parseDbTimestamp("2026-10-02T08:15:00")?.toISOString()).toBe(
      "2026-10-02T08:15:00.000Z",
    );
  });

  it("respekterer en eksplicit zone eller offset", () => {
    expect(parseDbTimestamp("2026-10-02T08:15:00Z")?.toISOString()).toBe(
      "2026-10-02T08:15:00.000Z",
    );
    expect(parseDbTimestamp("2026-10-02 10:15:00+02")?.toISOString()).toBe(
      "2026-10-02T08:15:00.000Z",
    );
    expect(parseDbTimestamp("2026-10-02T10:15:00+02:00")?.toISOString()).toBe(
      "2026-10-02T08:15:00.000Z",
    );
  });

  it("giver Date videre og null for tomme værdier", () => {
    const d = new Date("2026-10-02T08:15:00Z");
    expect(parseDbTimestamp(d)).toBe(d);
    expect(parseDbTimestamp(null)).toBeNull();
    expect(parseDbTimestamp(undefined)).toBeNull();
    expect(parseDbTimestamp("")).toBeNull();
  });
});
