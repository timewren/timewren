"use client";

import { Flag, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function OnlineStopwatch() {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const startTimeRef = useRef<number>(0);
  const animationRef = useRef<number>(0);

  const updateTime = useCallback(() => {
    setElapsed(Date.now() - startTimeRef.current);
    animationRef.current = requestAnimationFrame(updateTime);
  }, []);

  const start = useCallback(() => {
    startTimeRef.current = Date.now() - elapsed;
    setIsRunning(true);
    animationRef.current = requestAnimationFrame(updateTime);
  }, [elapsed, updateTime]);

  const stop = useCallback(() => {
    setIsRunning(false);
    cancelAnimationFrame(animationRef.current);
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    cancelAnimationFrame(animationRef.current);
    setElapsed(0);
    setLaps([]);
  }, []);

  const lap = useCallback(() => {
    setLaps((prev) => [elapsed, ...prev]);
  }, [elapsed]);

  useEffect(() => {
    return () => cancelAnimationFrame(animationRef.current);
  }, []);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);

    return {
      hours: hours.toString().padStart(2, "0"),
      minutes: minutes.toString().padStart(2, "0"),
      seconds: seconds.toString().padStart(2, "0"),
      centiseconds: centiseconds.toString().padStart(2, "0"),
    };
  };

  const time = formatTime(elapsed);

  return (
    <div className="mx-auto max-w-2xl">
      {/* Time display */}
      <div className="mb-8 rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm sm:p-12">
        <div className="flex items-baseline justify-center tabular-nums">
          <span className="text-5xl font-bold text-slate-900 sm:text-7xl">
            {time.hours}
          </span>
          <span className="text-3xl font-bold text-slate-400 sm:text-5xl">
            :
          </span>
          <span className="text-5xl font-bold text-slate-900 sm:text-7xl">
            {time.minutes}
          </span>
          <span className="text-3xl font-bold text-slate-400 sm:text-5xl">
            :
          </span>
          <span className="text-5xl font-bold text-slate-900 sm:text-7xl">
            {time.seconds}
          </span>
          <span className="text-2xl font-medium text-slate-400 sm:text-3xl">
            .{time.centiseconds}
          </span>
        </div>

        {/* Controls */}
        <div className="mt-8 flex items-center justify-center gap-4">
          {!isRunning ? (
            <button
              type="button"
              onClick={start}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white shadow-lg transition-all hover:bg-green-700 hover:shadow-xl sm:h-16 sm:w-16"
              aria-label="Start stopur"
            >
              <Play className="h-6 w-6 sm:h-7 sm:w-7" />
            </button>
          ) : (
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-all hover:bg-red-700 hover:shadow-xl sm:h-16 sm:w-16"
              aria-label="Stop stopur"
            >
              <Pause className="h-6 w-6 sm:h-7 sm:w-7" />
            </button>
          )}

          {isRunning && (
            <button
              type="button"
              onClick={lap}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-brand-600 text-brand-600 transition-all hover:bg-brand-50 sm:h-16 sm:w-16"
              aria-label="Omgang"
            >
              <Flag className="h-6 w-6 sm:h-7 sm:w-7" />
            </button>
          )}

          {elapsed > 0 && !isRunning && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-300 text-slate-600 transition-all hover:bg-slate-50 sm:h-16 sm:w-16"
              aria-label="Nulstil stopur"
            >
              <RotateCcw className="h-6 w-6 sm:h-7 sm:w-7" />
            </button>
          )}
        </div>
      </div>

      {/* Laps */}
      {laps.length > 0 && (
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Omgange
          </h3>
          <div className="divide-y divide-slate-100">
            {laps.map((lapTime, index) => {
              const t = formatTime(lapTime);
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                  key={`${laps.length - index}`}
                  className="flex items-center justify-between py-2"
                >
                  <span className="text-sm font-medium text-slate-500">
                    Omgang {laps.length - index}
                  </span>
                  <span className="tabular-nums text-sm text-slate-900">
                    {t.hours}:{t.minutes}:{t.seconds}.{t.centiseconds}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
