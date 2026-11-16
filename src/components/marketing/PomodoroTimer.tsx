"use client";

import { Pause, Play, RotateCcw, Settings, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "work" | "break" | "longBreak";

const PHASE_LABELS: Record<Phase, string> = {
  work: "Arbejde",
  break: "Pause",
  longBreak: "Lang pause",
};

const PHASE_COLORS: Record<Phase, { ring: string; text: string; bg: string }> =
  {
    work: {
      ring: "stroke-blue-500",
      text: "text-blue-600",
      bg: "bg-blue-50/50 border-blue-200/60",
    },
    break: {
      ring: "stroke-green-500",
      text: "text-green-600",
      bg: "bg-green-50/50 border-green-200/60",
    },
    longBreak: {
      ring: "stroke-purple-500",
      text: "text-purple-600",
      bg: "bg-purple-50/50 border-purple-200/60",
    },
  };

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 830;
    osc.type = "sine";
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.stop(ctx.currentTime + 0.8);

    // Second beep
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1000;
      osc2.type = "sine";
      gain2.gain.value = 0.3;
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc2.stop(ctx.currentTime + 0.8);
    }, 300);
  } catch {}
}

export function PomodoroTimer() {
  const [workMinutes, setWorkMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [longBreakMinutes, setLongBreakMinutes] = useState(15);
  const [sessionsBeforeLong, setSessionsBeforeLong] = useState(4);
  const [showSettings, setShowSettings] = useState(false);

  const [phase, setPhase] = useState<Phase>("work");
  const [isRunning, setIsRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(workMinutes * 60);
  const [completedSessions, setCompletedSessions] = useState(0);
  const [autoStart, setAutoStart] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const phaseDuration = useCallback(
    (p: Phase) => {
      if (p === "work") return workMinutes * 60;
      if (p === "break") return breakMinutes * 60;
      return longBreakMinutes * 60;
    },
    [workMinutes, breakMinutes, longBreakMinutes],
  );

  const nextPhase = useCallback(() => {
    playNotificationSound();

    if (phaseRef.current === "work") {
      const nextSessions = completedSessions + 1;
      setCompletedSessions(nextSessions);

      if (nextSessions % sessionsBeforeLong === 0) {
        setPhase("longBreak");
        setTimeLeft(longBreakMinutes * 60);
      } else {
        setPhase("break");
        setTimeLeft(breakMinutes * 60);
      }
    } else {
      setPhase("work");
      setTimeLeft(workMinutes * 60);
    }

    if (!autoStart) {
      setIsRunning(false);
    }
  }, [
    completedSessions,
    sessionsBeforeLong,
    workMinutes,
    breakMinutes,
    longBreakMinutes,
    autoStart,
  ]);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            nextPhase();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, nextPhase]);

  const toggle = () => setIsRunning((r) => !r);

  const reset = () => {
    setIsRunning(false);
    setPhase("work");
    setTimeLeft(workMinutes * 60);
    setCompletedSessions(0);
  };

  const skip = () => {
    setIsRunning(false);
    nextPhase();
  };

  // Update timeLeft when settings change and timer is stopped
  useEffect(() => {
    if (!isRunning) {
      setTimeLeft(phaseDuration(phase));
    }
  }, [phase, isRunning, phaseDuration]);

  const totalSeconds = phaseDuration(phase);
  const progress = totalSeconds > 0 ? (timeLeft / totalSeconds) * 100 : 0;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const colors = PHASE_COLORS[phase];

  const circumference = 2 * Math.PI * 120;

  return (
    <div className="mx-auto max-w-lg">
      {/* Main timer */}
      <div
        className={`rounded-2xl border p-8 shadow-sm transition-colors sm:p-12 ${colors.bg}`}
      >
        {/* Phase label */}
        <div className="mb-6 text-center">
          <span
            className={`inline-block rounded-full bg-white/80 px-4 py-1.5 text-sm font-semibold ${colors.text}`}
          >
            {PHASE_LABELS[phase]}
          </span>
        </div>

        {/* Progress ring + time */}
        <div className="relative mx-auto mb-8 flex h-64 w-64 items-center justify-center">
          <svg
            className="absolute inset-0 -rotate-90"
            viewBox="0 0 260 260"
            role="img"
            aria-label="Timer fremgang"
          >
            <circle
              cx="130"
              cy="130"
              r="120"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-white/60"
            />
            <circle
              cx="130"
              cy="130"
              r="120"
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress / 100)}
              className={`${colors.ring} transition-all duration-1000`}
            />
          </svg>
          <div className="z-10 text-center">
            <div
              className={`tabular-nums text-5xl font-bold sm:text-6xl ${colors.text}`}
            >
              {String(minutes).padStart(2, "0")}:
              {String(seconds).padStart(2, "0")}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={toggle}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all hover:shadow-xl sm:h-16 sm:w-16 ${
              phase === "work"
                ? "bg-brand-600 hover:bg-brand-700"
                : phase === "break"
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-purple-600 hover:bg-purple-700"
            }`}
            aria-label={isRunning ? "Pause" : "Start"}
          >
            {isRunning ? (
              <Pause className="h-6 w-6 sm:h-7 sm:w-7" />
            ) : (
              <Play className="h-6 w-6 sm:h-7 sm:w-7" />
            )}
          </button>

          <button
            type="button"
            onClick={skip}
            className="inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-300 text-slate-600 transition-all hover:bg-white sm:h-16 sm:w-16"
            aria-label="Spring over"
          >
            <SkipForward className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>

          <button
            type="button"
            onClick={reset}
            className="inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-300 text-slate-600 transition-all hover:bg-white sm:h-16 sm:w-16"
            aria-label="Nulstil"
          >
            <RotateCcw className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>
        </div>

        {/* Session counter */}
        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-1.5">
            {Array.from({ length: sessionsBeforeLong }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
                key={`session-dot-${i}`}
                className={`h-2.5 w-2.5 rounded-full transition-colors ${
                  i < completedSessions % sessionsBeforeLong ||
                  (
                    completedSessions > 0 &&
                      completedSessions % sessionsBeforeLong === 0 &&
                      phase !== "work"
                  )
                    ? phase === "work"
                      ? "bg-brand-500"
                      : phase === "break"
                        ? "bg-green-500"
                        : "bg-purple-500"
                    : "bg-white/60"
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {completedSessions} session{completedSessions !== 1 ? "s" : ""}{" "}
            gennemf&#248;rt
          </p>
        </div>
      </div>

      {/* Settings toggle */}
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <Settings className="h-4 w-4" />{" "}
          {showSettings ? "Skjul indstillinger" : "Indstillinger"}
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mt-4 rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="workMin"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Arbejde (min)
              </label>
              <input
                id="workMin"
                type="number"
                min={1}
                max={120}
                value={workMinutes}
                onChange={(e) =>
                  setWorkMinutes(
                    Math.max(1, Math.min(120, Number(e.target.value) || 1)),
                  )
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label
                htmlFor="breakMin"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Pause (min)
              </label>
              <input
                id="breakMin"
                type="number"
                min={1}
                max={60}
                value={breakMinutes}
                onChange={(e) =>
                  setBreakMinutes(
                    Math.max(1, Math.min(60, Number(e.target.value) || 1)),
                  )
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label
                htmlFor="longBreakMin"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Lang pause (min)
              </label>
              <input
                id="longBreakMin"
                type="number"
                min={1}
                max={60}
                value={longBreakMinutes}
                onChange={(e) =>
                  setLongBreakMinutes(
                    Math.max(1, Math.min(60, Number(e.target.value) || 1)),
                  )
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label
                htmlFor="sessionsBeforeLong"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Sessions f&#248;r lang pause
              </label>
              <input
                id="sessionsBeforeLong"
                type="number"
                min={2}
                max={10}
                value={sessionsBeforeLong}
                onChange={(e) =>
                  setSessionsBeforeLong(
                    Math.max(2, Math.min(10, Number(e.target.value) || 2)),
                  )
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => setAutoStart(e.target.checked)}
                className="rounded border-slate-300 accent-brand-600"
              />
              Start n&#230;ste session automatisk
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
