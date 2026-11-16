type TimerLike = {
  isRunning: boolean;
  startTime: string | null;
  baseSeconds: number;
  elapsedSeconds: number;
};

/** Sekunder timeren har kørt lige nu — baseSeconds + tid siden start. Stoppet timer: serverens tal. */
export function runningSeconds(timer: TimerLike, now: number): number {
  if (!timer.isRunning || !timer.startTime)
    return timer.elapsedSeconds;
  const started = new Date(timer.startTime).getTime();
  return timer.baseSeconds + Math.max(0, Math.floor((now - started) / 1000));
}
