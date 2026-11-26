import { describe, expect, it } from "vitest";
import {
  decideDedupedStart,
  isOwnLandedStart,
  isStillStopTarget,
  startNeverLanded,
} from "../web-session";

describe("isStillStopTarget (#1333)", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("med kendt id afgør id'et", () => {
    const target = { sessionId: A, sessionStartTime: 1000 };
    expect(
      isStillStopTarget(target, { sessionId: A, sessionStartTime: 1000 }),
    ).toBe(true);
    expect(
      isStillStopTarget(target, { sessionId: B, sessionStartTime: 1000 }),
    ).toBe(false);
    // Nulstillet af afstemningen, før B er adopteret
    expect(
      isStillStopTarget(target, { sessionId: null, sessionStartTime: null }),
    ).toBe(false);
  });

  it("uden id: samme start, og et id lært imens er claimets", () => {
    const target = { sessionId: null, sessionStartTime: 1000 };
    expect(
      isStillStopTarget(target, { sessionId: null, sessionStartTime: 1000 }),
    ).toBe(true);
    expect(
      isStillStopTarget(target, { sessionId: A, sessionStartTime: 1000 }, A),
    ).toBe(true);
    expect(
      isStillStopTarget(target, { sessionId: B, sessionStartTime: 1000 }, A),
    ).toBe(false);
    expect(
      isStillStopTarget(target, { sessionId: null, sessionStartTime: 2000 }),
    ).toBe(false);
  });
});

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
