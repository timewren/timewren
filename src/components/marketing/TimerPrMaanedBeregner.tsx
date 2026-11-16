"use client";

import { useId, useState } from "react";
import {
  averageMonthlyHours,
  formatHours,
  VACATION_DAYS,
  yearSummary,
} from "@/lib/marketing/workdays";

const PRESETS = [37, 32, 30, 25, 20];

/** Omregn ugetimer til timer pr. måned og år for et valgt år. */
export function TimerPrMaanedBeregner({ years }: { years: number[] }) {
  const id = useId();
  const [hoursPerWeek, setHoursPerWeek] = useState(37);
  const [year, setYear] = useState(years[0]);

  const valid = hoursPerWeek > 0 && hoursPerWeek <= 80;
  const summary = yearSummary(year, valid ? hoursPerWeek : 37);
  const perMonth = averageMonthlyHours(valid ? hoursPerWeek : 37);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`${id}-hours`}
            className="block text-sm font-medium text-gray-900"
          >
            Timer pr. uge
          </label>
          <input
            id={`${id}-hours`}
            type="number"
            inputMode="decimal"
            min={1}
            max={80}
            step={0.5}
            value={Number.isFinite(hoursPerWeek) ? hoursPerWeek : ""}
            onChange={(e) => setHoursPerWeek(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-lg tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setHoursPerWeek(p)}
                aria-pressed={hoursPerWeek === p}
                className={`rounded-lg px-3 py-1.5 text-sm tabular-nums transition-colors ${
                  hoursPerWeek === p
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {p} t
              </button>
            ))}
          </div>
          {!valid ? (
            <p className="mt-2 text-sm text-red-700">
              Skriv et tal mellem 1 og 80 timer.
            </p>
          ) : null}
        </div>
        <div>
          <label
            htmlFor={`${id}-year`}
            className="block text-sm font-medium text-gray-900"
          >
            År
          </label>
          <select
            id={`${id}-year`}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-lg focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <dl
        aria-live="polite"
        className="mt-8 grid gap-px overflow-hidden rounded-xl bg-gray-200 sm:grid-cols-3"
      >
        {[
          ["Timer i en gennemsnitsmåned", formatHours(perMonth)],
          [`Timer i ${year}`, formatHours(summary.hours)],
          [
            `Efter ${VACATION_DAYS} feriedage`,
            formatHours(summary.hoursAfterVacation),
          ],
        ].map(([label, value]) => (
          <div key={label} className="bg-white p-5">
            <dt className="text-sm text-gray-600">{label}</dt>
            <dd className="mt-1 text-3xl font-medium tabular-nums text-gray-900">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-gray-500">
        {year} har {summary.workdays} arbejdsdage, når de officielle helligdage
        er trukket fra.
      </p>
    </div>
  );
}
