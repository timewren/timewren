"use client";

import { AlertTriangle, Calendar, Clock } from "lucide-react";
import { useMemo, useState } from "react";

function toLocalDateStr(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDanishDate(date: Date) {
  return date.toLocaleDateString("da-DK", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function countBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function weeksBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.ceil(ms / (7 * 24 * 60 * 60 * 1000));
}

export function ProjectDeadlineCalculator() {
  const [totalHours, setTotalHours] = useState(120);
  const [hoursPerWeek, setHoursPerWeek] = useState(20);
  const [startDate, setStartDate] = useState(toLocalDateStr(new Date()));
  const [bufferPercent, setBufferPercent] = useState(15);

  const result = useMemo(() => {
    if (totalHours <= 0 || hoursPerWeek <= 0) return null;

    const start = new Date(`${startDate}T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;

    const weeksNeeded = totalHours / hoursPerWeek;
    const totalCalendarDays = Math.ceil(weeksNeeded * 7);
    const endDate = new Date(start);
    endDate.setDate(endDate.getDate() + totalCalendarDays);

    const businessDays = countBusinessDays(start, endDate);
    const calendarWeeks = weeksBetween(start, endDate);

    // With buffer
    const bufferedHours = totalHours * (1 + bufferPercent / 100);
    const bufferedWeeks = bufferedHours / hoursPerWeek;
    const bufferedDays = Math.ceil(bufferedWeeks * 7);
    const bufferedEndDate = new Date(start);
    bufferedEndDate.setDate(bufferedEndDate.getDate() + bufferedDays);

    // Hours per day (assuming 5-day work week)
    const hoursPerDay = hoursPerWeek / 5;

    return {
      endDate,
      bufferedEndDate,
      businessDays,
      calendarWeeks,
      bufferedWeeks: weeksBetween(start, bufferedEndDate),
      hoursPerDay: Math.round(hoursPerDay * 10) / 10,
      bufferedHours: Math.round(bufferedHours),
    };
  }, [totalHours, hoursPerWeek, startDate, bufferPercent]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Input */}
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <h3 className="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Projektdetaljer
          </h3>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="totalHours"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Estimerede timer i alt
              </label>
              <input
                id="totalHours"
                type="number"
                min={1}
                value={totalHours}
                onChange={(e) => setTotalHours(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label
                htmlFor="hoursPerWeek"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Timer pr. uge
              </label>
              <input
                id="hoursPerWeek"
                type="number"
                min={1}
                max={80}
                value={hoursPerWeek}
                onChange={(e) => setHoursPerWeek(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label
                htmlFor="startDate"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Startdato
              </label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label
                htmlFor="buffer"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Buffer / uforudsete ({bufferPercent}%)
              </label>
              <input
                id="buffer"
                type="range"
                min={0}
                max={50}
                value={bufferPercent}
                onChange={(e) => setBufferPercent(Number(e.target.value))}
                className="w-full accent-brand-600"
              />
              <div className="mt-1 flex justify-between text-xs text-slate-400">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="space-y-6">
          {result ? (
            <>
              <div className="rounded-2xl border border-brand-200/60 bg-brand-50/50 p-6 shadow-sm">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium text-brand-600">
                  <Calendar className="h-4 w-4" />
                  Estimeret deadline
                </div>
                <p className="text-2xl font-bold text-slate-900">
                  {formatDanishDate(result.endDate)}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {result.calendarWeeks} kalenderuger &middot;{" "}
                  {result.businessDays} arbejdsdage
                </p>
              </div>

              {bufferPercent > 0 && (
                <div className="rounded-2xl border border-orange-200/60 bg-orange-50/50 p-6 shadow-sm">
                  <div className="mb-1 flex items-center gap-2 text-sm font-medium text-orange-600">
                    <AlertTriangle className="h-4 w-4" />
                    Med {bufferPercent}% buffer
                  </div>
                  <p className="text-2xl font-bold text-slate-900">
                    {formatDanishDate(result.bufferedEndDate)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {result.bufferedWeeks} kalenderuger &middot;{" "}
                    {result.bufferedHours} timer i alt
                  </p>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Detaljer
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Timer i alt</span>
                    <span className="font-semibold text-slate-900">
                      {totalHours} timer
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Timer pr. dag</span>
                    <span className="font-semibold text-slate-900">
                      {result.hoursPerDay} timer
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Timer pr. uge</span>
                    <span className="font-semibold text-slate-900">
                      {hoursPerWeek} timer
                    </span>
                  </div>
                  {bufferPercent > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        Buffer ({bufferPercent}%)
                      </span>
                      <span className="font-semibold text-orange-600">
                        +{result.bufferedHours - totalHours} timer
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <div className="text-center">
                <Clock className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                <p className="text-sm text-slate-400">
                  Udfyld felterne for at beregne deadline.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
