"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  FlexNormWidget,
  formatSignedHours,
} from "@/components/dashboard/widgets/FlexNormWidget";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

/**
 * Normperioden på flexkontoen (#507): saldo-widget, opgørelse af
 * indeværende periode (brutto → netto) og de afsluttede perioder med
 * overførsel og afskæring.
 */
export function FlexNormPanel() {
  const t = useTranslations("enterpriseComponents.flexPanel");
  const tc = useTranslations("enterpriseCommon");
  const intlLocale = toIntlLocale(useLocale());
  const { data } = trpc.enterprise.getFlexNormBalance.useQuery();
  if (!data) return null;
  const h = (value: number): string =>
    value.toLocaleString(intlLocale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  const tot = data.current.totals;
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    {
      label:
        data.settings.annualHours != null
          ? t("grossAnnual", { annual: h(data.settings.annualHours) })
          : t("grossDaily"),
      value: h(tot.gross),
    },
    { label: t("daysOff"), value: h(tot.daysOff) },
    {
      label: t("vacation", { days: tot.vacationDays }),
      value: h(tot.vacation),
    },
    {
      label: t("otherAbsence", { days: tot.otherAbsenceDays }),
      value: h(tot.otherAbsence),
    },
    { label: t("netToDate"), value: h(tot.net), strong: true },
    { label: t("registered"), value: h(tot.registered) },
  ];
  if (tot.earnedOvertime !== 0) {
    rows.push({
      label: t("movedToTimeOff"),
      value: h(tot.earnedOvertime),
    });
  }

  return (
    <section className="space-y-4" aria-labelledby="flex-norm-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="flex-norm-heading"
          className="text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("heading", { label: data.current.label })}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("periodLine", {
            period: tc(`normPeriod.${data.settings.period}`).toLowerCase(),
            grade: Math.round(tot.grade * 100),
          })}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <FlexNormWidget showLink={false} />
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("caption")}</caption>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th
                    scope="row"
                    className={`py-1 pr-2 text-left font-normal ${r.strong ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"}`}
                  >
                    {r.label}
                  </th>
                  <td
                    className={`py-1 text-right tabular-nums ${r.strong ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}
                  >
                    {t("hoursValue", { value: r.value })}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 dark:border-gray-700">
                <th
                  scope="row"
                  className="pt-2 pr-2 text-left font-semibold text-gray-900 dark:text-gray-100"
                >
                  {t("flexInPeriod")}
                </th>
                <td className="pt-2 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {t("hoursValue", { value: formatSignedHours(tot.flex) })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {data.previous.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">{t("previousCaption")}</caption>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {t("colPeriod")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colCarryIn")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colFlex")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colBalance")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colCarryOut")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colCutOff")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.previous.map((p) => (
                <tr
                  key={p.start}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                >
                  <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                    {p.label}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatSignedHours(p.carryIn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatSignedHours(p.totals.flex)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatSignedHours(p.balance)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatSignedHours(p.carryOut ?? 0)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${(p.cutOff ?? 0) !== 0 ? "text-amber-700 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}
                  >
                    {(p.cutOff ?? 0) !== 0
                      ? formatSignedHours(p.cutOff ?? 0)
                      : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
