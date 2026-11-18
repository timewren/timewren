"use client";

import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useIncludeTestAccounts } from "@/components/admin/TestAccountFilter";
import { trpc } from "@/providers/trpc-provider";

function formatDKK(amount: number): string {
  return new Intl.NumberFormat("da-DK", {
    style: "currency",
    currency: "DKK",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function DeltaBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
        <Minus className="h-3 w-3" />
        n/a
      </span>
    );
  }
  const positive = value > 0;
  const neutral = value === 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${
        neutral
          ? "bg-gray-100 text-gray-600"
          : positive
            ? "bg-green-100 text-green-800"
            : "bg-red-100 text-red-800"
      }`}
    >
      {neutral ? (
        <Minus className="h-3 w-3" />
      ) : positive ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {formatPercent(value)}
    </span>
  );
}

export function GrowthWidget() {
  const includeTestAccounts = useIncludeTestAccounts();
  const { data: finance, isLoading: financeLoading } =
    trpc.admin.getFinanceOverview.useQuery({ includeTestAccounts });
  const { data: trends, isLoading: trendsLoading } =
    trpc.admin.getRevenueTrends.useQuery({
      includeTestAccounts,
      monthsBack: 3,
    });

  const isLoading = financeLoading || trendsLoading;

  // Compute month-over-month change from revenue trends (field is `total`)
  let momChange: number | null = null;
  if (trends && trends.length >= 2) {
    const latest = Number(trends[trends.length - 1]?.total ?? 0);
    const previous = Number(trends[trends.length - 2]?.total ?? 0);
    if (previous > 0) {
      momChange = ((latest - previous) / previous) * 100;
    } else if (latest > 0) {
      momChange = 100;
    }
  }

  // Simple runway: if burn rate is unknown, just show MRR × 12 = ARR
  const arr = finance?.arr ?? 0;
  const mrr = finance?.mrrActual ?? 0;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="h-32 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  if (!finance) {
    return null;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">
            Revenue & Growth
          </h2>
        </div>
        <Link
          href="/admin/finance"
          className="text-xs text-brand-600 hover:text-brand-700"
        >
          Detaljer →
        </Link>
      </div>

      <div className="p-5">
        {/* Primary KPI row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              MRR
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className="text-2xl font-semibold text-gray-900">
                {formatDKK(mrr)}
              </p>
              <DeltaBadge value={momChange} />
            </div>
            <p className="mt-0.5 text-xs text-gray-500">vs. forrige måned</p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              ARR (projekteret)
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {formatDKK(arr)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">mrr × 12</p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              ARPU
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {formatDKK(finance.arpu ?? 0)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">per aktiv bruger</p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Churn rate
            </p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                (finance.churnRate ?? 0) > 5 ? "text-red-600" : "text-gray-900"
              }`}
            >
              {formatPercent(finance.churnRate)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {finance.counts.canceled} canceled
            </p>
          </div>
        </div>

        {/* Secondary metrics */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-gray-500">Aktive</p>
            <p className="font-medium text-green-600">
              {finance.counts.active}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Trial</p>
            <p className="font-medium text-brand-600">
              {finance.counts.trialing}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Past due</p>
            <p
              className={`font-medium ${
                finance.counts.pastDue > 0 ? "text-amber-600" : "text-gray-700"
              }`}
            >
              {finance.counts.pastDue}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Trial → Paid</p>
            <p className="font-medium text-gray-900">
              {formatPercent(finance.conversionRate)}
            </p>
          </div>
        </div>

        {/* Discount context — only show if there's meaningful discount */}
        {finance.discountLoss > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900">
            <p>
              <strong>{formatDKK(finance.discountLoss)}/md</strong> tabt i
              rabatter ({formatPercent(finance.avgDiscount)} gennemsnit). Uden
              rabatter ville MRR være{" "}
              <strong>{formatDKK(finance.mrrFullPrice)}</strong>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
