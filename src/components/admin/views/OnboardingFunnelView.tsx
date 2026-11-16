"use client";

import {
  ArrowDownRight,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { AdminFunnel } from "@/components/admin";
import { trpc } from "@/providers/trpc-provider";

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function OnboardingFunnelView() {
  const { data: funnel, isLoading } = trpc.admin.getOnboardingFunnel.useQuery();

  const conversions = funnel
    ? funnel.map((step, i) => {
        if (i === 0) return { ...step, rate: 100, drop: 0 };
        const prev = funnel[i - 1].value;
        const rate = prev > 0 ? (step.value / prev) * 100 : 0;
        const drop = prev - step.value;
        return { ...step, rate, drop };
      })
    : [];

  const totalUsers = funnel?.[0]?.value ?? 0;
  const finalUsers = funnel?.[funnel.length - 1]?.value ?? 0;
  const overallConversion =
    totalUsers > 0 ? (finalUsers / totalUsers) * 100 : 0;
  const worstDropStep =
    conversions.length > 1
      ? conversions
          .slice(1)
          .reduce(
            (worst, s) => (s.drop > worst.drop ? s : worst),
            conversions[1],
          )
      : null;

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-lg bg-gray-100" />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            <p className="text-sm text-gray-500">Total signups</p>
          </div>
          <p className="mt-2 text-3xl font-semibold text-gray-900">
            {totalUsers}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-gray-400" />
            <p className="text-sm text-gray-500">Samlet konvertering</p>
          </div>
          <p className="mt-2 text-3xl font-semibold text-gray-900">
            {formatPercent(overallConversion)}
          </p>
          <p className="mt-1 text-xs text-gray-500">signup → sendt faktura</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-gray-400" />
            <p className="text-sm text-gray-500">Største drop</p>
          </div>
          {worstDropStep ? (
            <>
              <p className="mt-2 text-lg font-semibold text-red-600">
                {worstDropStep.drop} brugere
              </p>
              <p className="mt-1 text-xs text-gray-500">
                ved "{worstDropStep.label}"
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Ingen drops endnu</p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          Visuel funnel
        </h2>
        <AdminFunnel steps={funnel ?? []} />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Trin
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Brugere
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Konvertering fra forrige
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Drop
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                % af signups
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {conversions.map((step, i) => {
              const overall =
                totalUsers > 0 ? (step.value / totalUsers) * 100 : 0;
              return (
                <tr
                  key={step.label}
                  className={
                    i > 0 && step.rate < 50 ? "bg-amber-50/50" : undefined
                  }
                >
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                    {step.label}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-900">
                    {step.value}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {i === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          step.rate >= 75
                            ? "bg-green-100 text-green-800"
                            : step.rate >= 50
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {step.rate >= 75 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {formatPercent(step.rate)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-600">
                    {i === 0 ? "—" : step.drop}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-500">
                    {formatPercent(overall)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
