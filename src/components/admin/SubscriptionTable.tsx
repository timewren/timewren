"use client";

import { AlertTriangle, Crown } from "lucide-react";
import { AdminChart, AdminProgressBar } from "@/components/admin";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

function formatDkk(amount: number): string {
  return amount.toLocaleString("da-DK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function SubscriptionTable() {
  const { data: breakdown, isLoading } =
    trpc.admin.getSubscriptionBreakdown.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <InlineSpinner className="h-8 w-8" />
      </div>
    );
  }

  if (!breakdown) return null;

  return (
    <div className="space-y-6">
      {/* Status distribution */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Status-fordeling
        </h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(breakdown.breakdown).map(([cycle, statuses]) =>
            Object.entries(statuses).map(([status, cnt]) => {
              const colors: Record<string, string> = {
                active: "bg-green-100 text-green-800",
                trialing: "bg-blue-100 text-blue-800",
                canceled: "bg-red-100 text-red-800",
                past_due: "bg-amber-100 text-amber-800",
              };
              return (
                <span
                  key={`${cycle}-${status}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${colors[status] || "bg-gray-100 text-gray-800"}`}
                >
                  {cycle === "yearly" ? "Aarlig" : "Maanedlig"} · {status}{" "}
                  <span className="font-bold">{cnt}</span>
                </span>
              );
            }),
          )}
        </div>
      </div>

      {/* Billing cycle split */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Billing cycle fordeling
        </h2>
        <div className="space-y-2">
          {Object.entries(breakdown.breakdown).map(([cycle, statuses]) => {
            const total = Object.values(statuses).reduce((s, v) => s + v, 0);
            const allTotal = Object.values(breakdown.breakdown).reduce(
              (s, st) => s + Object.values(st).reduce((a, b) => a + b, 0),
              0,
            );
            return (
              <AdminProgressBar
                key={cycle}
                label={cycle === "yearly" ? "Aarlig" : "Maanedlig"}
                value={total}
                max={allTotal}
                color={cycle === "yearly" ? "green" : "blue"}
              />
            );
          })}
        </div>
      </div>

      {/* Founding tier overview */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          <Crown className="mb-0.5 mr-2 inline h-5 w-5 text-amber-500" />
          Founding tier oversigt
        </h2>
        <div className="space-y-3">
          {breakdown.foundingDetails.map((tier) => (
            <div
              key={tier.tierKey}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-gray-900">
                    {tier.label}
                  </span>
                  <span className="ml-2 text-sm text-gray-500">
                    ({tier.discountPercent}% rabat)
                  </span>
                </div>
                <div className="text-right text-sm">
                  <span className="text-green-600">
                    +{formatDkk(tier.mrrContribution)} kr/md
                  </span>
                  {tier.mrrLoss > 0 && (
                    <span className="ml-2 text-red-500">
                      -{formatDkk(tier.mrrLoss)} kr/md
                    </span>
                  )}
                </div>
              </div>
              <AdminProgressBar
                label="Slots optaget"
                value={tier.occupied}
                max={tier.maxSlots}
                color={
                  tier.occupied >= tier.maxSlots
                    ? "rose"
                    : tier.occupied >= tier.maxSlots * 0.8
                      ? "amber"
                      : "green"
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* Discount distribution */}
      {breakdown.discountDistribution.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Rabatfordeling
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2 font-medium text-gray-500">
                    Rabat %
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-500">Antal</th>
                  <th className="px-4 py-2 font-medium text-gray-500">
                    MRR-tab
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdown.discountDistribution.map((d) => (
                  <tr
                    key={d.discountPercent}
                    className="border-b border-gray-100"
                  >
                    <td className="px-4 py-2 text-gray-900">
                      {d.discountPercent}%
                    </td>
                    <td className="px-4 py-2 text-gray-900">{d.count}</td>
                    <td className="px-4 py-2 text-red-600">
                      {formatDkk(d.mrrImpact)} kr/md
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pending cancellations */}
      {breakdown.pendingCancellations > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h3 className="font-semibold text-amber-800">Kommende churn</h3>
          </div>
          <p className="mt-1 text-sm text-amber-700">
            {breakdown.pendingCancellations} abonnement(er) afventer opsigelse
            ved periodeudloeb
          </p>
        </div>
      )}

      {/* Expiring trials */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Udloebende proeverperioder (14 dage)
        </h2>
        <AdminChart
          data={breakdown.expiringTrials}
          color="amber"
          height={180}
          emptyMessage="Ingen udloebende trials"
        />
      </div>
    </div>
  );
}
