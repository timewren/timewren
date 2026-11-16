"use client";

import {
  AlertTriangle,
  DollarSign,
  Percent,
  Receipt,
  TrendingUp,
  Users,
} from "lucide-react";
import { AdminChart, AdminStatCard } from "@/components/admin";

function formatDkk(amount: number): string {
  return amount.toLocaleString("da-DK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

interface RevenueOverviewProps {
  overview: {
    mrrActual: number;
    arr: number;
    counts: { active: number; trialing: number };
    churnRate: number;
    potentialMrr: number;
    conversionRate: number;
    arpu: number;
    discountLoss: number;
    mrrFullPrice: number;
    avgDiscount: number;
    trialConversions: Array<{
      trialEndsAt: string;
      billingCycle: string;
      discountPercent: number;
    }>;
  };
  aluntaRevenue:
    | {
        totalRevenue: number;
        upcomingRevenue: number;
        transactionCount: number;
      }
    | null
    | undefined;
  mrrHistory:
    | Array<{
        month: string;
        mrr: number;
        potentialMrr: number;
        subscribers: number;
        trialingSubs: number;
      }>
    | null
    | undefined;
  loadingMrrHistory: boolean;
}

export function RevenueOverview({
  overview,
  aluntaRevenue,
  mrrHistory,
  loadingMrrHistory,
}: RevenueOverviewProps) {
  return (
    <div className="space-y-6">
      {/* Primary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          label="MRR (faktisk)"
          value={`${formatDkk(overview.mrrActual)} kr`}
          icon={DollarSign}
          color="green"
        />
        <AdminStatCard
          label="ARR"
          value={`${formatDkk(overview.arr)} kr`}
          icon={TrendingUp}
          color="blue"
        />
        <AdminStatCard
          label="Aktive abonnenter"
          value={overview.counts.active}
          icon={Users}
          color="purple"
        />
        <AdminStatCard
          label="Churn rate (30d)"
          value={`${overview.churnRate}%`}
          icon={AlertTriangle}
          color={overview.churnRate > 5 ? "rose" : "green"}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          label="Potentiel MRR (trials)"
          value={`+${formatDkk(overview.potentialMrr)} kr`}
          icon={TrendingUp}
          color="amber"
        />
        <AdminStatCard
          label="Proeverperiode"
          value={overview.counts.trialing}
          icon={Users}
          color="amber"
        />
        <AdminStatCard
          label="Konverteringsrate"
          value={`${overview.conversionRate}%`}
          icon={TrendingUp}
          color="green"
        />
        <AdminStatCard
          label="ARPU"
          value={`${formatDkk(overview.arpu)} kr/md`}
          icon={DollarSign}
          color="blue"
        />
      </div>

      {/* Alunta actual revenue */}
      {aluntaRevenue && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AdminStatCard
            label="Faktureret revenue (12 mdr)"
            value={`${formatDkk(aluntaRevenue.totalRevenue)} kr`}
            icon={Receipt}
            color="green"
          />
          <AdminStatCard
            label="Kommende (ufaktureret)"
            value={`${formatDkk(aluntaRevenue.upcomingRevenue)} kr`}
            icon={TrendingUp}
            color="amber"
          />
          <AdminStatCard
            label="Transaktioner"
            value={aluntaRevenue.transactionCount}
            icon={DollarSign}
            color="blue"
          />
        </div>
      )}

      {/* Trial conversion timeline */}
      {overview.trialConversions.length > 0 && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-5">
          <h3 className="mb-3 font-semibold text-brand-800">
            Kommende trial-udloeb
          </h3>
          <div className="flex flex-wrap gap-2">
            {overview.trialConversions.map((t, i) => {
              const date = new Date(t.trialEndsAt);
              const daysLeft = Math.max(
                0,
                Math.ceil(
                  (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                ),
              );
              const base = t.billingCycle === "yearly" ? 990 / 12 : 99;
              const mrr = base * (1 - t.discountPercent / 100);
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                  key={`trial-${t.trialEndsAt}-${i}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                    daysLeft <= 3
                      ? "bg-red-100 text-red-800"
                      : daysLeft <= 7
                        ? "bg-amber-100 text-amber-800"
                        : "bg-brand-100 text-brand-800"
                  }`}
                >
                  {daysLeft === 0 ? "I dag" : `${daysLeft}d`} ·{" "}
                  {formatDkk(Math.round(mrr))} kr/md
                  {t.billingCycle === "yearly" ? " (aarlig)" : ""}
                  {t.discountPercent > 0
                    ? ` · ${t.discountPercent}% rabat`
                    : ""}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Discount impact card */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-amber-100 p-3">
            <Percent className="h-6 w-6 text-amber-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-amber-800">Rabat-paavirkning</h3>
            <p className="text-sm text-amber-700">
              MRR-tab fra rabatter:{" "}
              <span className="font-bold">
                {formatDkk(overview.discountLoss)} kr/md
              </span>
              {" · "}MRR uden rabat:{" "}
              <span className="font-bold">
                {formatDkk(overview.mrrFullPrice)} kr/md
              </span>
              {" · "}Gns. rabat:{" "}
              <span className="font-bold">{overview.avgDiscount}%</span>
            </p>
          </div>
        </div>
      </div>

      {/* MRR History charts */}
      {mrrHistory && mrrHistory.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            MRR-trend (12 mdr)
          </h2>
          <AdminChart
            data={mrrHistory.map((m) => ({
              label: m.month.slice(5),
              value: m.mrr,
              secondaryValue:
                m.potentialMrr > m.mrr ? m.potentialMrr : undefined,
              displayValue: `${formatDkk(m.mrr)} kr`,
              secondaryDisplayValue:
                m.potentialMrr > m.mrr
                  ? `${formatDkk(m.potentialMrr - m.mrr)} kr`
                  : undefined,
            }))}
            color="green"
            secondaryColor="amber"
            legend={{
              primary: "Faktisk MRR",
              secondary: "Potentiel MRR (trials)",
            }}
            isLoading={loadingMrrHistory}
          />

          <h2 className="text-lg font-semibold text-gray-900">
            Abonnent-antal (12 mdr)
          </h2>
          <AdminChart
            data={mrrHistory.map((m) => ({
              label: m.month.slice(5),
              value: m.subscribers,
              secondaryValue:
                m.trialingSubs > 0 ? m.subscribers + m.trialingSubs : undefined,
              secondaryDisplayValue:
                m.trialingSubs > 0 ? `${m.trialingSubs} trials` : undefined,
            }))}
            color="blue"
            secondaryColor="amber"
            legend={{
              primary: "Aktive abonnenter",
              secondary: "Trials der konverterer",
            }}
            isLoading={loadingMrrHistory}
          />
        </div>
      )}
    </div>
  );
}
