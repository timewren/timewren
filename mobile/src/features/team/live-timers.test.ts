import { runningSeconds } from './running-seconds';

describe('runningSeconds', () => {
  const now = new Date('2026-09-06T10:00:00Z').getTime();

  it('stoppet timer: returnerer serverens forløbne sekunder', () => {
    expect(runningSeconds({ isRunning: false, startTime: null, baseSeconds: 0, elapsedSeconds: 120 }, now)).toBe(120);
  });

  it('kørende timer: base + tid siden start', () => {
    const startTime = new Date(now - 90_000).toISOString();
    expect(runningSeconds({ isRunning: true, startTime, baseSeconds: 600, elapsedSeconds: 0 }, now)).toBe(690);
  });

  it('start i fremtiden (ur-skævhed) giver ikke negative sekunder', () => {
    const startTime = new Date(now + 5_000).toISOString();
    expect(runningSeconds({ isRunning: true, startTime, baseSeconds: 10, elapsedSeconds: 0 }, now)).toBe(10);
  });
});
