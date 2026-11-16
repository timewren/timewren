"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { FlexBalance } from "@/components/enterprise/FlexBalance";
import { FlexNormPanel } from "@/components/enterprise/FlexNormPanel";
import { ModuleGuard } from "@/components/ModuleGuard";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

function getMonthRange(date: Date, intlLocale: string) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const label = start.toLocaleDateString(intlLocale, {
    month: "long",
    year: "numeric",
  });
  return {
    start: toLocalDateStr(start),
    end: toLocalDateStr(end),
    label: label.charAt(0).toUpperCase() + label.slice(1),
  };
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function FlexPageContent() {
  const t = useTranslations("enterprise");
  const intlLocale = toIntlLocale(useLocale());
  const [currentDate, setCurrentDate] = useState(new Date());
  const month = useMemo(
    () => getMonthRange(currentDate, intlLocale),
    [currentDate, intlLocale],
  );

  // "Saldo pr." — default i dag; ældre dato viser saldoen som den var dengang
  const today = useMemo(() => toLocalDateStr(new Date()), []);
  const [asOf, setAsOf] = useState(today);
  const asOfValid = /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  const { data: balance } = trpc.enterprise.getBalance.useQuery(
    { asOf },
    { enabled: asOfValid },
  );
  const balanceLabel =
    asOf === today
      ? t("flex.currentBalance")
      : t("flex.balanceOn", { date: asOf.split("-").reverse().join(".") });
  const { data: entries, isLoading } = trpc.enterprise.getEntries.useQuery({
    startDate: month.start,
    endDate: month.end,
  });

  const monthDelta = useMemo(() => {
    if (!entries) return 0;
    return entries.reduce(
      (sum: number, e: { delta: string | number }) => sum + Number(e.delta),
      0,
    );
  }, [entries]);

  const navigateMonth = (direction: -1 | 1) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + direction);
      return d;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("flex.title")}
        actions={
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <CalendarDays className="h-4 w-4 text-gray-400" />
            {t("flex.balanceAsOf")}
            <input
              type="date"
              value={asOf}
              max={today}
              onChange={(e) => {
                // Ryddet/ugyldig dato: bliv på sidste gyldige i stedet for
                // at vise en tom "Saldo pr." med forældet saldo (#457)
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                  setAsOf(e.target.value);
                }
              }}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
          </label>
        }
      />

      {/* Normperiode og løbende saldo (#507) */}
      <FlexNormPanel />

      {/* Balance cards */}
      {balance && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FlexBalance
            balance={Number(balance.balance ?? 0)}
            label={balanceLabel}
          />
          <FlexBalance balance={monthDelta} label={t("flex.thisMonth")} />
        </div>
      )}

      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigateMonth(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-medium text-gray-900 dark:text-gray-100">
          {month.label}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => navigateMonth(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Daily entries table */}
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-10 rounded bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : entries && entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {t("flex.noEntries")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50">
                <th className="px-4 py-2.5 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("flex.colDate")}
                </th>
                <th className="px-4 py-2.5 text-right text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("flex.colExpected")}
                </th>
                <th className="px-4 py-2.5 text-right text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("flex.colActual")}
                </th>
                <th className="px-4 py-2.5 text-right text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("flex.colFlex")}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries?.map(
                (entry: {
                  id: string;
                  date: string;
                  expectedHours: string | number;
                  actualHours: string | number;
                  delta: string | number;
                  absenceRequestId?: string | null;
                  isLocked?: boolean;
                }) => {
                  const date = new Date(entry.date);
                  const dayName = t(`weekdays.${WEEKDAY_KEYS[date.getDay()]}`);
                  const dayNum = date.getDate();
                  const delta = Number(entry.delta);
                  const isAbsence = !!entry.absenceRequestId;

                  return (
                    <tr
                      key={entry.id}
                      className={`border-b border-gray-200 last:border-0 dark:border-gray-700 ${
                        isAbsence
                          ? "bg-brand-50/50 dark:bg-tt-gran-lys"
                          : "hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                    >
                      <td className="px-4 py-2 text-sm">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {dayName}
                        </span>
                        <span className="ml-1 text-gray-500 dark:text-gray-400">
                          {dayNum}.
                        </span>
                        {isAbsence && (
                          <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400">
                            {t("flex.absence")}
                          </span>
                        )}
                        {entry.isLocked && (
                          <span className="ml-2 text-xs text-gray-400">
                            {t("flex.locked")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-sm text-gray-500 dark:text-gray-400">
                        {Number(entry.expectedHours).toFixed(1)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-sm text-gray-900 dark:text-gray-100">
                        {Number(entry.actualHours).toFixed(1)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums text-sm font-medium ${
                          delta > 0
                            ? "text-green-600 dark:text-green-400"
                            : delta < 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(1)}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FlexPage() {
  return (
    <ModuleGuard module="enterprise">
      <FlexPageContent />
    </ModuleGuard>
  );
}
