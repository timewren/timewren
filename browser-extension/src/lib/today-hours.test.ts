import { describe, expect, it } from "vitest";
import { timerSecondsToday, todayHoursWithTimer } from "./today-hours";

const NOW = new Date(2026, 9, 26, 15, 0).getTime();

describe("todayHoursWithTimer", () => {
  it("lægger den kørende timer til de gemte timer", () => {
    const timer = {
      isRunning: true,
      startTime: new Date(NOW - 3 * 3600 * 1000).toISOString(),
      baseSeconds: 0,
    };
    expect(todayHoursWithTimer(0, timer, NOW)).toBeCloseTo(3);
    expect(todayHoursWithTimer(1.5, timer, NOW)).toBeCloseTo(4.5);
  });

  it("tæller pauset tid med, når pausen er fra i dag", () => {
    expect(
      todayHoursWithTimer(
        1,
        {
          isRunning: false,
          startTime: null,
          baseSeconds: 1800,
          elapsedSeconds: 1800,
          lastSyncedAt: new Date(NOW - 3600 * 1000).toISOString(),
        },
        NOW,
      ),
    ).toBeCloseTo(1.5);
  });

  it("uden timer eller midt i et stop tælles kun de gemte", () => {
    expect(todayHoursWithTimer(2, null, NOW)).toBe(2);
    expect(
      todayHoursWithTimer(
        2,
        {
          isRunning: true,
          startTime: new Date(NOW - 3600 * 1000).toISOString(),
          intent: "stopping",
        },
        NOW,
      ),
    ).toBe(2);
  });
});

describe("timerSecondsToday", () => {
  it("counts today's accumulated work after resume, including quick additions", () => {
    const timer = {
      isRunning: true,
      startTime: new Date(NOW - 3600 * 1000).toISOString(),
      sessionStartedAt: new Date(NOW - 4 * 3600 * 1000).toISOString(),
      baseSeconds: 2 * 3600 + 15 * 60,
    };
    expect(timerSecondsToday(timer, NOW)).toBe(3 * 3600 + 15 * 60);
    expect(todayHoursWithTimer(1, timer, NOW)).toBe(4.25);
    expect(timerSecondsToday({ ...timer, isRunning: false }, NOW)).toBe(8100);
  });

  it("does not attribute yesterday's accumulated work to today", () => {
    const timer = {
      isRunning: true,
      startTime: new Date(NOW - 3600 * 1000).toISOString(),
      sessionStartedAt: new Date(2026, 9, 25, 12).toISOString(),
      baseSeconds: 7200,
    };
    expect(timerSecondsToday(timer, NOW)).toBe(3600);
    expect(
      timerSecondsToday({ ...timer, sessionStartedAt: "invalid" }, NOW),
    ).toBe(3600);
  });

  const ONE_AM = new Date(2026, 9, 27, 1, 0).getTime();
  const at = (h: number, m = 0, day = 27) =>
    new Date(2026, 9, day, h, m).toISOString();

  it("en timer startet i går tæller kun tiden efter midnat", () => {
    const timer = { isRunning: true, startTime: at(22, 0, 26), baseSeconds: 0 };
    expect(timerSecondsToday(timer, ONE_AM)).toBe(3600);
    expect(timerSecondsToday({ ...timer, startTime: at(0, 30) }, ONE_AM)).toBe(
      1800,
    );
  });

  it("en timer sat på pause i går tæller ikke i dag", () => {
    const paused = {
      isRunning: false,
      startTime: null,
      baseSeconds: 4 * 3600,
      elapsedSeconds: 4 * 3600,
      lastSyncedAt: new Date(2026, 9, 25, 17, 0).toISOString(),
    };
    expect(timerSecondsToday(paused, NOW)).toBe(0);
  });

  it("en pause kort efter midnat tæller kun tiden efter midnat", () => {
    const paused = {
      isRunning: false,
      startTime: null,
      baseSeconds: 4 * 3600,
      lastSyncedAt: at(0, 30),
    };
    expect(timerSecondsToday(paused, ONE_AM)).toBe(1800);
  });

  it("en pauset timer uden tidspunkt for pausen tæller ikke", () => {
    expect(
      timerSecondsToday(
        { isRunning: false, startTime: null, baseSeconds: 4 * 3600 },
        NOW,
      ),
    ).toBe(0);
  });

  it("en genoptaget timer tæller kun stykket siden genoptag", () => {
    // Pauset i går med 4 t, genoptaget i dag kl. 14
    const resumed = {
      isRunning: true,
      startTime: new Date(NOW - 3600 * 1000).toISOString(),
      baseSeconds: 4 * 3600,
    };
    expect(timerSecondsToday(resumed, NOW)).toBe(3600);
  });

  it("uden timer er der intet", () => {
    expect(timerSecondsToday(null, NOW)).toBe(0);
  });
});
