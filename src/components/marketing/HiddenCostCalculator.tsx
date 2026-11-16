"use client";

import Link from "next/link";
import { useState } from "react";
import { SUBSCRIPTION_PRICE_MONTHLY } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { calculateYearlyHiddenCost } from "@/lib/marketing/hidden-cost";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

interface HiddenCostCalculatorProps {
  defaultHourlyRate?: number;
  defaultUnbilledHours?: number;
  ctaHref?: string;
  ctaLabel?: string;
}

export function HiddenCostCalculator({
  defaultHourlyRate = 600,
  defaultUnbilledHours = 3,
  ctaHref = "/register?ref=hidden-cost-calc",
  ctaLabel = "Start gratis og se dine egne tal →",
}: HiddenCostCalculatorProps) {
  const [hourlyRate, setHourlyRate] = useState(defaultHourlyRate);
  const [unbilledHours, setUnbilledHours] = useState(defaultUnbilledHours);

  const yearlyLoss = calculateYearlyHiddenCost(hourlyRate, unbilledHours);

  const MONTHLY_SUBSCRIPTION_PRICE = SUBSCRIPTION_PRICE_MONTHLY; // kr
  const paybackMinutes = Math.max(
    1,
    Math.ceil((MONTHLY_SUBSCRIPTION_PRICE / hourlyRate) * 60),
  );

  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl bg-slate-50 p-8 shadow-xl ring-1 ring-slate-200 sm:p-12 dark:bg-slate-900 dark:ring-slate-800">
          <div className="mb-6 flex justify-center">
            <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-semibold tracking-wider text-red-700 dark:bg-red-950 dark:text-red-300">
              REGN DIT TAB UD
            </span>
          </div>

          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            Hvad koster den ufakturerede tid dig?
          </h2>
          <p className="mt-3 text-center text-slate-600 dark:text-slate-400">
            Juster skyderne og se dit eget tab.
          </p>

          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            <div>
              <label
                htmlFor="hidden-cost-rate"
                className="block text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400"
              >
                DIN TIMEPRIS
              </label>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {hourlyRate}
                </span>
                <span className="text-lg text-slate-500 dark:text-slate-400">
                  kr/t
                </span>
              </div>
              <input
                id="hidden-cost-rate"
                type="range"
                min={100}
                max={2000}
                step={50}
                value={hourlyRate}
                onChange={(e) => setHourlyRate(Number(e.target.value))}
                className="mt-3 w-full accent-brand-600"
                aria-valuetext={`${hourlyRate} kroner per time`}
              />
              <div className="mt-1 flex justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>100</span>
                <span>2000</span>
              </div>
            </div>

            <div>
              <label
                htmlFor="hidden-cost-hours"
                className="block text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400"
              >
                TIMER DU IKKE FAKTURERER
              </label>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {unbilledHours}
                </span>
                <span className="text-lg text-slate-500 dark:text-slate-400">
                  t/uge
                </span>
              </div>
              <input
                id="hidden-cost-hours"
                type="range"
                min={0}
                max={15}
                step={0.5}
                value={unbilledHours}
                onChange={(e) => setUnbilledHours(Number(e.target.value))}
                className="mt-3 w-full accent-brand-600"
                aria-valuetext={`${unbilledHours} timer per uge`}
              />
              <div className="mt-1 flex justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>0</span>
                <span>15</span>
              </div>
            </div>
          </div>

          <output className="mt-10 block rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
            <p className="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
              Pr. år taber du
            </p>
            <p className="mt-2 text-5xl font-bold tabular-nums text-red-600 sm:text-6xl dark:text-red-500">
              {formatCurrency(yearlyLoss)}
            </p>
          </output>

          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>
              Selvstændig koster {PLAN_PRICES.selvstaendig.price} ekskl. moms.
              Du tjener det hjem på
            </span>
            <strong className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
              {paybackMinutes}
            </strong>
            <span>{paybackMinutes === 1 ? "minut" : "minutter"}.</span>
          </div>

          <div className="mt-8 text-center">
            <Link
              href={ctaHref}
              className="inline-flex items-center justify-center rounded-xl bg-tt-gran px-8 py-4 text-base font-semibold text-tt-paa-gran shadow-lg transition hover:bg-tt-gran-moerk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {ctaLabel}
            </Link>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Intet betalingskort. Gratis at starte.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
