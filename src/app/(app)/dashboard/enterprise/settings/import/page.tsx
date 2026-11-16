"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  FlaskConical,
  Upload,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  parseTimeEntryImport,
  type TimeEntryImportRow,
} from "@/lib/enterprise/import";
import { trpc } from "@/providers/trpc-provider";

const CHUNK_SIZE = 2000;
const MAX_ROWS = 20_000;

interface Summary {
  toImport: number;
  skippedDuplicates: number;
  skippedUnknown: number;
  unknownEmails: string[];
  projectsToCreate: string[];
  activitiesToCreate: string[];
  perProject: Record<string, number>;
  /** Låse-advarsler (#467) — importen gennemføres alligevel */
  warnings: string[];
  dateRange: { from: string; to: string } | null;
}

function emptySummary(): Summary {
  return {
    toImport: 0,
    skippedDuplicates: 0,
    skippedUnknown: 0,
    unknownEmails: [],
    projectsToCreate: [],
    activitiesToCreate: [],
    perProject: {},
    warnings: [],
    dateRange: null,
  };
}

function mergeSummary(a: Summary, b: Summary): Summary {
  const perProject = { ...a.perProject };
  for (const [k, v] of Object.entries(b.perProject)) {
    perProject[k] = Math.round(((perProject[k] ?? 0) + v) * 100) / 100;
  }
  const from = [a.dateRange?.from, b.dateRange?.from]
    .filter(Boolean)
    .sort()[0] as string | undefined;
  const to = [a.dateRange?.to, b.dateRange?.to]
    .filter(Boolean)
    .sort()
    .reverse()[0] as string | undefined;
  return {
    toImport: a.toImport + b.toImport,
    skippedDuplicates: a.skippedDuplicates + b.skippedDuplicates,
    skippedUnknown: a.skippedUnknown + b.skippedUnknown,
    unknownEmails: Array.from(
      new Set([...a.unknownEmails, ...b.unknownEmails]),
    ),
    projectsToCreate: Array.from(
      new Set([...a.projectsToCreate, ...b.projectsToCreate]),
    ),
    activitiesToCreate: Array.from(
      new Set([...a.activitiesToCreate, ...b.activitiesToCreate]),
    ),
    perProject,
    warnings: Array.from(new Set([...a.warnings, ...b.warnings])),
    dateRange: from && to ? { from, to } : null,
  };
}

function TimelogImportContent() {
  const t = useTranslations("enterpriseSettings.timelog");
  const intl = toIntlLocale(useLocale());
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TimeEntryImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<
    Array<{ line: number; message: string }>
  >([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<Summary | null>(null);
  const [importResult, setImportResult] = useState<Summary | null>(null);
  const [running, setRunning] = useState<"dryrun" | "import" | null>(null);
  const [progress, setProgress] = useState(0);

  const importMutation = trpc.enterprise.importTimeEntries.useMutation();

  function handleFile(file: File) {
    setDryRunResult(null);
    setImportResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTimeEntryImport(String(reader.result ?? ""));
      if (parsed.rows.length > MAX_ROWS) {
        setParseErrors([
          {
            line: 1,
            message: t("maxRows", {
              count: parsed.rows.length,
              max: MAX_ROWS,
            }),
          },
        ]);
        setRows([]);
        return;
      }
      setRows(parsed.rows);
      setParseErrors(parsed.errors);
    };
    reader.readAsText(file, "utf-8");
  }

  async function run(dryRun: boolean) {
    setRunning(dryRun ? "dryrun" : "import");
    setProgress(0);
    let summary = emptySummary();
    try {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const result = await importMutation.mutateAsync({
          rows: chunk,
          dryRun,
        });
        summary = mergeSummary(summary, result as Summary);
        setProgress(Math.min(i + CHUNK_SIZE, rows.length));
      }
      if (dryRun) {
        setDryRunResult(summary);
        toast.success(t("testDone"));
      } else {
        setImportResult(summary);
        setDryRunResult(null);
        setRows([]);
        toast.success(t("imported", { count: summary.toImport }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failed"));
    } finally {
      setRunning(null);
    }
  }

  const activeSummary = importResult ?? dryRunResult;

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
        {fileName && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {fileName}
            {rows.length > 0 && ` · ${t("rowCount", { count: rows.length })}`}
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
            {parseErrors.slice(0, 50).map((e) => (
              <li key={`${e.line}-${e.message}`}>
                {t("line", { line: e.line, message: e.message })}
              </li>
            ))}
            {parseErrors.length > 50 && (
              <li>{t("andMore", { count: parseErrors.length - 50 })}</li>
            )}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => run(true)}
            disabled={running !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            <FlaskConical className="h-4 w-4" />
            {running === "dryrun"
              ? t("testing", { progress, total: rows.length })
              : t("runTest")}
          </button>
          <button
            type="button"
            onClick={() => run(false)}
            disabled={running !== null || dryRunResult === null}
            title={dryRunResult === null ? t("runTestFirst") : undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {running === "import"
              ? t("importing", { progress, total: rows.length })
              : t("import")}
          </button>
        </div>
      )}

      {activeSummary && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
            {importResult ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                {t("resultImported", { count: activeSummary.toImport })}
              </>
            ) : (
              <>
                <FlaskConical className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                {t("resultTest", { count: activeSummary.toImport })}
              </>
            )}
            {activeSummary.dateRange &&
              ` ${t("dateRange", {
                from: activeSummary.dateRange.from,
                to: activeSummary.dateRange.to,
              })}`}
          </p>

          <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
            {activeSummary.skippedDuplicates > 0 && (
              <li>
                {t("duplicates", { count: activeSummary.skippedDuplicates })}
              </li>
            )}
            {activeSummary.unknownEmails.length > 0 && (
              <li className="text-amber-700 dark:text-amber-400">
                {t("unknownEmployees", {
                  rows: activeSummary.skippedUnknown,
                  employees: activeSummary.unknownEmails.length,
                  list:
                    activeSummary.unknownEmails.slice(0, 5).join(", ") +
                    (activeSummary.unknownEmails.length > 5
                      ? ` ${t("andMore", { count: activeSummary.unknownEmails.length - 5 })}`
                      : ""),
                })}
              </li>
            )}
            {activeSummary.projectsToCreate.length > 0 && (
              <li>
                {t(importResult ? "createdProjects" : "willCreateProjects", {
                  count: activeSummary.projectsToCreate.length,
                  list:
                    activeSummary.projectsToCreate.slice(0, 8).join(", ") +
                    (activeSummary.projectsToCreate.length > 8 ? " …" : ""),
                })}
              </li>
            )}
            {activeSummary.activitiesToCreate.length > 0 && (
              <li>
                {t(
                  importResult ? "createdActivities" : "willCreateActivities",
                  {
                    count: activeSummary.activitiesToCreate.length,
                    list:
                      activeSummary.activitiesToCreate.slice(0, 8).join(", ") +
                      (activeSummary.activitiesToCreate.length > 8 ? " …" : ""),
                  },
                )}
              </li>
            )}
            {activeSummary.warnings.map((w) => (
              <li key={w} className="text-amber-700 dark:text-amber-400">
                {t("warning", { message: w })}
              </li>
            ))}
          </ul>

          {Object.keys(activeSummary.perProject).length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {t("hoursPerProject")}
              </p>
              <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
                {Object.entries(activeSummary.perProject)
                  .sort(([, a], [, b]) => b - a)
                  .map(([name, hours]) => (
                    <li
                      key={name}
                      className="flex justify-between gap-4 text-gray-600 dark:text-gray-300"
                    >
                      <span className="truncate">{name}</span>
                      <span className="tabular-nums">
                        {hours.toLocaleString(intl, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TimelogImportPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="admin">
        <TimelogImportContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
