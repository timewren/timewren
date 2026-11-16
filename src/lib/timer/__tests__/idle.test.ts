import { describe, expect, it } from "vitest";
import { awaySeconds, decideOnReturn, elapsedAtIdle } from "../idle";

const T14_02 = new Date("2026-09-16T14:02:00Z").getTime();

describe("awaySeconds", () => {
  it("måler det faktiske fravær, ikke en fast tærskel", () => {
    const now = new Date("2026-09-16T14:25:00Z").getTime();
    expect(awaySeconds(T14_02, now)).toBe(23 * 60);
  });

  it("er 0 uden registreret inaktivitet", () => {
    expect(awaySeconds(null, Date.now())).toBe(0);
  });

  it("er 0 ved ur-skæv negativ difference", () => {
    expect(awaySeconds(T14_02, T14_02 - 60_000)).toBe(0);
  });
});

describe("decideOnReturn", () => {
  const base = { thresholdMinutes: 5, autoPauseAfterMinutes: 120 };

  it("spørger med det målte fravær når tærsklen er passeret", () => {
    const now = new Date("2026-09-16T14:25:00Z").getTime();
    expect(
      decideOnReturn({ ...base, idleDetectedAtMs: T14_02, nowMs: now }),
    ).toEqual({ action: "ask", awaySeconds: 23 * 60 });
  });

  it("spørger ikke under tærsklen (skærmlås i 10 sekunder)", () => {
    const now = T14_02 + 10_000;
    expect(
      decideOnReturn({ ...base, idleDetectedAtMs: T14_02, nowMs: now }),
    ).toEqual({ action: "none", awaySeconds: 10 });
  });

  it("spørger ikke når feltet er ryddet af den anden klient", () => {
    expect(
      decideOnReturn({ ...base, idleDetectedAtMs: null, nowMs: Date.now() }),
    ).toEqual({ action: "none", awaySeconds: 0 });
  });

  it("auto-pauser først efter den hårde grænse", () => {
    const now = T14_02 + 120 * 60_000;
    expect(
      decideOnReturn({ ...base, idleDetectedAtMs: T14_02, nowMs: now }),
    ).toEqual({ action: "auto-pause", awaySeconds: 120 * 60 });
  });

  it("auto-pauser aldrig når grænsen er slået fra", () => {
    const now = T14_02 + 10 * 60 * 60_000;
    expect(
      decideOnReturn({
        ...base,
        autoPauseAfterMinutes: null,
        idleDetectedAtMs: T14_02,
        nowMs: now,
      }),
    ).toEqual({ action: "ask", awaySeconds: 10 * 60 * 60 });
  });
});

describe("elapsedAtIdle", () => {
  it("trækker det målte fravær fra elapsed", () => {
    expect(elapsedAtIdle(3600, 23 * 60)).toBe(2220);
  });

  it("går aldrig under 0", () => {
    expect(elapsedAtIdle(60, 300)).toBe(0);
  });
});
