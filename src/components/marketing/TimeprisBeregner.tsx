"use client";

import { Calculator, Info } from "lucide-react";
import { useState } from "react";

export function TimeprisBeregner() {
  const [monthlyIncome, setMonthlyIncome] = useState(40000);
  const [hoursPerWeek, setHoursPerWeek] = useState(37);
  const [vacationWeeks, setVacationWeeks] = useState(5);
  const [monthlyExpenses, setMonthlyExpenses] = useState(5000);
  const [billablePercent, setBillablePercent] = useState(70);

  const workWeeksPerYear = 52 - vacationWeeks;
  const totalHoursPerYear = hoursPerWeek * workWeeksPerYear;
  const billableHoursPerYear = totalHoursPerYear * (billablePercent / 100);
  const yearlyNeed = (monthlyIncome + monthlyExpenses) * 12;
  const hourlyRateExMoms =
    billableHoursPerYear > 0 ? yearlyNeed / billableHoursPerYear : 0;
  const momsAmount = hourlyRateExMoms * 0.25;
  const hourlyRateInclMoms = hourlyRateExMoms + momsAmount;

  const formatDKK = (n: number) =>
    n.toLocaleString("da-DK", {
      style: "currency",
      currency: "DKK",
      maximumFractionDigits: 0,
    });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Input form */}
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Calculator className="h-5 w-5 text-brand-600" />
            Dine tal
          </h3>

          <div className="space-y-5">
            <div>
              <label
                htmlFor="tp-income"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Ønsket månedsløn (efter skat-tanke)
              </label>
              <div className="relative">
                <input
                  id="tp-income"
                  type="number"
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-16 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                  kr./md.
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="tp-hours"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Arbejdstimer pr. uge
              </label>
              <input
                id="tp-hours"
                type="number"
                value={hoursPerWeek}
                onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                min={1}
                max={80}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="tp-vacation"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Ferieuger pr. år
              </label>
              <input
                id="tp-vacation"
                type="number"
                value={vacationWeeks}
                onChange={(e) => setVacationWeeks(Number(e.target.value))}
                min={0}
                max={20}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="tp-expenses"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Månedlige udgifter (kontor, software, forsikring)
              </label>
              <div className="relative">
                <input
                  id="tp-expenses"
                  type="number"
                  value={monthlyExpenses}
                  onChange={(e) => setMonthlyExpenses(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-16 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                  kr./md.
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="tp-billable"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Fakturerbar tid (%)
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="tp-billable"
                  type="range"
                  value={billablePercent}
                  onChange={(e) => setBillablePercent(Number(e.target.value))}
                  min={10}
                  max={100}
                  step={5}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-brand-600"
                />
                <span className="min-w-[3rem] text-right tabular-nums text-sm font-medium text-slate-700">
                  {billablePercent}%
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Typisk 60-75% for freelancere. Resten går til admin, salg og
                pauser.
              </p>
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/50 p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-600">
              Din anbefalede timepris
            </h3>

            <div className="mb-6 text-center">
              <p className="text-4xl font-bold text-slate-900 sm:text-5xl">
                {formatDKK(hourlyRateExMoms)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                pr. time ekskl. moms
              </p>
            </div>

            <div className="space-y-3 border-t border-brand-200/60 pt-4">
              <div className="flex justify-between">
                <span className="text-sm text-slate-600">
                  Timepris inkl. moms (25%)
                </span>
                <span className="font-semibold text-slate-900">
                  {formatDKK(hourlyRateInclMoms)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-600">Moms pr. time</span>
                <span className="font-medium text-slate-700">
                  {formatDKK(momsAmount)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Beregningsgrundlag
            </h3>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex justify-between">
                <span>Arbejdsuger pr. år</span>
                <span className="font-medium text-slate-900">
                  {workWeeksPerYear}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Timer pr. år (total)</span>
                <span className="font-medium text-slate-900">
                  {totalHoursPerYear.toLocaleString("da-DK")}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Fakturerbare timer pr. år</span>
                <span className="font-medium text-slate-900">
                  {Math.round(billableHoursPerYear).toLocaleString("da-DK")}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Årligt indtægtsbehov</span>
                <span className="font-medium text-slate-900">
                  {formatDKK(yearlyNeed)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              Denne beregning er vejledende. Din reelle timepris afhænger også
              af branche, erfaring, efterspørgsel og konkurrence.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
