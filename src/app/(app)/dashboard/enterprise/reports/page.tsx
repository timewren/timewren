"use client";

import {
  BookmarkPlus,
  CalendarClock,
  CalendarX,
  Download,
  Play,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { PayrollWageLinesPanel } from "@/components/enterprise/PayrollWageLinesPanel";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { downloadCsv } from "@/lib/enterprise/csv";
import {
  getPeriodPreset,
  PERIOD_PRESET_LABELS,
  type PeriodPreset,
  validatePeriod,
} from "@/lib/enterprise/period";
import {
  COLUMN_GROUPS,
  columnDef,
  type EnterpriseColumnKey,
} from "@/lib/enterprise/reporting/columns";
import {
  defaultConfigFor,
  type EnterpriseReportConfig,
  type EnterpriseReportType,
  REPORT_DIMENSIONS,
  type ReportDimension,
  resolveReportPeriod,
} from "@/lib/enterprise/reporting/config";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

const PRESETS = Object.keys(PERIOD_PRESET_LABELS) as PeriodPreset[];

const inputCls =
  "rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800";
const btnSecondary =
  "inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700";
const btnPrimary =
  "inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50";
const chip = (active: boolean) =>
  `rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
    active
      ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
      : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
  }`;

const GROUP_KEYS = [
  "dimensions",
  "employee",
  "time",
  "compliance",
  "absence",
  "overtime",
  "payroll",
  "vacation",
];

/** Talformatering efter aktivt sprog (rapporttabellen og kort). */
function useFormatters() {
  const t = useTranslations("enterpriseReports.page");
  const intl = toIntlLocale(useLocale());
  const formatHours = (v: number) =>
    v.toLocaleString(intl, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  const formatCell = (
    value: string | number | boolean | null | undefined,
    format: string,
  ): string => {
    if (value == null || value === "") return "";
    if (typeof value === "boolean") return value ? t("yes") : t("no");
    if (typeof value === "string") return value;
    switch (format) {
      case "integer":
        return String(Math.round(value));
      case "percent":
        return `${formatHours(value)} %`;
      case "hours":
      case "days":
        return value.toLocaleString(intl, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      default:
        return String(value);
    }
  };
  return { formatHours, formatCell };
}

function downloadBase64(filename: string, base64: string, mime: string) {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bin], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Checkbox-liste i et foldbart panel — til afdelinger/medarbejdere/… */
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; name: string; hint?: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations("enterpriseReports.page");
  if (options.length === 0) return null;
  return (
    <details className="rounded-lg border border-gray-200 dark:border-gray-700">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm">
        {label}
        <span className="ml-1 text-xs text-gray-500">
          {selected.length === 0
            ? t("all")
            : t("selected", { count: selected.length })}
        </span>
      </summary>
      <div className="max-h-48 space-y-1 overflow-y-auto border-t border-gray-100 px-3 py-2 dark:border-gray-700">
        {options.map((o) => {
          const checked = selected.includes(o.id);
          return (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((x) => x !== o.id)
                      : [...selected, o.id],
                  )
                }
              />
              <span>{o.name}</span>
              {o.hint && (
                <span className="text-xs text-gray-400">{o.hint}</span>
              )}
            </label>
          );
        })}
        {selected.length > 0 && (
          <button
            type="button"
            className="mt-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
            onClick={() => onChange([])}
          >
            {t("clear")}
          </button>
        )}
      </div>
    </details>
  );
}

function ReportsPageContent() {
  const t = useTranslations("enterpriseReports.page");
  const tr = useTranslations("enterpriseReports");
  const utils = trpc.useUtils();
  const optionsQuery = trpc.enterprise.getReportOptions.useQuery();
  const templatesQuery = trpc.enterprise.listReportTemplates.useQuery();
  const options = optionsQuery.data;

  const [config, setConfig] = useState<EnterpriseReportConfig>(() =>
    defaultConfigFor("sickness"),
  );
  const [customPeriod, setCustomPeriod] = useState(() =>
    getPeriodPreset("last_month"),
  );
  const [activeConfig, setActiveConfig] =
    useState<EnterpriseReportConfig | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const { data: org } = trpc.enterprise.get.useQuery();
  const vacationYearStartMonth = org?.vacationYearStartMonth ?? 1;
  const resolvedPeriod = useMemo(
    () => resolveReportPeriod(config.period, undefined, vacationYearStartMonth),
    [config.period, vacationYearStartMonth],
  );
  const periodError = validatePeriod(resolvedPeriod.from, resolvedPeriod.to);

  const runQuery = trpc.enterprise.runReport.useQuery(
    { config: activeConfig as EnterpriseReportConfig },
    { enabled: !!activeConfig, placeholderData: (prev) => prev },
  );
  const result = runQuery.data;

  const exportMutation = trpc.enterprise.exportReport.useMutation({
    onSuccess: (res) => {
      if (res.format === "csv") {
        downloadCsv(res.filename, res.data);
      } else {
        downloadBase64(
          res.filename,
          res.data,
          res.format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
        );
      }
      toast.success(t("downloaded"));
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteTemplate = trpc.enterprise.deleteReportTemplate.useMutation({
    onSuccess: () => {
      utils.enterprise.listReportTemplates.invalidate();
      toast.success(t("templateDeleted"));
    },
    onError: (e) => toast.error(e.message),
  });

  function update(patch: Partial<EnterpriseReportConfig>) {
    setConfig((c) => ({ ...c, ...patch }));
  }
  function updateFilters(patch: Partial<EnterpriseReportConfig["filters"]>) {
    setConfig((c) => ({ ...c, filters: { ...c.filters, ...patch } }));
  }
  function selectType(type: EnterpriseReportType) {
    const next = defaultConfigFor(type);
    setConfig({ ...next, period: config.period, filters: config.filters });
    setTemplateId(null);
  }
  function toggleDimension(dim: ReportDimension) {
    const has = config.dimensions.includes(dim);
    const dims = has
      ? config.dimensions.filter((d) => d !== dim)
      : [...config.dimensions, dim];
    if (dims.length > 4) {
      toast.error(t("maxDimensions"));
      return;
    }
    // Dimensionens kolonne følger med
    const columns = has
      ? config.columns.filter((c) => c !== dim)
      : config.columns.includes(dim)
        ? config.columns
        : [dim, ...config.columns];
    update({ dimensions: dims, columns });
  }
  function toggleColumn(key: EnterpriseColumnKey) {
    const has = config.columns.includes(key);
    update({
      columns: has
        ? config.columns.filter((c) => c !== key)
        : [...config.columns, key],
    });
  }
  function applyTemplate(tpl: NonNullable<typeof templatesQuery.data>[number]) {
    if (!tpl.config) {
      toast.error(t("templateUnreadable"));
      return;
    }
    setConfig(tpl.config);
    if (tpl.config.period.kind === "custom") {
      setCustomPeriod({
        from: tpl.config.period.from,
        to: tpl.config.period.to,
      });
    }
    setTemplateId(tpl.id);
    setActiveConfig(tpl.config);
  }
  function run() {
    if (periodError) {
      toast.error(periodError);
      return;
    }
    if (config.columns.length === 0) {
      toast.error(t("needColumn"));
      return;
    }
    setActiveConfig(config);
  }

  const typeDef = options?.reportTypes.find(
    (rt) => rt.type === config.reportType,
  );
  const suggested = new Set<EnterpriseColumnKey>(
    typeDef?.suggestedColumns ?? [],
  );
  const employeeOptions = useMemo(() => {
    const emps = options?.employees ?? [];
    const depts = new Set(config.filters.departmentIds);
    return emps
      .filter(
        (e) =>
          depts.size === 0 || (e.departmentId && depts.has(e.departmentId)),
      )
      .map((e) => ({
        id: e.userId,
        name: e.name,
        hint: e.isActive ? undefined : t("inactive"),
      }));
  }, [options?.employees, config.filters.departmentIds, t]);

  const thisYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      {/* 1. Rapporttype */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t("step1")}
        </h2>
        {optionsQuery.isLoading ? (
          <InlineSpinner />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(options?.reportTypes ?? [])
              .filter((rt) => rt.allowed)
              .map((rt) => (
                <button
                  key={rt.type}
                  type="button"
                  onClick={() => selectType(rt.type)}
                  className={`rounded-xl border p-3 text-left ${
                    config.reportType === rt.type
                      ? "border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
                      : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  }`}
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {tr(`types.${rt.type}.label`)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {tr(`types.${rt.type}.description`)}
                  </div>
                </button>
              ))}
          </div>
        )}
      </section>

      {/* 2. Periode */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t("step2")}{" "}
          <span className="font-normal text-gray-500">
            ({resolvedPeriod.from} – {resolvedPeriod.to})
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={chip(
                config.period.kind === "preset" &&
                  config.period.preset === preset,
              )}
              onClick={() => update({ period: { kind: "preset", preset } })}
            >
              {tr(`presets.${preset}`)}
            </button>
          ))}
          <select
            className={inputCls}
            value={
              config.period.kind === "vacationYear" ? config.period.year : ""
            }
            onChange={(e) =>
              e.target.value &&
              update({
                period: { kind: "vacationYear", year: Number(e.target.value) },
              })
            }
          >
            <option value="">{t("holidayYearPlaceholder")}</option>
            {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>
                {t("holidayYear", { year: y })}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
            {t("from")}
            <input
              type="date"
              className={inputCls}
              value={customPeriod.from}
              onChange={(e) => {
                const next = { ...customPeriod, from: e.target.value };
                setCustomPeriod(next);
                update({ period: { kind: "custom", ...next } });
              }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
            {t("to")}
            <input
              type="date"
              className={inputCls}
              value={customPeriod.to}
              onChange={(e) => {
                const next = { ...customPeriod, to: e.target.value };
                setCustomPeriod(next);
                update({ period: { kind: "custom", ...next } });
              }}
            />
          </label>
        </div>
        {periodError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {periodError}
          </p>
        )}
      </section>

      {/* 3. Filtre */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t("step3")}
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <MultiSelect
            label={t("departments")}
            options={options?.departments ?? []}
            selected={config.filters.departmentIds}
            onChange={(ids) => updateFilters({ departmentIds: ids })}
          />
          <MultiSelect
            label={t("employees")}
            options={employeeOptions}
            selected={config.filters.userIds}
            onChange={(ids) => updateFilters({ userIds: ids })}
          />
          <MultiSelect
            label={t("projects")}
            options={options?.projects ?? []}
            selected={config.filters.projectIds}
            onChange={(ids) => updateFilters({ projectIds: ids })}
          />
          <MultiSelect
            label={t("activities")}
            options={options?.activityTypes ?? []}
            selected={config.filters.activityTypeIds}
            onChange={(ids) => updateFilters({ activityTypeIds: ids })}
          />
          <MultiSelect
            label={t("absenceTypes")}
            options={options?.absenceTypes ?? []}
            selected={config.filters.absenceTypeIds}
            onChange={(ids) => updateFilters({ absenceTypeIds: ids })}
          />
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.filters.onlyApproved}
              onChange={(e) =>
                updateFilters({ onlyApproved: e.target.checked })
              }
            />
            {t("onlyApproved")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.filters.includeRejected}
              onChange={(e) =>
                updateFilters({ includeRejected: e.target.checked })
              }
            />
            {t("includeRejected")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.filters.absenceStatuses.includes("pending")}
              onChange={(e) =>
                updateFilters({
                  absenceStatuses: e.target.checked
                    ? ["approved", "pending"]
                    : ["approved"],
                })
              }
            />
            {t("includePending")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.filters.includeInactive}
              onChange={(e) =>
                updateFilters({ includeInactive: e.target.checked })
              }
            />
            {t("includeInactive")}
          </label>
          {typeDef?.supportsDetails && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.includeDetails}
                onChange={(e) => update({ includeDetails: e.target.checked })}
              />
              {t("includeDetails")}
            </label>
          )}
        </div>
      </section>

      {/* 4. Dimensioner */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t("step4")}{" "}
          <span className="font-normal text-gray-500">{t("step4Hint")}</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {REPORT_DIMENSIONS.map((dim) => {
            const idx = config.dimensions.indexOf(dim);
            return (
              <button
                key={dim}
                type="button"
                className={chip(idx >= 0)}
                onClick={() => toggleDimension(dim)}
              >
                {idx >= 0 ? `${idx + 1}. ` : ""}
                {tr(`dimensions.${dim}`)}
              </button>
            );
          })}
        </div>
      </section>

      {/* 5. Kolonner */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t("step5")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COLUMN_GROUPS.map((g, gi) => (
            <div
              key={g.label}
              className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            >
              <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
                {tr(`groups.${GROUP_KEYS[gi] ?? g.label}`)}
              </div>
              <div className="space-y-1">
                {g.keys.map((key) => {
                  const def = columnDef(key);
                  const isDim = def.kind === "dimension";
                  const disabled =
                    isDim &&
                    !config.dimensions.includes(key as ReportDimension);
                  return (
                    <label
                      key={key}
                      title={def.help ? tr(`columns.${key}.help`) : undefined}
                      className={`flex items-center gap-2 text-sm ${
                        disabled
                          ? "text-gray-400"
                          : suggested.has(key)
                            ? "text-gray-900 dark:text-gray-100"
                            : "text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={config.columns.includes(key)}
                        onChange={() => toggleColumn(key)}
                      />
                      {tr(`columns.${key}.label`)}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Handlinger */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={run}
          disabled={!!periodError || runQuery.isFetching}
        >
          <Play className="h-4 w-4" />
          {t("run")}
        </button>
        {(["csv", "xlsx", "pdf"] as const).map((format) => (
          <button
            key={format}
            type="button"
            className={btnSecondary}
            disabled={!activeConfig || exportMutation.isPending}
            onClick={() =>
              activeConfig &&
              exportMutation.mutate({ config: activeConfig, format })
            }
          >
            <Download className="h-4 w-4" />
            {format.toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          className={btnSecondary}
          onClick={() => setSaveOpen(true)}
        >
          <BookmarkPlus className="h-4 w-4" />
          {t("saveAsTemplate")}
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={!templateId}
          title={templateId ? undefined : t("chooseTemplateFirst")}
          onClick={() => setScheduleOpen(true)}
        >
          <CalendarClock className="h-4 w-4" />
          {t("scheduleMail")}
        </button>
      </div>

      {/* Resultat */}
      {runQuery.error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
          {runQuery.error.message}
        </p>
      )}
      {activeConfig && runQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <InlineSpinner />
        </div>
      ) : result ? (
        <ResultView result={result} config={activeConfig} />
      ) : null}

      {/* Skabeloner */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t("savedTemplates")}
        </h2>
        {templatesQuery.isLoading ? (
          <InlineSpinner />
        ) : (templatesQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">{t("noTemplates")}</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {(templatesQuery.data ?? []).map((tpl) => (
              <li
                key={tpl.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => applyTemplate(tpl)}
                >
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {tpl.name}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {tpl.shared ? t("sharedOrg") : t("onlyMe")}
                      {tpl.isSystem ? t("standard") : ""}
                    </span>
                  </div>
                  {tpl.description && (
                    <div className="truncate text-xs text-gray-500">
                      {tpl.description}
                    </div>
                  )}
                </button>
                {!tpl.isSystem &&
                  (tpl.ownedByMe ||
                    (tpl.shared && options?.canShareTemplates)) && (
                    <button
                      type="button"
                      className="text-gray-400 hover:text-red-600"
                      title={t("deleteTemplate")}
                      onClick={() => {
                        if (
                          confirm(
                            t("confirmDeleteTemplate", { name: tpl.name }),
                          )
                        ) {
                          deleteTemplate.mutate({ id: tpl.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <SchedulesList />

      {saveOpen && (
        <SaveTemplateModal
          config={config}
          canShare={!!options?.canShareTemplates}
          onClose={() => setSaveOpen(false)}
          onSaved={(id) => {
            setTemplateId(id);
            setSaveOpen(false);
          }}
        />
      )}
      {scheduleOpen && templateId && (
        <ScheduleModal
          templateId={templateId}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t("footnote")}
      </p>
    </div>
  );
}

type RunResult = RouterOutputs["enterprise"]["runReport"];

function ResultView({
  result,
  config,
}: {
  result: RunResult;
  config: EnterpriseReportConfig | null;
}) {
  const t = useTranslations("enterpriseReports.page");
  const tr = useTranslations("enterpriseReports");
  const { formatHours, formatCell } = useFormatters();
  const { table, summary, details } = result;
  // Lønart-fordeling (E5) følger rapportens periode og medarbejderfiltre
  const payrollParams = config
    ? {
        from: result.period.from,
        to: result.period.to,
        departmentIds: config.filters.departmentIds,
        includeInactive: config.filters.includeInactive,
        onlyApproved: config.filters.onlyApproved,
      }
    : null;
  const cards: Array<[string, string]> = [
    [t("cardEmployees"), String(summary.employeeCount)],
    [tr("columns.hours.label"), formatHours(summary.hours)],
    [tr("columns.normHours.label"), formatHours(summary.normHours)],
    [
      tr("columns.flexDelta.label"),
      `${summary.flexDelta > 0 ? "+" : ""}${formatHours(summary.flexDelta)}`,
    ],
    [tr("columns.absenceDays.label"), formatHours(summary.absenceDays)],
    [tr("columns.sickDays.label"), formatHours(summary.sickDays)],
    [
      tr("columns.sickPct.label"),
      summary.sickPct == null ? "–" : `${formatHours(summary.sickPct)} %`,
    ],
    [tr("columns.longTermSickCount.label"), String(summary.longTermSickCount)],
  ];
  const numeric = (i: number) =>
    table.columns[i].format !== "text" && table.columns[i].format !== "boolean";

  if (table.rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-12 text-center dark:border-gray-800">
        <CalendarX className="mx-auto h-10 w-10 text-gray-400" />
        <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">
          {t("noData", { from: result.period.from, to: result.period.to })}
        </h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {t("noDataHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {cards.map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left dark:border-gray-700">
              {table.columns.map((c, i) => (
                <th
                  key={c.id}
                  className={`whitespace-nowrap px-3 py-2 font-medium text-gray-500 dark:text-gray-400 ${numeric(i) ? "text-right" : ""}`}
                >
                  {c.pivotName
                    ? tr(`columns.${c.key}.pivot`, { name: c.pivotName })
                    : tr(`columns.${c.key}.label`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, ri) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                key={ri}
                className={
                  r.subtotal
                    ? "border-b border-gray-200 bg-gray-50 font-medium dark:border-gray-700 dark:bg-gray-700/40"
                    : "border-b border-gray-100 dark:border-gray-700/50"
                }
              >
                {r.cells.map((v, i) => (
                  <td
                    key={table.columns[i].id}
                    className={`whitespace-nowrap px-3 py-1.5 ${numeric(i) ? "text-right tabular-nums" : ""}`}
                  >
                    {formatCell(v, table.columns[i].format) || "–"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 font-semibold dark:border-gray-700">
              {table.totals.map((v, i) => (
                <td
                  key={table.columns[i].id}
                  className={`whitespace-nowrap px-3 py-2 ${numeric(i) ? "text-right tabular-nums" : ""}`}
                >
                  {formatCell(v, table.columns[i].format)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {result.reportType === "payroll" && payrollParams && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
          <PayrollWageLinesPanel params={payrollParams} compact />
        </div>
      )}

      {details && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t("allEntries", { count: details.rows.length })}
          </h3>
          {details.truncated && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {t("truncated")}
            </p>
          )}
          <div className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white dark:bg-gray-800">
                <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                  {[
                    t("detEmployee"),
                    t("detDepartment"),
                    t("detDate"),
                    t("detHours"),
                    t("detProject"),
                    t("detActivity"),
                    t("detPayCode"),
                    t("detDescription"),
                    t("detSource"),
                    t("detStatus"),
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-2 py-1.5 font-medium text-gray-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {details.rows.map((d, i) => (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                    key={i}
                    className="border-b border-gray-100 dark:border-gray-700/50"
                  >
                    <td className="px-2 py-1">{d.name}</td>
                    <td className="px-2 py-1">{d.department}</td>
                    <td className="px-2 py-1">{d.date}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatHours(d.hours)}
                    </td>
                    <td className="px-2 py-1">{d.project}</td>
                    <td className="px-2 py-1">{d.activity}</td>
                    <td className="px-2 py-1">{d.payrollCode}</td>
                    <td className="max-w-xs truncate px-2 py-1">
                      {d.description}
                    </td>
                    <td className="px-2 py-1">{d.source}</td>
                    <td className="px-2 py-1">{d.approvalStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SaveTemplateModal({
  config,
  canShare,
  onClose,
  onSaved,
}: {
  config: EnterpriseReportConfig;
  canShare: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("enterpriseReports.page");
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const save = trpc.enterprise.saveReportTemplate.useMutation({
    onSuccess: (saved) => {
      utils.enterprise.listReportTemplates.invalidate();
      toast.success(t("templateSaved"));
      onSaved(saved.id);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal title={t("saveTemplateTitle")} onClose={onClose}>
      <label className="block text-sm">
        {t("name")}
        <input
          className={`${inputCls} mt-1 w-full`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
      </label>
      <label className="block text-sm">
        {t("description")}
        <input
          className={`${inputCls} mt-1 w-full`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </label>
      {canShare && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />
          {t("shareWithOrg")}
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          {t("cancel")}
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={!name.trim() || save.isPending}
          onClick={() =>
            save.mutate({
              name: name.trim(),
              description: description.trim() || undefined,
              config,
              shared,
            })
          }
        >
          {t("save")}
        </button>
      </div>
    </Modal>
  );
}

function ScheduleModal({
  templateId,
  onClose,
}: {
  templateId: string;
  onClose: () => void;
}) {
  const t = useTranslations("enterpriseReports.page");
  const tr = useTranslations("enterpriseReports");
  const utils = trpc.useUtils();
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("monthly");
  const [sendDay, setSendDay] = useState(1);
  const [recipients, setRecipients] = useState("");
  const [format, setFormat] = useState<"xlsx" | "csv" | "pdf">("xlsx");
  const schedule = trpc.enterprise.scheduleReport.useMutation({
    onSuccess: () => {
      utils.enterprise.listReportSchedules.invalidate();
      toast.success(t("scheduled"));
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const emails = recipients
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <Modal title={t("scheduleTitle")} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label>
          {t("frequency")}
          <select
            className={`${inputCls} mt-1 w-full`}
            value={frequency}
            onChange={(e) => {
              setFrequency(e.target.value as "weekly" | "monthly");
              setSendDay(1);
            }}
          >
            <option value="weekly">{t("weekly")}</option>
            <option value="monthly">{t("monthly")}</option>
          </select>
        </label>
        <label>
          {frequency === "weekly" ? t("weekday") : t("dayOfMonth")}
          <select
            className={`${inputCls} mt-1 w-full`}
            value={sendDay}
            onChange={(e) => setSendDay(Number(e.target.value))}
          >
            {frequency === "weekly"
              ? [1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {tr(`weekdays.${d}`)}
                  </option>
                ))
              : Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {t("dayN", { day: d })}
                  </option>
                ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        {t("recipients")}
        <input
          className={`${inputCls} mt-1 w-full`}
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder={t("recipientsPlaceholder")}
        />
      </label>
      <label className="block text-sm">
        {t("format")}
        <select
          className={`${inputCls} mt-1 w-full`}
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
        >
          <option value="xlsx">{t("formatXlsx")}</option>
          <option value="csv">CSV</option>
          <option value="pdf">PDF</option>
        </select>
      </label>
      <p className="text-xs text-gray-500">{t("rollingNote")}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          {t("cancel")}
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={emails.length === 0 || schedule.isPending}
          onClick={() =>
            schedule.mutate({
              reportTemplateId: templateId,
              frequency,
              sendDay,
              recipients: emails,
              format,
            })
          }
        >
          {t("schedule")}
        </button>
      </div>
    </Modal>
  );
}

function SchedulesList() {
  const t = useTranslations("enterpriseReports.page");
  const intl = toIntlLocale(useLocale());
  const utils = trpc.useUtils();
  const { data } = trpc.enterprise.listReportSchedules.useQuery();
  const remove = trpc.enterprise.deleteReportSchedule.useMutation({
    onSuccess: () => {
      utils.enterprise.listReportSchedules.invalidate();
      toast.success(t("scheduleRemoved"));
    },
    onError: (e) => toast.error(e.message),
  });
  if (!data || data.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
        {t("scheduledMails")}
      </h2>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {data.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium text-gray-900 dark:text-white">
                {s.templateName}
              </span>{" "}
              <span className="text-gray-500">
                {t("scheduleLine", {
                  frequency:
                    s.frequency === "weekly"
                      ? t("freqWeeklyLower")
                      : t("freqMonthlyLower"),
                  day: s.sendDay,
                  format: s.format.toUpperCase(),
                  recipients: s.recipients.join(", "),
                })}
                {s.lastSentAt
                  ? t("lastSent", {
                      date: new Date(s.lastSentAt).toLocaleDateString(intl),
                    })
                  : ""}
              </span>
            </div>
            <button
              type="button"
              className="text-gray-400 hover:text-red-600"
              title={t("remove")}
              onClick={() => remove.mutate({ id: s.id })}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="presentation"
    >
      <div
        className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

export default function EnterpriseReportsPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="manager">
        <ReportsPageContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
