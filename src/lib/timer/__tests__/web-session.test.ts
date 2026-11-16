import { describe, expect, it } from "vitest";
import {
  decideDedupedStart,
  isOwnLandedStart,
  startNeverLanded,
} from "../web-session";

describe("isOwnLandedStart", () => {
  const local = Date.parse("2026-10-04T08:00:00.000Z");

  it("samme start (±1 s) er vores egen landede start", () => {
    expect(isOwnLandedStart("2026-10-04T08:00:00.000Z", local)).toBe(true);
    expect(isOwnLandedStart(local + 900, local)).toBe(true);
  });

  it("en anden start er en anden session", () => {
    expect(isOwnLandedStart("2026-10-04T08:00:02.000Z", local)).toBe(false);
    expect(isOwnLandedStart(null, local)).toBe(false);
    expect(isOwnLandedStart("2026-10-04T08:00:00.000Z", null)).toBe(false);
    expect(isOwnLandedStart("ikke en dato", local)).toBe(false);
  });
});

describe("decideDedupedStart (#786)", () => {
  it("kører startens session stadig, overtages den", () => {
    for (const status of ["running", "paused", "stopping"]) {
      expect(
        decideDedupedStart({
          sessionId: "s1",
          sessionStatus: status,
          sessionCurrent: true,
        }),
      ).toBe("adopt-own");
    }
  });

  it("er den gemt, kasseret eller afløst, droppes den lokale kopi", () => {
    expect(
      decideDedupedStart({
        sessionId: "s1",
        sessionStatus: "saved",
        sessionCurrent: false,
      }),
    ).toBe("drop-local");
    expect(
      decideDedupedStart({
        sessionId: "s1",
        sessionStatus: "running",
        sessionCurrent: false,
      }),
    ).toBe("drop-local");
    // Ældre afspilning uden kendt session
    expect(decideDedupedStart({ sessionId: null })).toBe("drop-local");
  });
});

describe("startNeverLanded (review P2-2)", () => {
  it("kun en afvisning hvor startnøglen ingen session fandt", () => {
    expect(
      startNeverLanded({ reason: "session_mismatch", startNeverLanded: true }),
    ).toBe(true);
    expect(
      startNeverLanded({ reason: "session_mismatch", startNeverLanded: false }),
    ).toBe(false);
    expect(startNeverLanded({ reason: "session_mismatch" })).toBe(false);
    expect(
      startNeverLanded({ reason: "version_mismatch", startNeverLanded: true }),
    ).toBe(false);
  });
});
