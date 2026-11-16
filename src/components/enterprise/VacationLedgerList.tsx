"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { trpc } from "@/providers/trpc-provider";
import { useNumberFormat } from "./useNumberFormat";

const TYPE_KEYS = [
  "earned",
  "opening",
  "used",
  "reversed",
  "carried_over",
  "paid_out",
  "forfeited",
  "adjustment",
];

const POOL_KEYS: Record<string, string> = {
  vacation: "poolVacation",
  extra: "poolExtra",
};

const REF_KEYS = [
  "absence_request",
  "closure",
  "cron",
  "rollover",
  "period_open",
  "migration",
  "manual",
];

const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
};

/** Signeret visning: afholdt/fortabt/udbetalt trækker fra, resten lægger til. */
function signedDays(entryType: string, days: number): number {
  switch (entryType) {
    case "used":
    case "paid_out":
    case "forfeited":
      return -days;
    default:
      return days;
  }
}

/**
 * Feriebevægelser (#461): ledger-posterne bag saldoen for en medarbejder —
 * nyeste først, sammenklappelig. Egen bruger som default.
 */
export function VacationLedgerList({
  userId,
  defaultOpen = false,
}: {
  userId?: string;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("enterpriseComponents.ledger");
  const fmt2 = useNumberFormat(2);
  const [open, setOpen] = useState(defaultOpen);
  const { data, isLoading } = trpc.enterprise.listVacationLedger.useQuery(
    { userId, limit: 200 },
    { enabled: open },
  );

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {t("title")}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          {isLoading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 rounded bg-gray-100 dark:bg-gray-800"
                />
              ))}
            </div>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <th className="pb-2 pr-3 font-medium">{t("colDate")}</th>
                    <th className="pb-2 pr-3 font-medium">{t("colYear")}</th>
                    <th className="pb-2 pr-3 font-medium">{t("colPool")}</th>
                    <th className="pb-2 pr-3 font-medium">{t("colType")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">
                      {t("colDays")}
                    </th>
                    <th className="pb-2 font-medium">{t("colNote")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.map((e) => {
                    const signed = signedDays(e.entryType, e.days);
                    return (
                      <tr key={e.id}>
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-gray-700 dark:text-gray-300">
                          {fmtDate(e.effectiveDate)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                          {e.periodLabel}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {POOL_KEYS[e.pool] ? t(POOL_KEYS[e.pool]) : e.pool}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {TYPE_KEYS.includes(e.entryType)
                            ? t(e.entryType)
                            : e.entryType}
                          {e.refType ? (
                            <span className="ml-1 text-xs text-gray-400">
                              (
                              {REF_KEYS.includes(e.refType)
                                ? t(`ref.${e.refType}`)
                                : e.refType}
                              )
                            </span>
                          ) : null}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right tabular-nums font-medium ${
                            signed < 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {signed > 0 ? "+" : signed < 0 ? "−" : ""}
                          {fmt2(Math.abs(signed))}
                        </td>
                        <td className="py-2 text-gray-500 dark:text-gray-400">
                          {e.note ?? ""}
                          {e.createdByName ? (
                            <span className="ml-1 text-xs text-gray-400">
                              · {e.createdByName}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
