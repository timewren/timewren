"use client";

import { useTranslations } from "next-intl";
import type { ClientCoverage } from "@/lib/coverage/coverage";
import {
  fmtHours,
  fmtPct,
  fmtRatio,
  useCoverageFormat,
} from "./coverage-format";

/**
 * Vandret bar: fakturerbar + ikke-fakturerbar tid oven på arbejdstiden.
 * Logges der mere end arbejdstiden, markeres arbejdstidens grænse med en
 * lodret streg.
 */
export function CoverageBar({
  billableHours,
  nonBillableHours,
  expectedHours,
  className = "h-3",
}: {
  billableHours: number;
  nonBillableHours: number;
  expectedHours: number;
  className?: string;
}) {
  const t = useTranslations("coverage");
  const fmt = useCoverageFormat();
  const logged = billableHours + nonBillableHours;
  const scale = Math.max(expectedHours, logged, 0.0001);
  const w = (h: number) => `${Math.min(100, (h / scale) * 100)}%`;
  const label = t("bar.label", {
    billable: fmtHours(billableHours, fmt),
    nonBillable: fmtHours(nonBillableHours, fmt),
    expected: fmtHours(expectedHours, fmt),
  });
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={`relative flex w-full shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 ${className}`}
    >
      <div
        className="h-full bg-brand-600 dark:bg-brand-400"
        style={{ width: w(billableHours) }}
      />
      <div
        className="h-full bg-amber-500"
        style={{ width: w(nonBillableHours) }}
      />
      {logged > expectedHours && expectedHours > 0 && (
        <div
          className="absolute inset-y-0 w-0.5 bg-gray-900 dark:bg-white"
          style={{ left: w(expectedHours) }}
        />
      )}
    </div>
  );
}

export function CoverageLegend() {
  const t = useTranslations("coverage");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-sm bg-brand-600 dark:bg-brand-400"
          aria-hidden
        />
        {t("bar.billable")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" aria-hidden />
        {t("bar.nonBillable")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-sm bg-gray-200 dark:bg-gray-700"
          aria-hidden
        />
        {t("bar.notLogged")}
      </span>
    </div>
  );
}

/** Tabel pr. kunde (inkl. intern tid) med forholdstal. */
export function CoverageClientTable({
  clients,
  limit,
}: {
  clients: ClientCoverage[];
  limit?: number;
}) {
  const t = useTranslations("coverage");
  const fmt = useCoverageFormat();
  const rows = limit ? clients.slice(0, limit) : clients;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-400">
            <th scope="col" className="py-2 pr-3 font-medium">
              {t("table.client")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("table.billable")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("table.nonBillableShort")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("table.share")}
            </th>
            <th
              scope="col"
              className="py-2 pl-3 text-right font-medium"
              title={t("table.ratioTitle")}
            >
              {t("table.ratio")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((c) => (
            <tr key={c.clientId ?? "intern"}>
              <td className="py-2 pr-3 text-gray-900 dark:text-white">
                {c.clientId === null ? (
                  <span className="italic text-gray-700 dark:text-gray-300">
                    {c.clientName}
                  </span>
                ) : (
                  c.clientName
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-900 dark:text-white">
                {fmtHours(c.billableHours, fmt)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-900 dark:text-white">
                {fmtHours(c.nonBillableHours, fmt)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                {fmtPct(c.sharePct, fmt)}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums text-gray-900 dark:text-white">
                {c.nonBillablePerBillableHour == null &&
                c.nonBillableHours > 0 ? (
                  <span className="font-sans text-gray-600 dark:text-gray-400">
                    {t("table.onlyNonBillable")}
                  </span>
                ) : (
                  fmtRatio(c.nonBillablePerBillableHour, fmt)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
