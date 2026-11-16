"use client";

import { ArrowLeft, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

// Team-lønsomhed (#142): omsætning − intern kostpris pr. medarbejder og
// projekt. Kun owner/admin — kostpriser er salary-like data.

function StatTable({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: {
    id: string | null;
    name: string;
    hours: number;
    revenue: number;
    cost: number;
    margin: number;
    marginPct: number | null;
  }[];
  emptyText: string;
}) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const fmtKr = (n: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), {
      maximumFractionDigits: 0,
    }).format(n);
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          <tr>
            <th className="px-4 py-3">{title}</th>
            <th className="px-4 py-3 text-right">{t("teamProfit.colHours")}</th>
            <th className="px-4 py-3 text-right">
              {t("teamProfit.colRevenue")}
            </th>
            <th className="px-4 py-3 text-right">{t("teamProfit.colCost")}</th>
            <th className="px-4 py-3 text-right">
              {t("teamProfit.colMargin")}
            </th>
            <th className="px-4 py-3 text-right">
              {t("teamProfit.colMarginPct")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-950">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-6 text-center text-gray-500 dark:text-gray-400"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id ?? "none"}>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                  {r.name}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {r.hours.toFixed(1)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-white">
                  {t("teamProfit.amountKr", { amount: fmtKr(r.revenue) })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {t("teamProfit.amountKr", { amount: fmtKr(r.cost) })}
                </td>
                <td
                  className={`px-4 py-3 text-right font-semibold tabular-nums ${
                    r.margin < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-900 dark:text-white"
                  }`}
                >
                  {t("teamProfit.amountKr", { amount: fmtKr(r.margin) })}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    r.marginPct !== null && r.marginPct < 20
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {r.marginPct !== null ? `${Math.round(r.marginPct)} %` : "–"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function TeamProfitabilityPage() {
  const t = useTranslations("reports");
  const [months, setMonths] = useState(6);
  const { data, isLoading, error } = trpc.reports.getTeamProfitability.useQuery(
    { months },
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard/reports"
            className="mb-1 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("profitability.back")}
          </Link>
          <PageHeader
            title={t("teamProfit.title")}
            description={t("teamProfit.description")}
          />
        </div>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value={3}>{t("teamProfit.months3")}</option>
          <option value={6}>{t("teamProfit.months6")}</option>
          <option value={12}>{t("teamProfit.months12")}</option>
          <option value={24}>{t("teamProfit.months24")}</option>
        </select>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
          <Users className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
            {t("teamProfit.needsAdmin")}
          </h3>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            {t("teamProfit.adminOnly")}
          </p>
        </div>
      ) : isLoading || !data ? (
        <div className="flex h-64 items-center justify-center">
          <InlineSpinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <StatTable
            title={t("teamProfit.member")}
            rows={data.byMember}
            emptyText={t("teamProfit.noTime")}
          />
          <StatTable
            title={t("teamProfit.project")}
            rows={data.byProject}
            emptyText={t("teamProfit.noProjectTime")}
          />
          <CostRatesSection />
          <p className="flex items-start gap-2 text-xs text-gray-400 dark:text-gray-500">
            <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("teamProfit.footnote", { from: data.from })}
          </p>
        </>
      )}
    </div>
  );
}

/** Kostpris-administration (#142): org-default pr. medlem, kun admin */
function CostRatesSection() {
  const t = useTranslations("reports");
  const utils = trpc.useUtils();
  const { data: rows } = trpc.memberRates.listCostRates.useQuery();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const setCostRate = trpc.memberRates.setCostRate.useMutation({
    onSuccess: () => {
      utils.memberRates.listCostRates.invalidate();
      utils.reports.getTeamProfitability.invalidate();
      toast.success(t("teamProfit.costSaved"));
    },
    onError: (e) => toast.error(e.message),
  });

  if (!rows) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t("teamProfit.costTitle")}
      </h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t("teamProfit.costDescription")}
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((m) => (
          <li key={m.memberId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
              {m.userName}
            </span>
            <input
              type="number"
              min={0}
              step="1"
              placeholder={t("teamProfit.costPlaceholder")}
              value={drafts[m.memberId] ?? m.costRate ?? ""}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [m.memberId]: e.target.value }))
              }
              onBlur={() => {
                const value = drafts[m.memberId];
                if (value === undefined) return;
                setCostRate.mutate({
                  memberId: m.memberId,
                  costRate: value.trim() === "" ? null : value.trim(),
                });
              }}
              className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
