"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function toLocalDateTimeStr(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

function getDefaultDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  d.setHours(17, 0, 0, 0);
  return d;
}

type TimeLeft = {
  total: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function calcTimeLeft(deadline: Date): TimeLeft {
  const total = Math.max(0, deadline.getTime() - Date.now());
  const seconds = Math.floor((total / 1000) % 60);
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  return { total, days, hours, minutes, seconds };
}

function urgencyColor(days: number, total: number): string {
  if (total <= 0) return "text-slate-400";
  if (days <= 1) return "text-red-600";
  if (days <= 3) return "text-orange-500";
  if (days <= 7) return "text-yellow-500";
  return "text-green-600";
}

function urgencyBg(days: number, total: number): string {
  if (total <= 0) return "border-slate-200";
  if (days <= 1) return "border-red-200 bg-red-50/30";
  if (days <= 3) return "border-orange-200 bg-orange-50/30";
  if (days <= 7) return "border-yellow-200 bg-yellow-50/30";
  return "border-green-200 bg-green-50/30";
}

function urgencyRingColor(days: number, total: number): string {
  if (total <= 0) return "stroke-slate-300";
  if (days <= 1) return "stroke-red-500";
  if (days <= 3) return "stroke-orange-500";
  if (days <= 7) return "stroke-yellow-500";
  return "stroke-green-500";
}

function TimeUnit({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="text-center">
      <div
        className={`tabular-nums text-4xl font-bold sm:text-6xl ${color} transition-colors`}
      >
        {String(value).padStart(2, "0")}
      </div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}

export function DeadlineCountdown() {
  const [projectName, setProjectName] = useState("Mit projekt");
  const [deadlineStr, setDeadlineStr] = useState(
    toLocalDateTimeStr(getDefaultDeadline()),
  );
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const deadline = useMemo(() => {
    const d = new Date(deadlineStr);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [deadlineStr]);

  const tick = useCallback(() => {
    if (!deadline) return;
    setTimeLeft(calcTimeLeft(deadline));
  }, [deadline]);

  useEffect(() => {
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tick]);

  const reset = () => {
    setDeadlineStr(toLocalDateTimeStr(getDefaultDeadline()));
    setProjectName("Mit projekt");
  };

  const color = timeLeft
    ? urgencyColor(timeLeft.days, timeLeft.total)
    : "text-slate-400";
  const bg = timeLeft
    ? urgencyBg(timeLeft.days, timeLeft.total)
    : "border-slate-200";
  const ringColor = timeLeft
    ? urgencyRingColor(timeLeft.days, timeLeft.total)
    : "stroke-slate-300";

  // Progress ring: fraction of time remaining within the current day
  const dayFraction = timeLeft
    ? ((timeLeft.hours * 3600 + timeLeft.minutes * 60 + timeLeft.seconds) /
        86400) *
      100
    : 0;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Settings */}
      <div className="mb-6 rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="projectName"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Projektnavn
            </label>
            <input
              id="projectName"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label
              htmlFor="deadline"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Deadline
            </label>
            <input
              id="deadline"
              type="datetime-local"
              value={deadlineStr}
              onChange={(e) => setDeadlineStr(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
      </div>

      {/* Countdown display */}
      <div
        className={`rounded-2xl border p-8 shadow-sm sm:p-12 ${bg} transition-colors`}
      >
        {projectName && (
          <p className="mb-6 text-center text-lg font-medium text-slate-700">
            {projectName}
          </p>
        )}

        {timeLeft && timeLeft.total > 0 ? (
          <>
            {/* Progress ring */}
            <div className="mx-auto mb-8 flex justify-center">
              <svg
                className="h-24 w-24 -rotate-90"
                viewBox="0 0 100 100"
                role="img"
                aria-label="Fremgangsindikator"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  className="text-slate-100"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 45}`}
                  strokeDashoffset={`${2 * Math.PI * 45 * (1 - dayFraction / 100)}`}
                  className={`${ringColor} transition-all`}
                />
              </svg>
            </div>

            <div className="flex items-center justify-center gap-3 sm:gap-6">
              <TimeUnit value={timeLeft.days} label="Dage" color={color} />
              <span
                className={`mt-[-16px] text-3xl font-light sm:text-5xl ${color}`}
              >
                :
              </span>
              <TimeUnit value={timeLeft.hours} label="Timer" color={color} />
              <span
                className={`mt-[-16px] text-3xl font-light sm:text-5xl ${color}`}
              >
                :
              </span>
              <TimeUnit
                value={timeLeft.minutes}
                label="Minutter"
                color={color}
              />
              <span
                className={`mt-[-16px] text-3xl font-light sm:text-5xl ${color}`}
              >
                :
              </span>
              <TimeUnit
                value={timeLeft.seconds}
                label="Sekunder"
                color={color}
              />
            </div>

            {/* Urgency label */}
            <div className="mt-6 text-center">
              {timeLeft.days <= 1 && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700">
                  Deadline er meget t&#230;t p&#229;!
                </span>
              )}
              {timeLeft.days > 1 && timeLeft.days <= 3 && (
                <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
                  Deadline n&#230;rmer sig
                </span>
              )}
              {timeLeft.days > 3 && timeLeft.days <= 7 && (
                <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-700">
                  Under en uge tilbage
                </span>
              )}
              {timeLeft.days > 7 && (
                <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                  God tid endnu
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-900">
              {timeLeft ? "Deadline er overskredet!" : "Ugyldig dato"}
            </p>
            {timeLeft && (
              <p className="mt-2 text-slate-500">
                Tiden er udl&#248;bet. Tid til at levere!
              </p>
            )}
          </div>
        )}
      </div>

      {/* Reset */}
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <RotateCcw className="h-4 w-4" /> Nulstil
        </button>
      </div>
    </div>
  );
}
