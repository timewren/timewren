"use client";

import { AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { downloadCsv } from "@/lib/enterprise/csv";
import { trpc } from "@/providers/trpc-provider";
import { useNumberFormat } from "./useNumberFormat";

export type PayrollPanelParams = {
  from: string;
  to: string;
  departmentIds?: string[];
  includeInactive?: boolean;
  onlyApproved?: boolean;
};

function downloadBase64(filename: string, base64: string, mime: string) {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bin], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Lønart-fordeling pr. medarbejder for en periode + eksport i org'ens
 * lønsystem-format (E5, #463). Bruges i rapportbyggeren (lønrapport) og på
 * Indstillinger → Løn.
 */
export function PayrollWageLinesPanel({
  params,
  compact = false,
}: {
  params: PayrollPanelParams;
  compact?: boolean;
}) {
  const t = useTranslations("enterprisePayroll.panel");
  const tc = useTranslations("enterpriseCommon");
  const fmt = useNumberFormat(2);
  const query = trpc.enterprise.previewPayrollExport.useQuery(params, {
    placeholderData: (prev) => prev,
  });
  const exportMutation = trpc.enterprise.exportPayrollLines.useMutation({
    onSuccess: (res) => {
      if (res.format === "csv") downloadCsv(res.filename, res.data);
      else
        downloadBase64(
          res.filename,
          res.data,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      toast.success(t("exported", { lines: res.lines }));
      if (res.missingEmployeeNumbers.length > 0) {
        toast.warning(
          t("missingNumbersToast", {
            count: res.missingEmployeeNumbers.length,
          }),
        );
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const data = query.data;
  if (query.isLoading && !data) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }
  if (query.error) {
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
        {query.error.message}
      </p>
    );
  }
  if (!data) return null;

  // Grupper linjer pr. medarbejder til visning
  const byEmployee = new Map<
    string,
    { name: string; number: string; lines: typeof data.totals }
  >();
  for (const total of data.totals) {
    let g = byEmployee.get(total.userId);
    if (!g) {
      g = {
        name: total.employeeName,
        number: total.employeeNumber,
        lines: [],
      };
      byEmployee.set(total.userId, g);
    }
    g.lines.push(total);
  }
  const groups = Array.from(byEmployee.values());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t("distribution", {
              from: data.period.from,
              to: data.period.to,
            })}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("summary", {
              employees: groups.length,
              lines: data.totals.length,
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={exportMutation.isPending || data.totals.length === 0}
            onClick={() => exportMutation.mutate({ ...params, format: "csv" })}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {t("csvToPayroll")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportMutation.isPending || data.totals.length === 0}
            onClick={() => exportMutation.mutate({ ...params, format: "xlsx" })}
          >
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            {t("excel")}
          </Button>
        </div>
      </div>

      {!data.hasConfig && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {t.rich("noConfig", {
            link: (chunks) => (
              <Link
                href="/dashboard/enterprise/settings/payroll"
                className="underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {data.missingEmployeeNumbers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {t("missingNumbersTitle", {
              count: data.missingEmployeeNumbers.length,
            })}
          </div>
          <p className="mt-1 text-xs">
            {t.rich("missingNumbersBody", {
              names: data.missingEmployeeNumbers.map((m) => m.name).join(", "),
              link: (chunks) => (
                <Link
                  href="/dashboard/enterprise/settings/payroll"
                  className="underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      )}

      {data.unmapped.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {t("unmappedTitle")}
          </div>
          <ul className="mt-1 list-inside list-disc text-xs">
            {data.unmapped.map((u) => (
              <li key={`${u.source}|${u.label}`}>
                {t("unmappedLine", {
                  source: tc(`payroll.source.${u.source}`),
                  label: u.label,
                  quantity: fmt(u.quantity),
                  unit: tc(`payroll.unit.${u.unit}`).toLowerCase(),
                  count: u.employeeCount,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.totals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t("noLines")}
        </p>
      ) : (
        <div
          className={`overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${compact ? "max-h-96" : ""}`}
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-gray-800">
              <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                {[
                  t("colNumber"),
                  t("colEmployee"),
                  t("colWage"),
                  t("colName"),
                  t("colUnit"),
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-3 py-2 font-medium text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">
                  {t("colQuantity")}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) =>
                g.lines.map((ln, i) => (
                  <tr
                    key={`${ln.userId}|${ln.code}|${ln.unit}`}
                    className={`border-b border-gray-100 dark:border-gray-700/50 ${
                      i === 0
                        ? "border-t border-t-gray-200 dark:border-t-gray-700"
                        : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                      {i === 0
                        ? g.number || (
                            <span className="text-amber-600 dark:text-amber-400">
                              {t("missing")}
                            </span>
                          )
                        : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {i === 0 ? g.name : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-xs">
                      {ln.code}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {ln.name}
                      {ln.supplement && (
                        <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] uppercase text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                          {t("supplement")}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">
                      {tc(`payroll.unit.${ln.unit}`)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {fmt(ln.quantity)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
