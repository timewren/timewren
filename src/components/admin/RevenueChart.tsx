"use client";

import {
  ChevronLeft,
  ChevronRight,
  Crown,
  DollarSign,
  Percent,
  Receipt,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { AdminStatCard } from "@/components/admin";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

function formatDkk(amount: number): string {
  return amount.toLocaleString("da-DK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Inline SVG line chart for forecasts
function ForecastChart({
  optimistic,
  baseline,
  pessimistic,
}: {
  optimistic: { month: string; mrr: number }[];
  baseline: { month: string; mrr: number }[];
  pessimistic: { month: string; mrr: number }[];
}) {
  if (baseline.length === 0) return null;
  const allValues = [
    ...optimistic.map((d) => d.mrr),
    ...baseline.map((d) => d.mrr),
    ...pessimistic.map((d) => d.mrr),
  ];
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;
  const w = 700,
    h = 300;
  const pad = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  function toPoints(data: { mrr: number }[]): string {
    return data
      .map((d, i) => {
        const x = pad.left + (i / (data.length - 1)) * chartW;
        const y = pad.top + chartH - ((d.mrr - minVal) / range) * chartH;
        return `${x},${y}`;
      })
      .join(" ");
  }

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    value: minVal + pct * range,
    y: pad.top + chartH - pct * chartH,
  }));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" aria-label="MRR prognose">
      {yLabels.map((l) => (
        <line
          key={l.y}
          x1={pad.left}
          y1={l.y}
          x2={w - pad.right}
          y2={l.y}
          stroke="currentColor"
          className="text-gray-200"
          strokeDasharray="4"
        />
      ))}
      {yLabels.map((l) => (
        <text
          key={`label-${l.y}`}
          x={pad.left - 8}
          y={l.y + 4}
          textAnchor="end"
          className="fill-gray-500"
          fontSize="11"
        >
          {formatDkk(Math.round(l.value))}
        </text>
      ))}
      {baseline.map((d, i) => {
        if (i % 2 !== 0 && baseline.length > 6) return null;
        const x = pad.left + (i / (baseline.length - 1)) * chartW;
        return (
          <text
            key={d.month}
            x={x}
            y={h - 8}
            textAnchor="middle"
            className="fill-gray-500"
            fontSize="10"
          >
            {d.month.slice(5)}
          </text>
        );
      })}
      <polyline
        points={toPoints(optimistic)}
        fill="none"
        stroke="#22c55e"
        strokeWidth="2"
        strokeDasharray="6 3"
      />
      <polyline
        points={toPoints(baseline)}
        fill="none"
        stroke="#1e5b47"
        strokeWidth="2.5"
      />
      <polyline
        points={toPoints(pessimistic)}
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeDasharray="6 3"
      />
    </svg>
  );
}

interface RevenueChartProps {
  type: "accrual" | "forecasts" | "bookkeeping";
}

export function RevenueChart({ type }: RevenueChartProps) {
  const [accrualYear, setAccrualYear] = useState(new Date().getFullYear());

  const { data: accrual, isLoading: loadingAccrual } =
    trpc.admin.getAccrualSchedule.useQuery(
      { year: accrualYear },
      { enabled: type === "accrual" },
    );
  const { data: forecasts, isLoading: loadingForecasts } =
    trpc.admin.getRevenueForecasts.useQuery(
      { monthsForward: 12 },
      { enabled: type === "forecasts" },
    );
  const { data: bookkeeping, isLoading: loadingBookkeeping } =
    trpc.admin.getBookkeepingGuide.useQuery(undefined, {
      enabled: type === "bookkeeping",
    });

  const loading =
    type === "accrual"
      ? loadingAccrual
      : type === "forecasts"
        ? loadingForecasts
        : loadingBookkeeping;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <InlineSpinner className="h-8 w-8" />
      </div>
    );
  }

  /* ======== Accrual ======== */
  if (type === "accrual" && accrual) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setAccrualYear((y) => y - 1)}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-xl font-bold text-gray-900">{accrualYear}</span>
          <button
            type="button"
            onClick={() => setAccrualYear((y) => y + 1)}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AdminStatCard
            label="Total realiseret"
            value={`${formatDkk(accrual.summary.totalRecognized)} kr`}
            icon={DollarSign}
            color="green"
          />
          <AdminStatCard
            label="Total udskudt"
            value={`${formatDkk(accrual.summary.totalDeferred)} kr`}
            icon={Receipt}
            color="amber"
          />
          <AdminStatCard
            label="Total cash inflow"
            value={`${formatDkk(accrual.summary.totalCash)} kr`}
            icon={Wallet}
            color="blue"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-2 font-medium text-gray-500">Maaned</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Aarlig period.
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Maanedlig
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Total
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Udskudt
                </th>
              </tr>
            </thead>
            <tbody>
              {accrual.months.map((m) => (
                <tr key={m.month} className="border-b border-gray-100">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {m.month}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-900">
                    {formatDkk(m.yearlyRecognized)} kr
                  </td>
                  <td className="px-4 py-2 text-right text-gray-900">
                    {formatDkk(m.monthlyRecognized)} kr
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-900">
                    {formatDkk(m.total)} kr
                  </td>
                  <td className="px-4 py-2 text-right text-amber-600">
                    {formatDkk(m.deferredRevenue)} kr
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ======== Forecasts ======== */
  if (type === "forecasts" && forecasts) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Nuvaerende MRR</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {formatDkk(forecasts.currentMrr)} kr
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Gns. maanedlig churn</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {forecasts.avgMonthlyChurnRate}%
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Gns. nye subs/md</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {forecasts.avgMonthlyNewSubs}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-6 text-sm">
            <div className="flex items-center gap-1.5">
              <div
                className="h-0.5 w-6 bg-green-500"
                style={{ borderTop: "2px dashed #22c55e" }}
              />
              <span className="text-gray-600">Optimistisk</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-0.5 w-6 bg-brand-500" />
              <span className="text-gray-600">Baseline</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="h-0.5 w-6 bg-red-500"
                style={{ borderTop: "2px dashed #ef4444" }}
              />
              <span className="text-gray-600">Pessimistisk</span>
            </div>
          </div>
          <ForecastChart
            optimistic={forecasts.scenarios.optimistic}
            baseline={forecasts.scenarios.baseline}
            pessimistic={forecasts.scenarios.pessimistic}
          />
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Milepael (baseline)
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {forecasts.milestones.map((m) => (
              <div
                key={m.target}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <p className="text-sm text-gray-500">
                  {formatDkk(m.target)} kr MRR
                </p>
                <p className="mt-1 text-lg font-bold text-gray-900">
                  {m.month || "Ikke inden for prognose"}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Baseline-prognose
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2 font-medium text-gray-500">
                    Maaned
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">
                    MRR
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">
                    ARR
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">
                    Abonnenter
                  </th>
                </tr>
              </thead>
              <tbody>
                {forecasts.scenarios.baseline.map((m) => (
                  <tr key={m.month} className="border-b border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">
                      {m.month}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-900">
                      {formatDkk(m.mrr)} kr
                    </td>
                    <td className="px-4 py-2 text-right text-gray-900">
                      {formatDkk(m.arr)} kr
                    </td>
                    <td className="px-4 py-2 text-right text-gray-900">
                      {m.subscribers}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  /* ======== Bookkeeping ======== */
  if (type === "bookkeeping" && bookkeeping) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Kontoplan
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2 font-medium text-gray-500">Konto</th>
                  <th className="px-4 py-2 font-medium text-gray-500">Navn</th>
                  <th className="px-4 py-2 font-medium text-gray-500">
                    Beskrivelse
                  </th>
                </tr>
              </thead>
              <tbody>
                {bookkeeping.accounts.map((a) => (
                  <tr key={a.number} className="border-b border-gray-100">
                    <td className="px-4 py-2 font-mono font-bold text-gray-900">
                      {a.number}
                    </td>
                    <td className="px-4 py-2 text-gray-900">{a.name}</td>
                    <td className="px-4 py-2 text-gray-500">{a.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Founding member examples */}
        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            <Crown className="mb-0.5 mr-2 inline h-5 w-5 text-amber-500" />
            Founding member posteringer
          </h2>
          <div className="space-y-3">
            {bookkeeping.foundingExamples.map((ex) => (
              <div
                key={ex.tierKey}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">
                    {ex.label} ({ex.discountPercent}% rabat)
                  </h3>
                  {ex.freeMonths > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {ex.freeMonths} gratis mdr
                    </span>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-gray-500">Maanedlig</p>
                    <p className="font-bold text-gray-900">
                      {formatDkk(ex.monthlyPrice)} kr
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Aarlig</p>
                    <p className="font-bold text-gray-900">
                      {formatDkk(ex.yearlyPrice)} kr
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Mdr. periodisering</p>
                    <p className="font-bold text-gray-900">
                      {formatDkk(ex.monthlyRecognition)} kr
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Financial summary */}
        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Aarets finansielle noegletal ({bookkeeping.year})
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-500">
                Maanedlig cash (abonnementer)
              </p>
              <p className="text-xl font-bold text-gray-900">
                {formatDkk(bookkeeping.financials.monthlyCashPerMonth)} kr/md
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-500">Total cash inflow</p>
              <p className="text-xl font-bold text-green-600">
                {formatDkk(bookkeeping.financials.totalCashInflow)} kr
              </p>
            </div>
          </div>
        </div>

        {/* Discount loss */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-amber-600" />
            <h3 className="font-semibold text-amber-800">Samlet rabat-tab</h3>
          </div>
          <p className="mt-1 text-2xl font-bold text-amber-800">
            {formatDkk(bookkeeping.financials.totalDiscountLoss)} kr/aar
          </p>
        </div>

        {/* VAT info */}
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
          <h3 className="font-semibold text-brand-800">Momsvejledning</h3>
          <p className="mt-1 text-sm text-brand-700">
            Momssats: {bookkeeping.vatInfo.rate}%
          </p>
          <p className="mt-1 text-sm text-brand-700">
            {bookkeeping.vatInfo.description}
          </p>
        </div>
      </div>
    );
  }

  // Query finished loading but returned no data (empty response or error)
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-12 text-center">
      <p className="text-sm font-medium text-gray-700">Ingen data at vise</p>
      <p className="mt-1 text-xs text-gray-500">
        Der er ingen data tilgængelig for den valgte periode, eller
        forespørgslen fejlede.
      </p>
    </div>
  );
}
