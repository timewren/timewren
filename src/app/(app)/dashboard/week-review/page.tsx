"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileText,
  Flame,
  PartyPopper,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

// Ugens afslutning (#110): 2-minutters fredagsritual — huller, ufaktureret
// pulje, luk ugen, streak. Et ritual, ikke godkendelses-bureaukrati.

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export default function WeekReviewPage() {
  const t = useTranslations("team.weekReview");
  const tDays = useTranslations("team.days");
  const intlLocale = toIntlLocale(useLocale());
  const fmtKr = (n: number) =>
    new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 }).format(n);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.time.getWeekReview.useQuery({});
  const closeWeek = trpc.time.closeWeek.useMutation({
    onSuccess: () => {
      utils.time.getWeekReview.invalidate();
      toast.success(t("closedToast"));
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <InlineSpinner className="h-6 w-6" />
      </div>
    );
  }

  const gaps = data.days.filter((d) => d.isGap);
  const maxHours = Math.max(8, ...data.days.map((d) => d.hours));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t("title")} description={t("description")} />

      {/* Streak */}
      {data.streak > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-800 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
          <Flame className="h-5 w-5" />
          {t("streak", { count: data.streak })}
        </div>
      )}

      {/* Ugens dage */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("weekFrom", { date: data.weekStart })}
          </h2>
          <p className="text-sm tabular-nums text-gray-500 dark:text-gray-400">
            {data.weeklyGoal
              ? t("hoursOfGoal", {
                  hours: data.totalHours.toFixed(1),
                  goal: data.weeklyGoal.toFixed(0),
                })
              : t("hoursTotal", { hours: data.totalHours.toFixed(1) })}
          </p>
        </div>
        <div className="mt-4 flex items-end gap-2">
          {data.days.map((d, i) => (
            <div
              key={d.date}
              className="flex flex-1 flex-col items-center gap-1"
            >
              <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">
                {d.hours > 0 ? d.hours.toFixed(1) : ""}
              </span>
              <div className="flex h-24 w-full items-end rounded bg-gray-100 dark:bg-gray-800">
                <div
                  className={`w-full rounded ${d.isGap ? "bg-amber-400" : "bg-brand-500"}`}
                  style={{
                    height: `${Math.min(100, (d.hours / maxHours) * 100)}%`,
                  }}
                />
              </div>
              <span
                className={`text-[11px] ${d.isGap ? "font-semibold text-amber-600 dark:text-amber-400" : "text-gray-400"}`}
              >
                {tDays(DAY_KEYS[i])}
              </span>
            </div>
          ))}
        </div>
        {gaps.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t("gaps", { count: gaps.length })}</span>
            <Link
              href="/dashboard/time"
              className="inline-flex items-center gap-1 font-medium underline"
            >
              <Copy className="h-3.5 w-3.5" />
              {t("fillInTime")}
            </Link>
          </div>
        )}
      </div>

      {/* Klar til faktura */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-brand-600 dark:text-brand-400" />
          <div>
            <p className="font-medium text-gray-900 dark:text-white">
              {t("unbilledHours", { hours: data.unbilledHours.toFixed(1) })}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("unbilledValue", { amount: fmtKr(data.unbilledValue) })}
            </p>
          </div>
        </div>
        {data.unbilledHours > 0 && (
          <Link
            href="/dashboard/invoices/new"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("createInvoice")}
          </Link>
        )}
      </div>

      {/* Luk ugen */}
      {data.isClosed ? (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4 dark:border-green-800 dark:bg-green-900/20">
          <PartyPopper className="h-6 w-6 text-green-600" />
          <p className="font-medium text-green-800 dark:text-green-300">
            {data.closedAt
              ? t("weekClosedOn", {
                  date: new Date(data.closedAt).toLocaleDateString(intlLocale),
                })
              : t("weekClosed")}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => closeWeek.mutate({ weekStart: data.weekStart })}
          disabled={closeWeek.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-tt-gran px-5 py-4 text-base font-semibold text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
        >
          <CheckCircle2 className="h-5 w-5" />
          {closeWeek.isPending ? t("closing") : t("closeWeek")}
        </button>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {data.weeklyGoal
          ? t("footnoteGoal", { goal: data.weeklyGoal.toFixed(0) })
          : t("footnoteNoGoal")}
      </p>
    </div>
  );
}
