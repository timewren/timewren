"use client";

import { Printer } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Suspense } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  formatHours,
  memberWeekTotals,
  type ResourcePlanGridRow,
  type ResourcePlanPreset,
} from "@/lib/resource-plan/export";
import {
  bookingStatus,
  deviationStatus,
  isoWeekNumber,
  MAX_PLAN_WEEKS,
  sumValues,
  toWeekStart,
  weekEnd,
} from "@/lib/resource-plan/plan";
import { copenhagenToday, isDateStr } from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";

// Print-venlig ressourceplan (#508). "PDF" = browserens "Gem som PDF": den
// eksisterende PDF-motor er bygget til fakturaer på serveren, og en
// udskriftsside giver samme resultat uden en ny server-pipeline.

function formatDay(dateStr: string, intlLocale: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(intlLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const signed = (n: number) => (n > 0 ? `+${formatHours(n)}` : formatHours(n));

function byProject(locale: string) {
  return (a: ResourcePlanGridRow, b: ResourcePlanGridRow) =>
    a.projectName.localeCompare(b.projectName, locale) ||
    (a.activityName ?? "").localeCompare(b.activityName ?? "", locale);
}

function PrintContent() {
  const t = useTranslations("resourcePlan");
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const weekLabel = (w: string) => t("weekShort", { week: isoWeekNumber(w) });
  const presetLabels: Record<ResourcePlanPreset, string> = {
    grid: t("presetGrid"),
    opgaveoversigt: t("presetTasks"),
  };
  const params = useSearchParams();
  const rawWeek = params.get("week") ?? "";
  const weekStart = isDateStr(rawWeek)
    ? toWeekStart(rawWeek)
    : toWeekStart(copenhagenToday());
  const weeks = Math.min(
    MAX_PLAN_WEEKS,
    Math.max(1, Math.floor(Number(params.get("weeks"))) || 8),
  );
  const preset: ResourcePlanPreset =
    params.get("preset") === "opgaveoversigt" ? "opgaveoversigt" : "grid";
  const userId = params.get("user") || undefined;

  const { data, isLoading, error } = trpc.resourcePlan.grid.useQuery(
    { weekStart, weeks, userId },
    { staleTime: 0, retry: false },
  );

  if (error) {
    return <p className="p-8 text-sm text-red-600">{error.message}</p>;
  }
  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <InlineSpinner className="h-6 w-6" />
      </div>
    );
  }

  const from = data.weeks[0];
  const to = weekEnd(data.weeks[data.weeks.length - 1]);
  const title =
    preset === "opgaveoversigt" ? t("print.taskOverview") : t("title");

  return (
    <div className="rp-print mx-auto max-w-5xl space-y-6 bg-white p-6 text-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-gray-600">
            {t("print.subtitle", {
              from: formatDay(from, intlLocale),
              to: formatDay(to, intlLocale),
              preset: presetLabels[preset],
              printed: formatDay(data.today, intlLocale),
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="rp-no-print inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Printer className="h-4 w-4" />
          {t("print.button")}
        </button>
      </div>

      {data.members.map((m) => {
        const rows = data.rows
          .filter((r) => r.userId === m.userId)
          .sort(byProject(locale));
        const totals = memberWeekTotals(rows, m.userId, data.weeks);
        let norm = 0;
        let absence = 0;
        let capacity = 0;
        for (const w of data.weeks) {
          norm += m.capacity[w]?.normHours ?? 0;
          absence += m.capacity[w]?.absenceHours ?? 0;
          capacity += m.capacity[w]?.capacity ?? 0;
        }
        const planned = sumValues(totals.planned);
        const registered = sumValues(totals.registered);

        return (
          <section key={m.userId} className="rp-member space-y-2">
            <h2 className="border-b border-gray-300 pb-1 text-base font-semibold">
              {m.name}
            </h2>
            <p className="text-sm text-gray-700">
              {t("print.memberSummary", {
                norm: formatHours(norm),
                absence: formatHours(absence),
                capacity: formatHours(capacity),
                planned: formatHours(planned),
                registered: formatHours(registered),
              })}
              {capacity > planned
                ? ` · ${t("print.notPlanned", { hours: formatHours(capacity - planned) })}`
                : planned > capacity
                  ? ` · ${t("print.overbooked", { hours: formatHours(planned - capacity) })}`
                  : ""}
            </p>

            {preset === "opgaveoversigt" ? (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-xs text-gray-600">
                    <th className="py-1 pr-2">{t("print.colTask")}</th>
                    <th className="py-1 pr-2">{t("print.colClient")}</th>
                    <th className="py-1 pr-2">{t("print.colActivity")}</th>
                    <th className="py-1 pr-2 text-right">
                      {t("print.colPlanned")}
                    </th>
                    <th className="py-1 pr-2 text-right">
                      {t("print.colRegistered")}
                    </th>
                    <th className="py-1 text-right">
                      {t("print.colDeviation")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const p = sumValues(r.planned);
                    const reg = sumValues(r.registered);
                    return (
                      <tr key={r.key} className="border-b border-gray-100">
                        <td className="py-1 pr-2">{r.projectName}</td>
                        <td className="py-1 pr-2">{r.clientName ?? ""}</td>
                        <td className="py-1 pr-2">{r.activityName ?? ""}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {formatHours(p)}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {formatHours(reg)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {signed(reg - p)}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-2 text-gray-500">
                        {t("print.noTasks")}
                      </td>
                    </tr>
                  )}
                  <tr className="font-semibold">
                    <td className="py-1 pr-2" colSpan={3}>
                      {t("print.total")}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {formatHours(planned)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {formatHours(registered)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {signed(registered - planned)}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-600">
                    <th className="py-1 pr-2">{t("print.colProject")}</th>
                    {data.weeks.map((w) => (
                      <th key={w} className="py-1 pr-2 text-right">
                        {weekLabel(w)}
                      </th>
                    ))}
                    <th className="py-1 text-right">{t("print.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 font-medium">
                    <td className="py-1 pr-2">{t("print.plannedCapacity")}</td>
                    {data.weeks.map((w) => {
                      const cap = m.capacity[w]?.capacity ?? 0;
                      const status = bookingStatus(totals.planned[w], cap);
                      return (
                        <td
                          key={w}
                          className={`py-1 pr-2 text-right tabular-nums ${status === "over" ? "text-red-700" : status === "under" ? "text-amber-700" : ""}`}
                        >
                          {formatHours(totals.planned[w])}/{formatHours(cap)}
                          {status === "over" ? " !" : ""}
                        </td>
                      );
                    })}
                    <td className="py-1 text-right tabular-nums">
                      {formatHours(planned)}/{formatHours(capacity)}
                    </td>
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-gray-100">
                      <td className="py-1 pr-2">
                        {r.projectName}
                        {r.activityName ? ` · ${r.activityName}` : ""}
                        {r.unplanned ? ` ${t("print.notPlannedTag")}` : ""}
                      </td>
                      {data.weeks.map((w) => {
                        const p = r.planned[w] ?? 0;
                        const reg = r.registered[w] ?? 0;
                        const dev = deviationStatus({
                          planned: p,
                          registered: reg,
                          weekStart: w,
                          today: data.today,
                        });
                        return (
                          <td
                            key={w}
                            className={`py-1 pr-2 text-right tabular-nums ${dev === "over" ? "text-red-700" : dev === "under" ? "text-amber-700" : ""}`}
                          >
                            {formatHours(p)}
                            {dev !== "future" || reg > 0
                              ? ` (${formatHours(reg)})`
                              : ""}
                          </td>
                        );
                      })}
                      <td className="py-1 text-right tabular-nums">
                        {formatHours(sumValues(r.planned))} (
                        {formatHours(sumValues(r.registered))})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      {preset === "grid" && (
        <p className="text-xs text-gray-500">{t("print.gridNote")}</p>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .rp-print, .rp-print * { visibility: visible; }
          .rp-print { position: absolute; left: 0; top: 0; width: 100%; max-width: none; padding: 0; }
          .rp-no-print { display: none !important; }
          .rp-member { break-inside: avoid; }
          @page { size: A4 ${preset === "grid" ? "landscape" : "portrait"}; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}

export default function ResourcePlanPrintPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <InlineSpinner className="h-6 w-6" />
        </div>
      }
    >
      <PrintContent />
    </Suspense>
  );
}
