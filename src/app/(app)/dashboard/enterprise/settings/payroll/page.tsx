"use client";

import {
  Archive,
  ArchiveRestore,
  Lock,
  Pencil,
  Plus,
  Save,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { PayrollWageLinesPanel } from "@/components/enterprise/PayrollWageLinesPanel";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { Button } from "@/components/ui";
import {
  PAYROLL_PERIOD_TYPES,
  PAYROLL_SYSTEMS,
  type PayrollPeriodType,
  type PayrollSystem,
} from "@/lib/enterprise/payroll/export";
import {
  DAY_CONDITIONS,
  type DayCondition,
  MAPPING_SOURCES,
  type MappingSource,
  WAGE_TYPE_KINDS,
  WAGE_TYPE_UNITS,
  type WageTypeKind,
  type WageTypeUnit,
} from "@/lib/enterprise/payroll/mapping";
import { resolvePayrollPeriod } from "@/lib/enterprise/payroll/period";
import { roleSatisfies } from "@/lib/permissions/org-role";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

type Settings = RouterOutputs["enterprise"]["getPayrollSettings"];

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
const smallInputClass =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
const labelClass =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const thClass =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";
const tdClass = "px-3 py-2 text-sm text-gray-800 dark:text-gray-200";

function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {title}
          </h3>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/* ---------- Lønsystem og lønperiode ---------- */

function SettingsSection({ data }: { data: Settings }) {
  const t = useTranslations("enterprisePayroll");
  const tc = useTranslations("enterpriseCommon");
  const utils = trpc.useUtils();
  const [system, setSystem] = useState<PayrollSystem>(
    data.settings.payrollSystem,
  );
  const [periodType, setPeriodType] = useState<PayrollPeriodType>(
    data.settings.payrollPeriodType,
  );
  const [startDay, setStartDay] = useState(
    String(data.settings.payrollPeriodStartDay),
  );
  const mutation = trpc.enterprise.updatePayrollSettings.useMutation({
    onSuccess: () => {
      utils.enterprise.getPayrollSettings.invalidate();
      toast.success(t("settings.saved"));
    },
    onError: (e) => toast.error(e.message),
  });
  const day = Number(startDay);
  const preview = resolvePayrollPeriod(
    {
      payrollPeriodType: periodType,
      payrollPeriodStartDay: Number.isFinite(day) ? day : 1,
    },
    new Date().toISOString().slice(0, 10),
    -1,
  );
  const dirty =
    system !== data.settings.payrollSystem ||
    periodType !== data.settings.payrollPeriodType ||
    day !== data.settings.payrollPeriodStartDay;

  return (
    <Section
      title={t("settings.title")}
      description={t("settings.description")}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="payroll-system">
            {t("settings.system")}
          </label>
          <select
            id="payroll-system"
            value={system}
            onChange={(e) => setSystem(e.target.value as PayrollSystem)}
            className={inputClass}
          >
            {PAYROLL_SYSTEMS.map((s) => (
              <option key={s} value={s}>
                {tc(`payroll.system.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="payroll-period-type">
            {t("settings.periodType")}
          </label>
          <select
            id="payroll-period-type"
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as PayrollPeriodType)}
            className={inputClass}
          >
            {PAYROLL_PERIOD_TYPES.map((pt) => (
              <option key={pt} value={pt}>
                {tc(`payroll.periodType.${pt}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="payroll-start-day">
            {t("settings.cutoffDay")}
          </label>
          <input
            id="payroll-start-day"
            type="number"
            min={1}
            max={28}
            value={startDay}
            disabled={periodType !== "month"}
            onChange={(e) => setStartDay(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {t("settings.lastClosed", {
          label: preview.label,
          from: preview.from,
          to: preview.to,
        })}
      </p>
      <div className="mt-4">
        <Button
          size="sm"
          disabled={!dirty || mutation.isPending || !(day >= 1 && day <= 28)}
          onClick={() =>
            mutation.mutate({
              payrollSystem: system,
              payrollPeriodType: periodType,
              payrollPeriodStartDay: day,
            })
          }
        >
          <Save className="mr-1.5 h-4 w-4" />
          {mutation.isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </Section>
  );
}

/* ---------- Lønarter ---------- */

type WageTypeDraft = {
  code: string;
  name: string;
  unit: WageTypeUnit;
  kind: WageTypeKind;
};
const EMPTY_WAGE_TYPE: WageTypeDraft = {
  code: "",
  name: "",
  unit: "hours",
  kind: "time",
};

function WageTypesSection({ data }: { data: Settings }) {
  const t = useTranslations("enterprisePayroll");
  const tc = useTranslations("enterpriseCommon");
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WageTypeDraft>(EMPTY_WAGE_TYPE);
  const [showArchived, setShowArchived] = useState(false);

  const invalidate = () => {
    utils.enterprise.getPayrollSettings.invalidate();
    utils.enterprise.previewPayrollExport.invalidate();
    utils.enterprise.runReport.invalidate();
  };
  const create = trpc.enterprise.createWageType.useMutation({
    onSuccess: () => {
      invalidate();
      setDraft(EMPTY_WAGE_TYPE);
      setShowForm(false);
      toast.success(t("wageTypes.created"));
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.enterprise.updateWageType.useMutation({
    onSuccess: (_r, vars) => {
      invalidate();
      setEditingId(null);
      setShowForm(false);
      setDraft(EMPTY_WAGE_TYPE);
      toast.success(
        vars.isArchived === true
          ? t("wageTypes.archived")
          : vars.isArchived === false
            ? t("wageTypes.reactivated")
            : t("wageTypes.saved"),
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = data.wageTypes.filter((w) => showArchived || !w.isArchived);
  const busy = create.isPending || update.isPending;

  function startEdit(w: Settings["wageTypes"][number]) {
    setEditingId(w.id);
    setDraft({
      code: w.code,
      name: w.name,
      unit: w.unit as WageTypeUnit,
      kind: w.kind as WageTypeKind,
    });
    setShowForm(true);
  }
  function submit() {
    if (editingId) update.mutate({ id: editingId, ...draft });
    else create.mutate(draft);
  }

  return (
    <Section
      title={t("wageTypes.title")}
      description={t("wageTypes.description")}
      actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t("showArchived")}
          </label>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setDraft(EMPTY_WAGE_TYPE);
              setShowForm((v) => !v);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("wageTypes.new")}
          </Button>
        </div>
      }
    >
      {showForm && (
        <div className="mb-4 grid gap-3 rounded-lg border border-gray-200 p-4 sm:grid-cols-5 dark:border-gray-700">
          <div>
            <label className={labelClass} htmlFor="wt-code">
              {t("wageTypes.code")}
            </label>
            <input
              id="wt-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder={t("wageTypes.codePlaceholder")}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="wt-name">
              {t("wageTypes.name")}
            </label>
            <input
              id="wt-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t("wageTypes.namePlaceholder")}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="wt-unit">
              {t("wageTypes.unit")}
            </label>
            <select
              id="wt-unit"
              value={draft.unit}
              onChange={(e) =>
                setDraft({ ...draft, unit: e.target.value as WageTypeUnit })
              }
              className={inputClass}
            >
              {WAGE_TYPE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {tc(`payroll.unit.${u}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="wt-kind">
              {t("wageTypes.type")}
            </label>
            <select
              id="wt-kind"
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as WageTypeKind })
              }
              className={inputClass}
            >
              {WAGE_TYPE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {tc(`payroll.kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 sm:col-span-5">
            <Button
              size="sm"
              disabled={busy || !draft.code.trim() || !draft.name.trim()}
              onClick={submit}
            >
              {busy
                ? t("saving")
                : editingId
                  ? t("wageTypes.saveChanges")
                  : t("wageTypes.create")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t("wageTypes.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className={thClass}>{t("wageTypes.colCode")}</th>
                <th className={thClass}>{t("wageTypes.colName")}</th>
                <th className={thClass}>{t("wageTypes.colUnit")}</th>
                <th className={thClass}>{t("wageTypes.colType")}</th>
                <th className={`${thClass} text-right`}>{t("colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr
                  key={w.id}
                  className={`border-b border-gray-100 last:border-0 dark:border-gray-700/50 ${
                    w.isArchived ? "opacity-50" : ""
                  }`}
                >
                  <td className={`${tdClass} tabular-nums text-xs`}>
                    {w.code}
                  </td>
                  <td className={tdClass}>{w.name}</td>
                  <td className={tdClass}>{tc(`payroll.unit.${w.unit}`)}</td>
                  <td className={tdClass}>{tc(`payroll.kind.${w.kind}`)}</td>
                  <td className={`${tdClass} text-right`}>
                    <div className="flex justify-end gap-1">
                      {!w.isArchived && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(w)}
                          title={t("edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        title={w.isArchived ? t("reactivate") : t("archive")}
                        onClick={() =>
                          update.mutate({ id: w.id, isArchived: !w.isArchived })
                        }
                      >
                        {w.isArchived ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ---------- Mapping-regler ---------- */

type RuleDraft = {
  source: MappingSource;
  activityTypeId: string;
  absenceTypeId: string;
  dayCondition: DayCondition;
  wageTypeId: string;
  priority: string;
};

function RulesSection({ data }: { data: Settings }) {
  const t = useTranslations("enterprisePayroll");
  const tc = useTranslations("enterpriseCommon");
  const utils = trpc.useUtils();
  const activeWageTypes = data.wageTypes.filter((w) => !w.isArchived);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<RuleDraft>({
    source: "activity",
    activityTypeId: "",
    absenceTypeId: "",
    dayCondition: "any",
    wageTypeId: activeWageTypes[0]?.id ?? "",
    priority: "100",
  });
  useEffect(() => {
    if (!draft.wageTypeId && activeWageTypes[0]) {
      setDraft((d) => ({ ...d, wageTypeId: activeWageTypes[0].id }));
    }
  }, [draft.wageTypeId, activeWageTypes]);

  const invalidate = () => {
    utils.enterprise.getPayrollSettings.invalidate();
    utils.enterprise.previewPayrollExport.invalidate();
    utils.enterprise.runReport.invalidate();
  };
  const create = trpc.enterprise.createMappingRule.useMutation({
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      toast.success(t("rules.created"));
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.enterprise.updateMappingRule.useMutation({
    onSuccess: (_r, vars) => {
      invalidate();
      toast.success(
        vars.isArchived ? t("rules.archived") : t("rules.reactivated"),
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const wageTypeById = new Map(data.wageTypes.map((w) => [w.id, w]));
  const activityById = new Map(data.activityTypes.map((a) => [a.id, a.name]));
  const absenceById = new Map(data.absenceTypes.map((a) => [a.id, a.name]));
  const rows = data.rules.filter((r) => showArchived || !r.isArchived);
  const busy = create.isPending || update.isPending;

  function targetLabel(r: Settings["rules"][number]): string {
    if (r.source === "activity") {
      return r.activityTypeId
        ? (activityById.get(r.activityTypeId) ?? t("rules.deletedActivity"))
        : t("rules.allActivities");
    }
    if (r.source === "absence") {
      return r.absenceTypeId
        ? (absenceById.get(r.absenceTypeId) ?? t("rules.deletedAbsence"))
        : t("rules.allAbsence");
    }
    return "–";
  }

  return (
    <Section
      title={t("rules.title")}
      description={t("rules.description")}
      actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t("showArchived")}
          </label>
          <Button
            size="sm"
            disabled={activeWageTypes.length === 0}
            onClick={() => setShowForm((v) => !v)}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("rules.new")}
          </Button>
        </div>
      }
    >
      {activeWageTypes.length === 0 && (
        <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
          {t("rules.needWageType")}
        </p>
      )}
      {showForm && (
        <div className="mb-4 grid gap-3 rounded-lg border border-gray-200 p-4 sm:grid-cols-3 dark:border-gray-700">
          <div>
            <label className={labelClass} htmlFor="rule-source">
              {t("rules.source")}
            </label>
            <select
              id="rule-source"
              value={draft.source}
              onChange={(e) =>
                setDraft({ ...draft, source: e.target.value as MappingSource })
              }
              className={inputClass}
            >
              {MAPPING_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {tc(`payroll.source.${s}`)}
                </option>
              ))}
            </select>
          </div>
          {draft.source === "activity" && (
            <div>
              <label className={labelClass} htmlFor="rule-activity">
                {t("rules.activityType")}
              </label>
              <select
                id="rule-activity"
                value={draft.activityTypeId}
                onChange={(e) =>
                  setDraft({ ...draft, activityTypeId: e.target.value })
                }
                className={inputClass}
              >
                <option value="">{t("rules.allActivitiesFallback")}</option>
                {data.activityTypes
                  .filter((a) => !a.isArchived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {draft.source === "absence" && (
            <div>
              <label className={labelClass} htmlFor="rule-absence">
                {t("rules.absenceType")}
              </label>
              <select
                id="rule-absence"
                value={draft.absenceTypeId}
                onChange={(e) =>
                  setDraft({ ...draft, absenceTypeId: e.target.value })
                }
                className={inputClass}
              >
                <option value="">{t("rules.allAbsenceFallback")}</option>
                {data.absenceTypes
                  .filter((a) => !a.isArchived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label className={labelClass} htmlFor="rule-day">
              {t("rules.days")}
            </label>
            <select
              id="rule-day"
              value={draft.dayCondition}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dayCondition: e.target.value as DayCondition,
                })
              }
              className={inputClass}
            >
              {DAY_CONDITIONS.map((d) => (
                <option key={d} value={d}>
                  {tc(`payroll.dayCondition.${d}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="rule-wage-type">
              {t("rules.wageType")}
            </label>
            <select
              id="rule-wage-type"
              value={draft.wageTypeId}
              onChange={(e) =>
                setDraft({ ...draft, wageTypeId: e.target.value })
              }
              className={inputClass}
            >
              {activeWageTypes.map((w) => (
                <option key={w.id} value={w.id}>
                  {t(
                    w.kind === "supplement"
                      ? "rules.wageOptionSupplement"
                      : "rules.wageOption",
                    {
                      code: w.code,
                      name: w.name,
                      unit: tc(`payroll.unit.${w.unit}`).toLowerCase(),
                    },
                  )}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="rule-priority">
              {t("rules.priority")}
            </label>
            <input
              id="rule-priority"
              type="number"
              min={0}
              max={9999}
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button
              size="sm"
              disabled={busy || !draft.wageTypeId}
              onClick={() =>
                create.mutate({
                  source: draft.source,
                  activityTypeId: draft.activityTypeId || null,
                  absenceTypeId: draft.absenceTypeId || null,
                  dayCondition: draft.dayCondition,
                  wageTypeId: draft.wageTypeId,
                  priority: Number(draft.priority) || 100,
                })
              }
            >
              {create.isPending ? t("rules.creating") : t("rules.create")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowForm(false)}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t("rules.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className={thClass}>{t("rules.colSource")}</th>
                <th className={thClass}>{t("rules.colType")}</th>
                <th className={thClass}>{t("rules.colDays")}</th>
                <th className={thClass}>{t("rules.colWage")}</th>
                <th className={`${thClass} text-right`}>
                  {t("rules.colPriority")}
                </th>
                <th className={`${thClass} text-right`}>{t("colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const wt = wageTypeById.get(r.wageTypeId);
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-gray-100 last:border-0 dark:border-gray-700/50 ${
                      r.isArchived ? "opacity-50" : ""
                    }`}
                  >
                    <td className={tdClass}>
                      {tc(`payroll.source.${r.source}`)}
                    </td>
                    <td className={tdClass}>{targetLabel(r)}</td>
                    <td className={tdClass}>
                      {tc(`payroll.dayCondition.${r.dayCondition}`)}
                    </td>
                    <td className={tdClass}>
                      {wt ? (
                        <>
                          <span className="tabular-nums text-xs">
                            {wt.code}
                          </span>{" "}
                          {wt.name}
                          {wt.kind === "supplement" && (
                            <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] uppercase text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                              {t("rules.supplement")}
                            </span>
                          )}
                          {wt.isArchived && (
                            <span className="ml-1 text-xs text-amber-600">
                              {t("rules.archivedWage")}
                            </span>
                          )}
                        </>
                      ) : (
                        "?"
                      )}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {r.priority}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        title={r.isArchived ? t("reactivate") : t("archive")}
                        onClick={() =>
                          update.mutate({ id: r.id, isArchived: !r.isArchived })
                        }
                      >
                        {r.isArchived ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ---------- Fallback-koder på typer ---------- */

function CodeInput({
  initial,
  onSave,
  id,
}: {
  initial: string;
  onSave: (value: string) => void;
  id: string;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <input
      id={id}
      value={value}
      placeholder="–"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() !== initial) onSave(value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`${smallInputClass} max-w-[10rem] tabular-nums`}
    />
  );
}

function FallbackCodesSection({ data }: { data: Settings }) {
  const t = useTranslations("enterprisePayroll");
  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.enterprise.getPayrollSettings.invalidate();
    utils.enterprise.previewPayrollExport.invalidate();
    utils.enterprise.listActivityTypes.invalidate();
    utils.enterprise.listTypes.invalidate();
    utils.enterprise.runReport.invalidate();
  };
  const setAbsence = trpc.enterprise.setAbsenceTypePayrollCode.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("fallback.codeSaved"));
    },
    onError: (e) => toast.error(e.message),
  });
  const setActivity = trpc.enterprise.updateActivityType.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("fallback.codeSaved"));
    },
    onError: (e) => toast.error(e.message),
  });

  const lists: Array<{
    title: string;
    rows: Array<{ id: string; name: string; payrollCode: string | null }>;
    save: (id: string, code: string) => void;
    prefix: string;
  }> = [
    {
      title: t("fallback.activityTitle"),
      rows: data.activityTypes.filter((a) => !a.isArchived),
      save: (id, code) => setActivity.mutate({ id, payrollCode: code || null }),
      prefix: "act",
    },
    {
      title: t("fallback.absenceTitle"),
      rows: data.absenceTypes.filter((a) => !a.isArchived),
      save: (id, code) => setAbsence.mutate({ id, payrollCode: code || null }),
      prefix: "abs",
    },
  ];

  return (
    <Section
      title={t("fallback.title")}
      description={t("fallback.description")}
    >
      <div className="grid gap-6 md:grid-cols-2">
        {lists.map((l) => (
          <div key={l.title}>
            <h4 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {l.title}
            </h4>
            {l.rows.length === 0 ? (
              <p className="text-xs text-gray-500">{t("fallback.noTypes")}</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {l.rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-gray-100 last:border-0 dark:border-gray-700/50"
                    >
                      <td className={tdClass}>
                        <label htmlFor={`${l.prefix}-${r.id}`}>{r.name}</label>
                      </td>
                      <td className={`${tdClass} text-right`}>
                        <CodeInput
                          id={`${l.prefix}-${r.id}`}
                          initial={r.payrollCode ?? ""}
                          onSave={(v) => l.save(r.id, v)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- Medarbejdernumre ---------- */

function EmployeeRow({
  e,
  onSave,
  busy,
}: {
  e: Settings["employees"][number];
  onSave: (v: { employeeNumber: string; externalPayrollId: string }) => void;
  busy: boolean;
}) {
  const t = useTranslations("enterprisePayroll");
  const [number, setNumber] = useState(e.employeeNumber);
  const [external, setExternal] = useState(e.externalPayrollId);
  useEffect(() => {
    setNumber(e.employeeNumber);
    setExternal(e.externalPayrollId);
  }, [e.employeeNumber, e.externalPayrollId]);
  const dirty = number !== e.employeeNumber || external !== e.externalPayrollId;
  return (
    <tr
      className={`border-b border-gray-100 last:border-0 dark:border-gray-700/50 ${
        e.isActive ? "" : "opacity-60"
      }`}
    >
      <td className={tdClass}>
        <div className="font-medium">{e.name}</div>
        <div className="text-xs text-gray-500">{e.email}</div>
      </td>
      <td className={tdClass}>{e.department || "–"}</td>
      <td className={tdClass}>
        <input
          aria-label={t("employees.employeeNumberFor", { name: e.name })}
          value={number}
          onChange={(ev) => setNumber(ev.target.value)}
          placeholder={t("employees.numberPlaceholder")}
          className={`${smallInputClass} max-w-[8rem] tabular-nums`}
        />
      </td>
      <td className={tdClass}>
        <input
          aria-label={t("employees.externalFor", { name: e.name })}
          value={external}
          onChange={(ev) => setExternal(ev.target.value)}
          placeholder={t("employees.optional")}
          className={`${smallInputClass} max-w-[10rem] font-mono`}
        />
      </td>
      <td className={`${tdClass} text-right`}>
        <Button
          size="sm"
          variant={dirty ? "primary" : "ghost"}
          disabled={!dirty || busy}
          onClick={() =>
            onSave({
              employeeNumber: number.trim(),
              externalPayrollId: external.trim(),
            })
          }
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          {t("save")}
        </Button>
      </td>
    </tr>
  );
}

function EmployeeNumbersSection({ data }: { data: Settings }) {
  const t = useTranslations("enterprisePayroll");
  const utils = trpc.useUtils();
  const [showInactive, setShowInactive] = useState(false);
  const [filter, setFilter] = useState("");
  const mutation = trpc.enterprise.setEmployeePayrollIds.useMutation({
    onSuccess: () => {
      utils.enterprise.getPayrollSettings.invalidate();
      utils.enterprise.previewPayrollExport.invalidate();
      utils.enterprise.runReport.invalidate();
      toast.success(t("employees.saved"));
    },
    onError: (e) => toast.error(e.message),
  });
  const q = filter.trim().toLowerCase();
  const rows = data.employees.filter(
    (e) =>
      (showInactive || e.isActive) &&
      (!q ||
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.employeeNumber.toLowerCase().includes(q)),
  );
  const missing = data.employees.filter(
    (e) => e.isActive && !e.employeeNumber,
  ).length;

  return (
    <Section
      title={t("employees.title")}
      description={t("employees.description")}
      actions={
        <div className="flex items-center gap-3">
          <input
            aria-label={t("employees.searchLabel")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("employees.searchPlaceholder")}
            className={`${smallInputClass} max-w-[12rem]`}
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {t("employees.showInactive")}
          </label>
        </div>
      }
    >
      {missing > 0 && (
        <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
          {t("employees.missing", { count: missing })}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className={thClass}>{t("employees.colEmployee")}</th>
              <th className={thClass}>{t("employees.colDepartment")}</th>
              <th className={thClass}>{t("employees.colNumber")}</th>
              <th className={thClass}>{t("employees.colExternal")}</th>
              <th className={`${thClass} text-right`} />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <EmployeeRow
                key={e.profileId}
                e={e}
                busy={mutation.isPending}
                onSave={(v) =>
                  mutation.mutate({
                    profileId: e.profileId,
                    employeeNumber: v.employeeNumber || null,
                    externalPayrollId: v.externalPayrollId || null,
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* ---------- Eksport ---------- */

function ExportSection({ data }: { data: Settings }) {
  const t = useTranslations("enterprisePayroll");
  const [from, setFrom] = useState(data.previousPeriod.from);
  const [to, setTo] = useState(data.previousPeriod.to);
  const [active, setActive] = useState({ from, to });
  return (
    <Section title={t("export.title")} description={t("export.description")}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className={labelClass} htmlFor="exp-from">
            {t("export.from")}
          </label>
          <input
            id="exp-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="exp-to">
            {t("export.to")}
          </label>
          <input
            id="exp-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className={inputClass}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setFrom(data.previousPeriod.from);
            setTo(data.previousPeriod.to);
            setActive(data.previousPeriod);
          }}
        >
          {data.previousPeriod.label}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setFrom(data.currentPeriod.from);
            setTo(data.currentPeriod.to);
            setActive(data.currentPeriod);
          }}
        >
          {data.currentPeriod.label}
        </Button>
        <Button
          size="sm"
          disabled={!from || !to || from > to}
          onClick={() => setActive({ from, to })}
        >
          {t("export.show")}
        </Button>
      </div>
      <PayrollWageLinesPanel params={active} compact />
    </Section>
  );
}

function PayrollSettingsContent() {
  const t = useTranslations("enterprisePayroll");
  const { data, isLoading, error } =
    trpc.enterprise.getPayrollSettings.useQuery();
  // HR må se siden og eksportere, men ikke ændre opsætningen (#489).
  // Serveren (orgAdminProcedure) er stadig autoritativ — ved fejl i
  // rolleopslaget lader vi backend'en afvise.
  const { data: myRole, isError: roleError } =
    trpc.rolePermissions.getMyRole.useQuery(undefined, {
      staleTime: 60_000,
      retry: 1,
    });
  const readOnly = !roleError && !roleSatisfies(myRole?.role, "admin");
  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("page.title")} />
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("page.title")} />
        <p className="text-sm text-red-600">{error?.message}</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.title")}
        actions={
          <Link
            href="/dashboard/enterprise/reports"
            className="text-sm text-brand-600 hover:underline dark:text-brand-400"
          >
            {t("page.openReports")}
          </Link>
        }
      />
      <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
        {t("page.intro")}
      </p>
      {readOnly && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          {t("page.readOnly")}
        </p>
      )}
      {/* Én disabled-kontakt for alle ~15 skrivefelter/knapper i de fem
          opsætningssektioner; native fieldset-disabled rammer også
          knapper i tabelrækkerne. Eksporten holdes udenfor. */}
      <fieldset
        disabled={readOnly}
        className="m-0 min-w-0 space-y-6 border-0 p-0"
      >
        <SettingsSection data={data} />
        <WageTypesSection data={data} />
        <RulesSection data={data} />
        <FallbackCodesSection data={data} />
        <EmployeeNumbersSection data={data} />
      </fieldset>
      <ExportSection data={data} />
    </div>
  );
}

export default function PayrollSettingsPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="hr">
        <PayrollSettingsContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
