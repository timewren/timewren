"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  type EmployeeImportRow,
  IMPORT_TEMPLATE_CSV,
  parseEmployeeImport,
} from "@/lib/enterprise/import";
import { trpc } from "@/providers/trpc-provider";

function ImportPageContent() {
  const t = useTranslations("enterprise.employees.import");
  const intl = toIntlLocale(useLocale());
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<EmployeeImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<
    Array<{ line: number; message: string }>
  >([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: string[];
    skipped: string[];
    errors: Array<{ email: string; message: string }>;
    // Manglende ledere efter andet pas (#464) — advarsel, ikke fejl
    warnings?: Array<{ email: string; message: string }>;
  } | null>(null);

  const utils = trpc.useUtils();
  const importMutation = trpc.enterprise.importEmployees.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setRows([]);
      utils.enterprise.listMembers.invalidate();
      toast.success(t("imported", { count: data.created.length }));
    },
    onError: (e) => toast.error(e.message || t("failed")),
  });

  function handleFile(file: File) {
    setResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseEmployeeImport(String(reader.result ?? ""));
      setRows(parsed.rows);
      setParseErrors(parsed.errors);
      if (parsed.rows.length === 0 && parsed.errors.length === 0) {
        setParseErrors([{ line: 1, message: t("noRows") }]);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function downloadTemplate() {
    const blob = new Blob([`﻿${IMPORT_TEMPLATE_CSV}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = t("templateFile");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      <p className="max-w-2xl text-sm text-gray-600 dark:text-gray-400">
        {t.rich("intro", {
          code: (chunks) => (
            <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">
              {chunks}
            </code>
          ),
        })}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
        >
          <FileUp className="h-4 w-4" />
          {t("chooseFile")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          <Download className="h-4 w-4" />
          {t("downloadTemplate")}
        </button>
        {fileName && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {fileName}
          </span>
        )}
      </div>

      {parseErrors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            {t("skipped", { count: parseErrors.length })}
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-amber-700 dark:text-amber-400">
            {parseErrors.map((e) => (
              <li key={`${e.line}-${e.message}`}>
                {t("line", { line: e.line, message: e.message })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                  <th className="px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                    {t("colName")}
                  </th>
                  <th className="px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                    {t("colEmail")}
                  </th>
                  <th className="px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                    {t("colDepartment")}
                  </th>
                  <th className="px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                    {t("colRole")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-gray-500 dark:text-gray-400">
                    {t("colHours")}
                  </th>
                  <th className="px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                    {t("colManager")}
                  </th>
                  <th className="px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                    {t("colStart")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.email}
                    className="border-b border-gray-100 dark:border-gray-700/50"
                  >
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                      {r.name}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {r.email}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {r.department ?? "–"}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {t(
                        `role${r.role.charAt(0).toUpperCase()}${r.role.slice(1)}`,
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(r.weeklyHours).toLocaleString(intl)}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {r.managerEmail ?? "–"}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {r.startDate ?? "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={() => importMutation.mutate({ rows })}
            disabled={importMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {importMutation.isPending
              ? t("importing")
              : t("importN", { count: rows.length })}
          </button>
        </>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            {result.skipped.length > 0
              ? t("createdSkipped", {
                  count: result.created.length,
                  skipped: result.skipped.length,
                })
              : t("created", { count: result.created.length })}
          </p>
          {result.errors.length > 0 && (
            <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
              {result.errors.map((e) => (
                <li key={`${e.email}-${e.message}`}>
                  {e.email}: {e.message}
                </li>
              ))}
            </ul>
          )}
          {result.warnings && result.warnings.length > 0 && (
            <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
              {result.warnings.map((w) => (
                <li key={`${w.email}-${w.message}`}>
                  {w.email}: {w.message}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/dashboard/enterprise/employees"
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            <Users className="h-4 w-4" />
            {t("goToOverview")}
          </Link>
        </div>
      )}
    </div>
  );
}

export default function EmployeeImportPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="admin">
        <ImportPageContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
