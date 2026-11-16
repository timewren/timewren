"use client";

import { Clock, Info } from "lucide-react";
import { useState } from "react";

export function ArbejdstimerBeregner() {
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  const [breakMinutes, setBreakMinutes] = useState(30);
  const [hourlyRate, setHourlyRate] = useState(0);

  const parseMinutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };

  const startMinutes = parseMinutes(startTime);
  const endMinutes = parseMinutes(endTime);
  const totalMinutesRaw =
    endMinutes >= startMinutes
      ? endMinutes - startMinutes
      : 24 * 60 - startMinutes + endMinutes; // overnight
  const totalMinutes = Math.max(0, totalMinutesRaw - breakMinutes);
  const totalHours = totalMinutes / 60;
  const weeklyHours = totalHours * 5;
  const monthlyHours = totalHours * 21.67; // avg working days per month

  const formatHM = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}t ${m.toString().padStart(2, "0")}m`;
  };

  const formatDecimal = (hours: number) =>
    hours.toLocaleString("da-DK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Input */}
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Clock className="h-5 w-5 text-brand-600" />
            Indtast tider
          </h3>

          <div className="space-y-5">
            <div>
              <label
                htmlFor="at-start"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Starttid
              </label>
              <input
                id="at-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="at-end"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Sluttid
              </label>
              <input
                id="at-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="at-break"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Pause (minutter)
              </label>
              <input
                id="at-break"
                type="number"
                value={breakMinutes}
                onChange={(e) =>
                  setBreakMinutes(Math.max(0, Number(e.target.value)))
                }
                min={0}
                max={480}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="at-rate"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Timepris (valgfrit)
              </label>
              <div className="relative">
                <input
                  id="at-rate"
                  type="number"
                  value={hourlyRate || ""}
                  onChange={(e) => setHourlyRate(Number(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-12 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                  kr/t
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/50 p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-600">
              Arbejdstimer i dag
            </h3>

            <div className="mb-2 text-center">
              <p className="text-4xl font-bold text-slate-900 sm:text-5xl">
                {formatHM(totalMinutes)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                = {formatDecimal(totalHours)} timer (decimal)
              </p>
            </div>

            {breakMinutes > 0 && (
              <p className="mt-3 text-center text-xs text-slate-500">
                {formatHM(totalMinutesRaw)} brutto &minus; {breakMinutes} min
                pause
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Omregnet
            </h3>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex justify-between">
                <span>Pr. uge (5 dage)</span>
                <span className="font-medium text-slate-900">
                  {formatDecimal(weeklyHours)} timer
                </span>
              </div>
              <div className="flex justify-between">
                <span>Pr. måned (gns.)</span>
                <span className="font-medium text-slate-900">
                  {formatDecimal(monthlyHours)} timer
                </span>
              </div>
              <div className="flex justify-between">
                <span>Pr. år (47 uger)</span>
                <span className="font-medium text-slate-900">
                  {formatDecimal(weeklyHours * 47)} timer
                </span>
              </div>
            </div>
          </div>

          {hourlyRate > 0 && (
            <div className="rounded-2xl border border-green-200 bg-green-50/50 p-6 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-600">
                Indtjening
              </h3>
              <div className="space-y-2 text-sm text-slate-600">
                <div className="flex justify-between">
                  <span>I dag</span>
                  <span className="font-semibold text-slate-900">
                    {(totalHours * hourlyRate).toLocaleString("da-DK", {
                      style: "currency",
                      currency: "DKK",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Pr. uge</span>
                  <span className="font-medium text-slate-900">
                    {(weeklyHours * hourlyRate).toLocaleString("da-DK", {
                      style: "currency",
                      currency: "DKK",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Pr. måned</span>
                  <span className="font-medium text-slate-900">
                    {(monthlyHours * hourlyRate).toLocaleString("da-DK", {
                      style: "currency",
                      currency: "DKK",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              Beregneren understøtter også natarbejde (f.eks. 22:00–06:00).
              Decimal-timer bruges typisk ved fakturering.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
