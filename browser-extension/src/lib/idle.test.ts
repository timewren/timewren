import { describe, expect, it } from "vitest";
import {
  currentElapsedSeconds,
  decideIdleReturn,
  elapsedAtIdleStart,
  formatAway,
  measureAwaySeconds,
} from "./idle";

const IDLE_AT = new Date("2026-09-16T14:02:00Z").getTime();
const base = { thresholdMinutes: 5, autoPauseAfterMinutes: 120 };

describe("measureAwaySeconds", () => {
  it("måler faktisk fravær (14:02 → 14:25 = 23 min)", () => {
    const now = new Date("2026-09-16T14:25:00Z").getTime();
    expect(measureAwaySeconds(IDLE_AT, now)).toBe(23 * 60);
  });

  it("er 0 uden gemt idleDetectedAt — så der aldrig trækkes en fast tærskel", () => {
    expect(measureAwaySeconds(null, Date.now())).toBe(0);
  });
});

describe("decideIdleReturn", () => {
  it("skærmlås i 10 sekunder giver hverken dialog eller fradrag", () => {
    expect(
      decideIdleReturn({
        ...base,
        idleDetectedAtMs: IDLE_AT,
        nowMs: IDLE_AT + 10_000,
      }),
    ).toEqual({ action: "none", awaySeconds: 10 });
  });

  it("90 sekunders fravær med 1-minuts tærskel spørger om de 90 sekunder", () => {
    expect(
      decideIdleReturn({
        thresholdMinutes: 1,
        autoPauseAfterMinutes: 120,
        idleDetectedAtMs: IDLE_AT,
        nowMs: IDLE_AT + 90_000,
      }),
    ).toEqual({ action: "ask", awaySeconds: 90 });
  });

  it("spørger ikke når den anden klient har ryddet feltet", () => {
    expect(
      decideIdleReturn({ ...base, idleDetectedAtMs: null, nowMs: Date.now() }),
    ).toEqual({ action: "none", awaySeconds: 0 });
  });

  it("auto-pauser efter 2 timers stilstand", () => {
    expect(
      decideIdleReturn({
        ...base,
        idleDetectedAtMs: IDLE_AT,
        nowMs: IDLE_AT + 120 * 60_000,
      }),
    ).toEqual({ action: "auto-pause", awaySeconds: 120 * 60 });
  });

  it("auto-pauser aldrig når grænsen er slået fra", () => {
    expect(
      decideIdleReturn({
        ...base,
        autoPauseAfterMinutes: null,
        idleDetectedAtMs: IDLE_AT,
        nowMs: IDLE_AT + 8 * 60 * 60_000,
      }).action,
    ).toBe("ask");
  });
});

describe("elapsedAtIdleStart", () => {
  it("sætter elapsed tilbage til tidspunktet for inaktivitet", () => {
    expect(elapsedAtIdleStart(3 * 3600, 2 * 3600)).toBe(3600);
  });

  it("går aldrig under 0", () => {
    expect(elapsedAtIdleStart(120, 7200)).toBe(0);
  });
});

describe("currentElapsedSeconds", () => {
  it("lægger den løbende session oven i baseSeconds", () => {
    const now = IDLE_AT + 60_000;
    expect(
      currentElapsedSeconds(
        { startTime: new Date(IDLE_AT).toISOString(), baseSeconds: 600 },
        now,
      ),
    ).toBe(660);
  });

  it("bruger kun baseSeconds når timeren ikke kører", () => {
    expect(
      currentElapsedSeconds({ startTime: null, baseSeconds: 600 }, Date.now()),
    ).toBe(600);
  });
});

describe("formatAway", () => {
  it("formaterer minutter og timer på dansk", () => {
    expect(formatAway(23 * 60)).toBe("23 min");
    expect(formatAway(120 * 60)).toBe("2 t");
    expect(formatAway(125 * 60)).toBe("2 t 5 min");
  });
});
