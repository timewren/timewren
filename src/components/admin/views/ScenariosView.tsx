"use client";

import { Calculator, Info, TrendingDown, TrendingUp } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc-provider";

function formatDKK(amount: number): string {
  return new Intl.NumberFormat("da-DK", {
    style: "currency",
    currency: "DKK",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("da-DK");
}

/**
 * Simulate monthly business evolution given a set of assumptions.
 *
 * Pure function — no side effects, easy to sanity-check in the UI.
 */
function simulate(params: {
  startCustomers: number;
  startMrrPerCustomer: number;
  priceChangePercent: number; // applied once at month 0
  monthlyChurnPercent: number;
  newCustomersPerMonth: number;
  horizonMonths: number;
}) {
  const {
    startCustomers,
    startMrrPerCustomer,
    priceChangePercent,
    monthlyChurnPercent,
    newCustomersPerMonth,
    horizonMonths,
  } = params;

  const pricePerCustomer = startMrrPerCustomer * (1 + priceChangePercent / 100);
  const churn = monthlyChurnPercent / 100;

  const months: {
    month: number;
    customers: number;
    mrr: number;
    cumulativeRevenue: number;
  }[] = [];

  let customers = startCustomers;
  let cumulative = 0;
  for (let m = 0; m <= horizonMonths; m++) {
    if (m > 0) {
      customers = customers * (1 - churn) + newCustomersPerMonth;
    }
    const mrr = customers * pricePerCustomer;
    cumulative += mrr;
    months.push({
      month: m,
      customers,
      mrr,
      cumulativeRevenue: cumulative,
    });
  }

  return {
    months,
    finalMrr: months[months.length - 1].mrr,
    finalArr: months[months.length - 1].mrr * 12,
    finalCustomers: months[months.length - 1].customers,
    cumulative12mo: months[Math.min(12, horizonMonths)]?.cumulativeRevenue ?? 0,
    pricePerCustomer,
  };
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  help,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  help?: string;
}) {
  const fid = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={`${fid}-f1`}
          className="text-sm font-medium text-gray-700"
        >
          {label}
        </label>
        <div className="flex items-baseline gap-1">
          <input
            id={`${fid}-f1`}
            type="number"
            value={value}
            onChange={(e) => onChange(Number(e.target.value) || 0)}
            step={step}
            className="w-20 rounded border border-gray-300 bg-white px-2 py-0.5 text-right text-sm font-mono text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {suffix && <span className="text-xs text-gray-500">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-brand-600"
      />
      {help && <p className="mt-1 text-xs text-gray-500">{help}</p>}
    </div>
  );
}

function KPI({
  label,
  baseline,
  scenario,
  format,
}: {
  label: string;
  baseline: number;
  scenario: number;
  format: (n: number) => string;
}) {
  const delta = scenario - baseline;
  const percent = baseline !== 0 ? (delta / baseline) * 100 : 0;
  const trendUp = delta > 0;
  const neutral = Math.abs(percent) < 0.5;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">
        {format(scenario)}
      </p>
      <div className="mt-1 flex items-center gap-1 text-xs">
        <span className="text-gray-400">vs baseline</span>
        {neutral ? (
          <span className="text-gray-500">—</span>
        ) : (
          <span
            className={`inline-flex items-center gap-0.5 font-medium ${
              trendUp ? "text-green-600" : "text-red-600"
            }`}
          >
            {trendUp ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {percent > 0 ? "+" : ""}
            {percent.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

export function ScenariosView() {
  const { data: finance } = trpc.admin.getFinanceOverview.useQuery();

  const baselineCustomers = finance?.counts.active ?? 1;
  const baselineMrr = finance?.mrrActual ?? 0;
  const baselineArpu =
    baselineCustomers > 0 ? baselineMrr / baselineCustomers : 99;
  const baselineChurn = finance?.churnRate ?? 2;

  const [priceChange, setPriceChange] = useState(0);
  const [churnChange, setChurnChange] = useState(0);
  const [newCustomers, setNewCustomers] = useState(2);
  const [horizon, setHorizon] = useState(12);

  const baseline = useMemo(
    () =>
      simulate({
        startCustomers: baselineCustomers,
        startMrrPerCustomer: baselineArpu,
        priceChangePercent: 0,
        monthlyChurnPercent: baselineChurn,
        newCustomersPerMonth: newCustomers,
        horizonMonths: horizon,
      }),
    [baselineCustomers, baselineArpu, baselineChurn, newCustomers, horizon],
  );

  const scenario = useMemo(
    () =>
      simulate({
        startCustomers: baselineCustomers,
        startMrrPerCustomer: baselineArpu,
        priceChangePercent: priceChange,
        monthlyChurnPercent: Math.max(0, baselineChurn + churnChange),
        newCustomersPerMonth: newCustomers,
        horizonMonths: horizon,
      }),
    [
      baselineCustomers,
      baselineArpu,
      baselineChurn,
      priceChange,
      churnChange,
      newCustomers,
      horizon,
    ],
  );

  // Scale chart visualization
  const maxMrr = Math.max(
    ...baseline.months.map((m) => m.mrr),
    ...scenario.months.map((m) => m.mrr),
    1,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-sm text-brand-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Baseline: <strong>{baselineCustomers} aktive kunder</strong> ·{" "}
          <strong>{formatDKK(baselineArpu)}/md ARPU</strong> ·{" "}
          <strong>{baselineChurn.toFixed(1)}% månedlig churn</strong> — hentet
          fra din aktuelle finance-status.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Controls */}
        <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Calculator className="h-4 w-4" /> Antagelser
          </h2>

          <Slider
            label="Prisændring"
            value={priceChange}
            onChange={setPriceChange}
            min={-50}
            max={100}
            step={1}
            suffix="%"
            help={`Ny ARPU: ${formatDKK(scenario.pricePerCustomer)}`}
          />

          <Slider
            label="Churn ændring"
            value={churnChange}
            onChange={setChurnChange}
            min={-5}
            max={10}
            step={0.1}
            suffix="pp"
            help={`Ny månedlig churn: ${Math.max(0, baselineChurn + churnChange).toFixed(1)}%`}
          />

          <Slider
            label="Nye kunder / måned"
            value={newCustomers}
            onChange={setNewCustomers}
            min={0}
            max={100}
            step={1}
          />

          <Slider
            label="Horisont"
            value={horizon}
            onChange={setHorizon}
            min={3}
            max={36}
            step={1}
            suffix="mdr"
          />
        </div>

        {/* Results */}
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <KPI
              label={`MRR om ${horizon}m`}
              baseline={baseline.finalMrr}
              scenario={scenario.finalMrr}
              format={formatDKK}
            />
            <KPI
              label={`ARR om ${horizon}m`}
              baseline={baseline.finalArr}
              scenario={scenario.finalArr}
              format={formatDKK}
            />
            <KPI
              label={`Kunder om ${horizon}m`}
              baseline={baseline.finalCustomers}
              scenario={scenario.finalCustomers}
              format={formatNumber}
            />
            <KPI
              label="Akk. omsætning 12m"
              baseline={baseline.cumulative12mo}
              scenario={scenario.cumulative12mo}
              format={formatDKK}
            />
          </div>

          {/* Chart */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">
              MRR-udvikling (baseline vs scenario)
            </h2>

            <div className="relative h-64">
              <svg
                viewBox={`0 0 ${(horizon + 1) * 20} 200`}
                preserveAspectRatio="none"
                className="h-full w-full"
                aria-label="MRR udvikling graf"
              >
                {/* Baseline line */}
                <polyline
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  points={baseline.months
                    .map(
                      (m) => `${m.month * 20},${200 - (m.mrr / maxMrr) * 180}`,
                    )
                    .join(" ")}
                />
                {/* Scenario line */}
                <polyline
                  fill="none"
                  stroke="#1e5b47"
                  strokeWidth="2.5"
                  points={scenario.months
                    .map(
                      (m) => `${m.month * 20},${200 - (m.mrr / maxMrr) * 180}`,
                    )
                    .join(" ")}
                />
              </svg>
            </div>

            <div className="mt-3 flex items-center gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 border-t-2 border-dashed border-gray-400" />
                Baseline
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 border-t-2 border-brand-600" />
                Scenario
              </span>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            <p className="font-medium text-gray-900">Opsummering</p>
            <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
              <li>
                Startpunkt: {baselineCustomers} kunder ·{" "}
                {formatDKK(baselineMrr)} MRR
              </li>
              <li>
                Efter {horizon} mdr:{" "}
                <strong>{formatNumber(scenario.finalCustomers)} kunder</strong>{" "}
                · <strong>{formatDKK(scenario.finalMrr)} MRR</strong>
              </li>
              <li>
                Forskel fra baseline:{" "}
                {scenario.finalMrr - baseline.finalMrr >= 0 ? "+" : ""}
                {formatDKK(scenario.finalMrr - baseline.finalMrr)} MRR
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
