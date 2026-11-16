"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import {
  FlexNormSettingsSection,
  PeriodClosingSettingsSection,
} from "@/components/enterprise/FlexNormSettingsSections";
import { NotificationSettingsSection } from "@/components/enterprise/NotificationSettingsSection";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  type AbsenceCategory,
  toAbsenceCategory,
} from "@/lib/enterprise/absence-registration";
import { trpc } from "@/providers/trpc-provider";

type ComplianceRuleMode = "off" | "warn" | "block";

const COMPLIANCE_RULES: Array<{
  key: "rule48h" | "dailyRest" | "weeklyRest";
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    key: "rule48h",
    labelKey: "compliance.rule48hLabel",
    descriptionKey: "compliance.rule48hDesc",
  },
  {
    key: "dailyRest",
    labelKey: "compliance.dailyRestLabel",
    descriptionKey: "compliance.dailyRestDesc",
  },
  {
    key: "weeklyRest",
    labelKey: "compliance.weeklyRestLabel",
    descriptionKey: "compliance.weeklyRestDesc",
  },
];

const RULE_MODE_KEYS: Record<ComplianceRuleMode, string> = {
  off: "compliance.modeOff",
  warn: "compliance.modeWarn",
  block: "compliance.modeBlock",
};

function ComplianceSection() {
  const fid = useId();
  const t = useTranslations("enterpriseSettings");
  const { data } = trpc.enterprise.getComplianceOverview.useQuery();
  const utils = trpc.useUtils();

  const [rules, setRules] = useState<Record<
    "rule48h" | "dailyRest" | "weeklyRest",
    ComplianceRuleMode
  > | null>(null);
  const [referencePeriod, setReferencePeriod] = useState<"4" | "12">("4");

  useEffect(() => {
    if (data?.settings) {
      setRules(data.settings.rules);
      setReferencePeriod(
        data.settings.referencePeriodMonths === 12 ? "12" : "4",
      );
    }
  }, [data?.settings]);

  const updateMutation = trpc.enterprise.updateComplianceSettings.useMutation({
    onSuccess: () => {
      utils.enterprise.getComplianceOverview.invalidate();
      toast.success(t("compliance.updated"));
    },
    onError: (error) => {
      toast.error(error.message || t("compliance.saveFailed"));
    },
  });

  const labelClass =
    "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";

  return (
    <SettingsSection title={t("compliance.title")}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t.rich("compliance.intro", {
            link: (chunks) => (
              <Link
                href="/dashboard/enterprise/compliance"
                className="text-brand-600 hover:underline dark:text-brand-400"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
        {COMPLIANCE_RULES.map((rule) => (
          <div
            key={rule.key}
            className="grid gap-2 sm:grid-cols-[1fr_220px] sm:items-start"
          >
            <div>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t(rule.labelKey)}
              </span>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t(rule.descriptionKey)}
              </p>
            </div>
            <select
              aria-label={t(rule.labelKey)}
              value={rules?.[rule.key] ?? "warn"}
              disabled={!rules}
              onChange={(e) => {
                const mode = e.target.value as ComplianceRuleMode;
                setRules((prev) =>
                  prev ? { ...prev, [rule.key]: mode } : prev,
                );
                updateMutation.mutate({ [rule.key]: mode });
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {(["off", "warn", "block"] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(RULE_MODE_KEYS[mode])}
                </option>
              ))}
            </select>
          </div>
        ))}

        <div className="max-w-[300px]">
          <label htmlFor={`${fid}-f1`} className={labelClass}>
            {t("compliance.referencePeriod")}
          </label>
          <select
            id={`${fid}-f1`}
            value={referencePeriod}
            onChange={(e) => {
              const val = e.target.value as "4" | "12";
              setReferencePeriod(val);
              updateMutation.mutate({
                complianceReferencePeriodMonths: val,
              });
            }}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            <option value="4">{t("compliance.period4")}</option>
            <option value="12">{t("compliance.period12")}</option>
          </select>
        </div>
      </div>
    </SettingsSection>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

type BreakPolicy = "none" | "paid_included" | "unpaid_excluded";

const BREAK_POLICY_OPTIONS: Array<{
  value: BreakPolicy;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: "none",
    labelKey: "break.noneLabel",
    descriptionKey: "break.noneDesc",
  },
  {
    value: "paid_included",
    labelKey: "break.paidLabel",
    descriptionKey: "break.paidDesc",
  },
  {
    value: "unpaid_excluded",
    labelKey: "break.unpaidLabel",
    descriptionKey: "break.unpaidDesc",
  },
];

function parseDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isNaN(value) ? Number.NaN : value;
}

function formatDecimal(
  value: string | number | null | undefined,
  decimalSeparator = ",",
): string {
  if (value == null || value === "") return "";
  return String(Number(value)).replace(".", decimalSeparator);
}

/** Arbejdstid og pauser (#449): ugetimer-default, dagsnorm, pause + politik. */
function WorkSettingsSection({
  org,
  inputClass,
  labelClass,
}: {
  org: {
    defaultWeeklyHours: string | null;
    dailyNormHours: string | null;
    breakMinutesPerDay: number | null;
    breakPolicy: string | null;
  } | null;
  inputClass: string;
  labelClass: string;
}) {
  const t = useTranslations("enterpriseSettings");
  const utils = trpc.useUtils();
  const [weeklyHours, setWeeklyHours] = useState("37");
  const [dailyNorm, setDailyNorm] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [policy, setPolicy] = useState<BreakPolicy>("none");

  useEffect(() => {
    if (!org) return;
    setWeeklyHours(formatDecimal(org.defaultWeeklyHours ?? 37));
    setDailyNorm(formatDecimal(org.dailyNormHours));
    setBreakMinutes(String(org.breakMinutesPerDay ?? 0));
    setPolicy(
      (["none", "paid_included", "unpaid_excluded"] as BreakPolicy[]).includes(
        org.breakPolicy as BreakPolicy,
      )
        ? (org.breakPolicy as BreakPolicy)
        : "none",
    );
  }, [org]);

  const mutation = trpc.enterprise.updateWorkSettings.useMutation({
    onSuccess: () => {
      utils.enterprise.get.invalidate();
      utils.enterprise.getTimesheetWeek.invalidate();
      utils.enterprise.getTeamWeekOverview.invalidate();
      utils.enterprise.getCheckInStatus.invalidate();
      utils.enterprise.getPayrollReport.invalidate();
      toast.success(t("work.saved"));
    },
    onError: (error) => toast.error(error.message || t("work.saveFailed")),
  });

  const weeklyPreview = parseDecimal(weeklyHours);
  const dailyPreview = parseDecimal(dailyNorm);
  const fallbackDaily =
    weeklyPreview && weeklyPreview > 0
      ? Math.round((weeklyPreview / 5) * 100) / 100
      : null;

  const save = () => {
    const weekly = parseDecimal(weeklyHours);
    if (weekly === null || Number.isNaN(weekly) || weekly < 1 || weekly > 80) {
      toast.error(t("work.weeklyRange"));
      return;
    }
    const daily = parseDecimal(dailyNorm);
    if (daily !== null && (Number.isNaN(daily) || daily < 0.5 || daily > 24)) {
      toast.error(t("work.dailyRange"));
      return;
    }
    const minutes = breakMinutes.trim() === "" ? 0 : Number(breakMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) {
      toast.error(t("work.breakRange"));
      return;
    }
    if (policy !== "none" && minutes === 0) {
      toast.error(t("work.breakNeeded"));
      return;
    }
    mutation.mutate({
      defaultWeeklyHours: weekly,
      dailyNormHours: daily,
      breakMinutesPerDay: minutes,
      breakPolicy: policy,
    });
  };

  return (
    <SettingsSection title={t("work.title")}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="work-weekly-hours">
              {t("work.weeklyLabel")}
            </label>
            <input
              id="work-weekly-hours"
              type="text"
              inputMode="decimal"
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value)}
              placeholder="37"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("work.weeklyHelp")}
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="work-daily-norm">
              {t("work.dailyLabel")}
            </label>
            <input
              id="work-daily-norm"
              type="text"
              inputMode="decimal"
              value={dailyNorm}
              onChange={(e) => setDailyNorm(e.target.value)}
              placeholder={
                fallbackDaily != null
                  ? t("work.dailyPlaceholderAuto", {
                      value: formatDecimal(fallbackDaily),
                    })
                  : t("work.dailyPlaceholder")
              }
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {dailyPreview && weeklyPreview && !Number.isNaN(dailyPreview)
                ? t("work.dailyHelpExample", {
                    value: formatDecimal(
                      Math.round(dailyPreview * (30 / weeklyPreview) * 10) / 10,
                    ),
                  })
                : t("work.dailyHelp")}
            </p>
          </div>
        </div>

        <div className="max-w-[260px]">
          <label className={labelClass} htmlFor="work-break-minutes">
            {t("work.breakMinutes")}
          </label>
          <input
            id="work-break-minutes"
            type="number"
            min={0}
            max={240}
            step={5}
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            className={inputClass}
          />
        </div>

        <fieldset>
          <legend className={labelClass}>{t("work.breakPolicy")}</legend>
          <div className="space-y-2">
            {BREAK_POLICY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors ${
                  policy === option.value
                    ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-tt-gran-lys"
                    : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                }`}
              >
                <input
                  type="radio"
                  name="break-policy"
                  value={option.value}
                  checked={policy === option.value}
                  onChange={() => setPolicy(option.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-gray-900 dark:text-gray-100">
                    {t(option.labelKey)}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {t(option.descriptionKey)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t("work.footnote")}
        </p>

        <div>
          <Button onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

/** Timeseddel-regler (#467): maks/dag, advarsel over norm, tomme dage, rullende lås. */
function TimesheetRulesSection({
  org,
  inputClass,
  labelClass,
}: {
  org: {
    timesheetMaxHoursPerDay: string | null;
    timesheetWarnOverNorm: boolean | null;
    timesheetBlockEmptyWorkdays: boolean | null;
    timesheetLockAfterWeeks: number | null;
    timesheetAutoLockWeekday: number | null;
  } | null;
  inputClass: string;
  labelClass: string;
}) {
  const t = useTranslations("enterpriseSettings");
  const tc = useTranslations("enterpriseCommon");
  const utils = trpc.useUtils();
  const [maxHours, setMaxHours] = useState("24");
  const [warnOverNorm, setWarnOverNorm] = useState(true);
  const [blockEmpty, setBlockEmpty] = useState(false);
  const [lockWeeks, setLockWeeks] = useState("");
  const [autoLockWeekday, setAutoLockWeekday] = useState("");

  useEffect(() => {
    if (!org) return;
    setMaxHours(formatDecimal(org.timesheetMaxHoursPerDay ?? 24));
    setWarnOverNorm(org.timesheetWarnOverNorm ?? true);
    setBlockEmpty(org.timesheetBlockEmptyWorkdays ?? false);
    setLockWeeks(
      org.timesheetLockAfterWeeks == null
        ? ""
        : String(org.timesheetLockAfterWeeks),
    );
    setAutoLockWeekday(
      org.timesheetAutoLockWeekday == null
        ? ""
        : String(org.timesheetAutoLockWeekday),
    );
  }, [org]);

  const mutation = trpc.enterprise.updateTimesheetRules.useMutation({
    onSuccess: () => {
      utils.enterprise.get.invalidate();
      utils.enterprise.getTimesheetWeek.invalidate();
      toast.success(t("rules.saved"));
    },
    onError: (error) => toast.error(error.message || t("rules.saveFailed")),
  });

  const save = () => {
    const max = parseDecimal(maxHours);
    if (max === null || Number.isNaN(max) || max < 1 || max > 24) {
      toast.error(t("rules.maxRange"));
      return;
    }
    const weeks = lockWeeks.trim() === "" ? null : Number(lockWeeks);
    if (
      weeks !== null &&
      (!Number.isInteger(weeks) || weeks < 0 || weeks > 104)
    ) {
      toast.error(t("rules.lockRange"));
      return;
    }
    mutation.mutate({
      maxHoursPerDay: max,
      warnOverNorm,
      blockEmptyWorkdays: blockEmpty,
      lockAfterWeeks: weeks,
      autoLockWeekday: autoLockWeekday === "" ? null : Number(autoLockWeekday),
    });
  };

  const checkClass =
    "flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300";

  return (
    <SettingsSection title={t("rules.title")}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ts-max-hours">
              {t("rules.maxPerDay")}
            </label>
            <input
              id="ts-max-hours"
              type="text"
              inputMode="decimal"
              value={maxHours}
              onChange={(e) => setMaxHours(e.target.value)}
              placeholder="24"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("rules.maxHelp")}
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="ts-lock-weeks">
              {t("rules.rollingLock")}
            </label>
            <input
              id="ts-lock-weeks"
              type="number"
              min={0}
              max={104}
              step={1}
              value={lockWeeks}
              onChange={(e) => setLockWeeks(e.target.value)}
              placeholder={t("rules.noLockPlaceholder")}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("rules.lockHelp")}
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="ts-auto-lock">
              {t("rules.autoLock")}
            </label>
            <select
              id="ts-auto-lock"
              value={autoLockWeekday}
              onChange={(e) => setAutoLockWeekday(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("rules.noAutoLock")}</option>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={String(d)}>
                  {t("rules.locksOn", { day: tc(`weekdayLong.${d}`) })}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("rules.autoLockHelp")}
            </p>
          </div>
        </div>

        <label className={checkClass}>
          <input
            type="checkbox"
            checked={warnOverNorm}
            onChange={(e) => setWarnOverNorm(e.target.checked)}
            className="mt-0.5 rounded border"
          />
          <span>
            {t("rules.warnOverNorm")}
            <span className="block text-xs text-gray-400 dark:text-gray-500">
              {t("rules.warnOverNormHelp")}
            </span>
          </span>
        </label>
        <label className={checkClass}>
          <input
            type="checkbox"
            checked={blockEmpty}
            onChange={(e) => setBlockEmpty(e.target.checked)}
            className="mt-0.5 rounded border"
          />
          <span>
            {t("rules.blockEmpty")}
            <span className="block text-xs text-gray-400 dark:text-gray-500">
              {t("rules.blockEmptyHelp")}
            </span>
          </span>
        </label>

        <div>
          <Button onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

const CATEGORY_VALUES: AbsenceCategory[] = [
  "vacation",
  "sickness",
  "leave",
  "other",
];

type AbsenceTypeDraft = {
  name: string;
  color: string;
  category: AbsenceCategory;
  requiresApproval: boolean;
  requiresDocumentation: boolean;
  annualCapDays: string;
  visibleToColleagues: boolean;
};

const EMPTY_TYPE_DRAFT: AbsenceTypeDraft = {
  name: "",
  color: "#3b82f6",
  category: "other",
  requiresApproval: true,
  requiresDocumentation: false,
  annualCapDays: "",
  visibleToColleagues: true,
};

function parseCap(raw: string): number | null | "invalid" {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (Number.isNaN(n) || n < 0.5 || n > 365) return "invalid";
  return n;
}

/** Felter for kategori, godkendelse, dokumentation, årsloft og synlighed (#460). */
function AbsenceTypeFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: AbsenceTypeDraft;
  onChange: (next: AbsenceTypeDraft) => void;
  idPrefix: string;
}) {
  const t = useTranslations("enterpriseSettings.absenceTypes");
  const tc = useTranslations("enterpriseCommon");
  const inputClass =
    "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
  const labelClass =
    "mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300";
  const checkClass =
    "flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-category`}>
          {t("category")}
        </label>
        <select
          id={`${idPrefix}-category`}
          value={draft.category}
          onChange={(e) =>
            onChange({
              ...draft,
              category: e.target.value as AbsenceCategory,
            })
          }
          className={inputClass}
        >
          {CATEGORY_VALUES.map((value) => (
            <option key={value} value={value}>
              {tc(`absenceCategory.${value}`)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {t("categoryHelp")}
        </p>
      </div>
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-cap`}>
          {t("cap")}
        </label>
        <input
          id={`${idPrefix}-cap`}
          type="text"
          inputMode="decimal"
          value={draft.annualCapDays}
          onChange={(e) =>
            onChange({ ...draft, annualCapDays: e.target.value })
          }
          placeholder={t("capPlaceholder")}
          className={inputClass}
        />
      </div>
      <label className={checkClass}>
        <input
          type="checkbox"
          checked={draft.requiresApproval}
          onChange={(e) =>
            onChange({ ...draft, requiresApproval: e.target.checked })
          }
          className="rounded border"
        />
        {t("requiresApproval")}
      </label>
      <label className={checkClass}>
        <input
          type="checkbox"
          checked={draft.requiresDocumentation}
          onChange={(e) =>
            onChange({ ...draft, requiresDocumentation: e.target.checked })
          }
          className="rounded border"
        />
        {t("requiresDocumentation")}
      </label>
      <label className={checkClass}>
        <input
          type="checkbox"
          checked={draft.visibleToColleagues}
          onChange={(e) =>
            onChange({ ...draft, visibleToColleagues: e.target.checked })
          }
          className="rounded border"
        />
        {t("visibleToColleagues")}
      </label>
    </div>
  );
}

function AbsenceTypesSection() {
  const t = useTranslations("enterpriseSettings.absenceTypes");
  const tc = useTranslations("enterpriseCommon");
  const ts = useTranslations("enterpriseSettings");
  const utils = trpc.useUtils();
  const { data: types, isLoading } = trpc.enterprise.listTypes.useQuery();
  const [draft, setDraft] = useState<AbsenceTypeDraft>(EMPTY_TYPE_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] =
    useState<AbsenceTypeDraft>(EMPTY_TYPE_DRAFT);

  const createMutation = trpc.enterprise.createType.useMutation({
    onSuccess: () => {
      utils.enterprise.listTypes.invalidate();
      setDraft(EMPTY_TYPE_DRAFT);
      toast.success(t("created"));
    },
    onError: (err) => toast.error(err.message || t("createFailed")),
  });

  const updateMutation = trpc.enterprise.updateType.useMutation({
    onSuccess: () => {
      utils.enterprise.listTypes.invalidate();
      setEditingId(null);
      toast.success(t("updated"));
    },
    onError: (err) => toast.error(err.message || t("updateFailed")),
  });

  const deleteMutation = trpc.enterprise.deleteType.useMutation({
    onSuccess: () => {
      utils.enterprise.listTypes.invalidate();
      toast.success(t("deleted"));
    },
    onError: (err) => toast.error(err.message || t("deleteFailed")),
  });

  const startEdit = (ty: NonNullable<typeof types>[number]) => {
    setEditingId(ty.id);
    setEditDraft({
      name: ty.name,
      color: ty.color ?? "#3b82f6",
      category: toAbsenceCategory(ty.category),
      requiresApproval: ty.requiresApproval,
      requiresDocumentation: ty.requiresDocumentation,
      annualCapDays:
        ty.annualCapDays != null
          ? String(Number(ty.annualCapDays)).replace(".", ",")
          : "",
      visibleToColleagues: ty.visibleToColleagues,
    });
  };

  const submit = (d: AbsenceTypeDraft, id?: string) => {
    const cap = parseCap(d.annualCapDays);
    if (cap === "invalid") {
      toast.error(t("capRange"));
      return;
    }
    const payload = {
      name: d.name.trim(),
      color: d.color,
      category: d.category,
      requiresApproval: d.requiresApproval,
      requiresDocumentation: d.requiresDocumentation,
      annualCapDays: cap,
      visibleToColleagues: d.visibleToColleagues,
    };
    if (id) updateMutation.mutate({ id, ...payload });
    else createMutation.mutate(payload);
  };

  const badges = (ty: NonNullable<typeof types>[number]) =>
    [
      tc(`absenceCategory.${toAbsenceCategory(ty.category)}`),
      ty.requiresApproval ? t("badgeApproval") : t("badgeDirect"),
      ty.requiresDocumentation ? t("badgeDocumentation") : null,
      ty.annualCapDays != null
        ? t("badgeCap", {
            days: String(Number(ty.annualCapDays)).replace(".", ","),
          })
        : null,
      ty.visibleToColleagues ? null : t("badgeHidden"),
    ].filter((b): b is string => !!b);

  return (
    <SettingsSection title={t("title")}>
      <div className="space-y-3">
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-10 rounded bg-gray-100 dark:bg-gray-700"
              />
            ))}
          </div>
        ) : (
          types?.map((ty) => (
            <div
              key={ty.id}
              className="rounded-md border border-gray-200 p-3 dark:border-gray-600"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: ty.color ?? "#3b82f6" }}
                  />
                  <div className="min-w-0">
                    <span className="text-sm text-gray-900 dark:text-gray-100">
                      {ty.name}
                    </span>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {badges(ty).map((b) => (
                        <span
                          key={b}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      editingId === ty.id ? setEditingId(null) : startEdit(ty)
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate({ id: ty.id })}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
              {editingId === ty.id && (
                <form
                  className="mt-3 space-y-3 border-ty border-gray-200 pt-3 dark:border-gray-600"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(editDraft, ty.id);
                  }}
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editDraft.name}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, name: e.target.value })
                      }
                      className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                    <input
                      type="color"
                      value={editDraft.color}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, color: e.target.value })
                      }
                      className="h-9 w-9 cursor-pointer rounded-md border border-gray-300 dark:border-gray-600"
                    />
                  </div>
                  <AbsenceTypeFields
                    draft={editDraft}
                    onChange={setEditDraft}
                    idPrefix={`edit-${ty.id}`}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={
                        !editDraft.name.trim() || updateMutation.isPending
                      }
                    >
                      {updateMutation.isPending ? ts("saving") : ts("save")}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ))
        )}

        <form
          className="space-y-3 rounded-md border border-dashed border-gray-300 p-3 dark:border-gray-600"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim()) submit(draft);
          }}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t("newPlaceholder")}
              className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <input
              type="color"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              className="h-9 w-9 cursor-pointer rounded-md border border-gray-300 dark:border-gray-600"
            />
          </div>
          <AbsenceTypeFields draft={draft} onChange={setDraft} idPrefix="new" />
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!draft.name.trim() || createMutation.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("add")}
            </Button>
          </div>
        </form>
      </div>
    </SettingsSection>
  );
}

// Fakturerbarhed pr. aktivitetstype (#704): null = arv
type BillableOption = "inherit" | "yes" | "no";

function billableToOption(value: boolean | null): BillableOption {
  if (value === null) return "inherit";
  return value ? "yes" : "no";
}

function optionToBillable(option: string): boolean | null {
  if (option === "yes") return true;
  if (option === "no") return false;
  return null;
}

/**
 * Aktivitetstyper (#459): CRUD, farve, rækkefølge, lønart-kode og
 * fakturerbarhed (#704). Typer arkiveres (aldrig slettes) — registreringer
 * peger på dem.
 */
function ActivityTypesSection() {
  const t = useTranslations("enterpriseSettings.activity");
  const utils = trpc.useUtils();
  const [showArchived, setShowArchived] = useState(false);
  const { data: types, isLoading } = trpc.enterprise.listActivityTypes.useQuery(
    { includeArchived: true },
  );
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [newCode, setNewCode] = useState("");
  // Lønart-koder redigeres inline; gemmes ved blur/Enter
  const [codeEdits, setCodeEdits] = useState<Record<string, string>>({});

  const invalidate = () => {
    utils.enterprise.listActivityTypes.invalidate();
    utils.enterprise.getTimesheetWeek.invalidate();
  };
  const onError = (err: { message?: string }) =>
    toast.error(err.message || t("saveFailed"));

  const createMutation = trpc.enterprise.createActivityType.useMutation({
    onSuccess: () => {
      invalidate();
      setNewName("");
      setNewCode("");
      toast.success(t("created"));
    },
    onError,
  });
  const updateMutation = trpc.enterprise.updateActivityType.useMutation({
    onSuccess: () => invalidate(),
    onError,
  });
  const archiveMutation = trpc.enterprise.archiveActivityType.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("archived"));
    },
    onError,
  });
  const reorderMutation = trpc.enterprise.reorderActivityTypes.useMutation({
    onSuccess: () => invalidate(),
    onError,
  });

  const active = (types ?? []).filter((ty) => !ty.isArchived);
  const archived = (types ?? []).filter((ty) => ty.isArchived);

  function move(index: number, delta: -1 | 1) {
    const ids = active.map((ty) => ty.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMutation.mutate({ ids });
  }

  function commitCode(id: string, current: string | null) {
    const raw = codeEdits[id];
    if (raw === undefined) return;
    setCodeEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const value = raw.trim();
    if (value === (current ?? "")) return;
    updateMutation.mutate({ id, payrollCode: value || null });
  }

  const busy =
    updateMutation.isPending ||
    archiveMutation.isPending ||
    reorderMutation.isPending;

  return (
    <SettingsSection title={t("title")}>
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
        {t("intro")}
      </p>
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
        {t("billableInfo")}
      </p>
      <div className="space-y-3">
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-10 rounded bg-gray-100 dark:bg-gray-700"
              />
            ))}
          </div>
        ) : (
          active.map((ty, index) => (
            <div
              key={ty.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-600"
            >
              <input
                type="color"
                value={ty.color}
                aria-label={t("colorFor", { name: ty.name })}
                disabled={busy}
                onChange={(e) =>
                  updateMutation.mutate({ id: ty.id, color: e.target.value })
                }
                className="h-6 w-6 cursor-pointer rounded-full border border-gray-300 dark:border-gray-600"
              />
              <span className="min-w-32 flex-1 text-sm text-gray-900 dark:text-gray-100">
                {ty.name}
                {ty.isDefault && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                    {t("default")}
                  </span>
                )}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("payCode")}
                <input
                  type="text"
                  value={codeEdits[ty.id] ?? ty.payrollCode ?? ""}
                  placeholder="–"
                  maxLength={50}
                  onChange={(e) =>
                    setCodeEdits((prev) => ({
                      ...prev,
                      [ty.id]: e.target.value,
                    }))
                  }
                  onBlur={() => commitCode(ty.id, ty.payrollCode)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 tabular-nums text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("billable")}
                <select
                  value={billableToOption(ty.defaultBillable)}
                  disabled={busy}
                  onChange={(e) =>
                    updateMutation.mutate({
                      id: ty.id,
                      defaultBillable: optionToBillable(e.target.value),
                    })
                  }
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="inherit">{t("inherit")}</option>
                  <option value="yes">{t("yes")}</option>
                  <option value="no">{t("no")}</option>
                </select>
              </label>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("moveUp")}
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("moveDown")}
                  disabled={busy || index === active.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("archive")}
                  title={t("archiveTitle")}
                  disabled={busy}
                  onClick={() => archiveMutation.mutate({ id: ty.id })}
                >
                  <Archive className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))
        )}

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) {
              createMutation.mutate({
                name: newName.trim(),
                color: newColor,
                payrollCode: newCode.trim() || null,
              });
            }
          }}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("newPlaceholder")}
            className="min-w-40 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <input
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder={t("payCodePlaceholder")}
            maxLength={50}
            className="w-32 rounded-md border border-gray-300 bg-white px-3 py-2 tabular-nums text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <input
            type="color"
            value={newColor}
            aria-label={t("colour")}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-9 w-9 cursor-pointer rounded-md border border-gray-300 dark:border-gray-600"
          />
          <Button
            type="submit"
            disabled={!newName.trim() || createMutation.isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("add")}
          </Button>
        </form>

        {archived.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-xs text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
            >
              {showArchived
                ? t("hideArchived")
                : t("showArchived", { count: archived.length })}
            </button>
            {showArchived && (
              <ul className="mt-2 space-y-1">
                {archived.map((ty) => (
                  <li
                    key={ty.id}
                    className="flex items-center justify-between rounded-md border border-dashed border-gray-200 px-3 py-1.5 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400"
                  >
                    <span>{ty.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        updateMutation.mutate({ id: ty.id, isArchived: false })
                      }
                    >
                      <ArchiveRestore className="mr-1 h-4 w-4" />
                      {t("restore")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

/** Ferieår og optjening (#461): startmåned, model, overførselsloft, udbetaling. */
function VacationSettingsSection({
  org,
  inputClass,
  labelClass,
}: {
  org: {
    vacationYearStartMonth: number | null;
    vacationAccrualMode: string | null;
    vacationCarryOverMaxDays: string | null;
    vacationPayOutRemaining: boolean | null;
  } | null;
  inputClass: string;
  labelClass: string;
}) {
  const t = useTranslations("enterpriseSettings.vacation");
  const ts = useTranslations("enterpriseSettings");
  const intlLocale = toIntlLocale(useLocale());
  const utils = trpc.useUtils();
  const [startMonth, setStartMonth] = useState("1");
  const [mode, setMode] = useState<"upfront" | "monthly">("upfront");
  const [carryOver, setCarryOver] = useState("5");
  const [payOut, setPayOut] = useState(false);

  useEffect(() => {
    if (!org) return;
    setStartMonth(String(org.vacationYearStartMonth ?? 1));
    setMode(org.vacationAccrualMode === "monthly" ? "monthly" : "upfront");
    setCarryOver(formatDecimal(org.vacationCarryOverMaxDays ?? 5));
    setPayOut(Boolean(org.vacationPayOutRemaining));
  }, [org]);

  const mutation = trpc.enterprise.updateVacationSettings.useMutation({
    onSuccess: () => {
      utils.enterprise.get.invalidate();
      utils.enterprise.getVacationBalance.invalidate();
      toast.success(t("saved"));
    },
    onError: (error) => toast.error(error.message || t("saveFailed")),
  });

  const save = () => {
    const month = Number(startMonth);
    const cap = parseDecimal(carryOver);
    if (cap === null || Number.isNaN(cap) || cap < 0 || cap > 25) {
      toast.error(t("capRange"));
      return;
    }
    mutation.mutate({
      vacationYearStartMonth: month,
      vacationAccrualMode: mode,
      vacationCarryOverMaxDays: cap,
      vacationPayOutRemaining: payOut,
    });
  };

  const previewStart = Number(startMonth);
  const previewLabel =
    previewStart === 1
      ? t("previewCalendar")
      : t("previewRange", {
          start: previewStart,
          endDay: new Date(2026, previewStart - 1, 0).getDate(),
          endMonth: previewStart - 1,
        });

  return (
    <SettingsSection title={t("title")}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="vacation-year-start">
              {t("yearStarts")}
            </label>
            <select
              id="vacation-year-start"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className={inputClass}
            >
              {Array.from({ length: 12 }, (_, i) => {
                const name = new Date(2026, i, 1).toLocaleDateString(
                  intlLocale,
                  { month: "long" },
                );
                return (
                  <option key={name} value={String(i + 1)}>
                    {t(
                      i === 0
                        ? "optionCalendar"
                        : i === 8
                          ? "optionAct"
                          : "optionMonth",
                      { name },
                    )}
                  </option>
                );
              })}
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("balanceKept", { range: previewLabel })}
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="vacation-accrual-mode">
              {t("accrual")}
            </label>
            <select
              id="vacation-accrual-mode"
              value={mode}
              onChange={(e) =>
                setMode(e.target.value === "monthly" ? "monthly" : "upfront")
              }
              className={inputClass}
            >
              <option value="upfront">{t("upfront")}</option>
              <option value="monthly">{t("monthly")}</option>
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("monthlyHelp")}
            </p>
            {mode === "monthly" && org?.vacationAccrualMode !== "monthly" && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {t("switchWarning")}
              </p>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="max-w-[260px]">
            <label className={labelClass} htmlFor="vacation-carry-over">
              {t("carryOver")}
            </label>
            <input
              id="vacation-carry-over"
              type="text"
              inputMode="decimal"
              value={carryOver}
              onChange={(e) => setCarryOver(e.target.value)}
              placeholder="5"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("carryOverHelp")}
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={payOut}
              onChange={(e) => setPayOut(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
            />
            <span>
              {t("payOut")}
              <span className="block text-xs text-gray-400 dark:text-gray-500">
                {t("payOutHelp")}
              </span>
            </span>
          </label>
        </div>
        <div>
          <Button onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? ts("saving") : ts("save")}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

function EnterpriseSettingsContent() {
  const fid = useId();
  const t = useTranslations("enterpriseSettings.org");
  const ts = useTranslations("enterpriseSettings");
  const utils = trpc.useUtils();
  const { data: org, isLoading } = trpc.enterprise.get.useQuery();

  const [orgName, setOrgName] = useState("");
  const [overtimeThreshold, setOvertimeThreshold] = useState("");
  const [vacationOverdraft, setVacationOverdraft] = useState("0");

  const updateOrgMutation = trpc.enterprise.update.useMutation({
    onSuccess: () => {
      utils.enterprise.get.invalidate();
      toast.success(t("updated"));
    },
    onError: (error) => {
      toast.error(error.message || t("saveFailed"));
    },
  });

  useEffect(() => {
    if (org) {
      setOrgName(org.name ?? "");
      setOvertimeThreshold(
        org.overtimeThresholdHours
          ? String(Number(org.overtimeThresholdHours)).replace(".", ",")
          : "",
      );
      setVacationOverdraft(
        String(Number(org.vacationOverdraftDays ?? 0)).replace(".", ","),
      );
    }
  }, [org]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("pageTitle")} />
        <div className="animate-pulse space-y-4">
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

  const inputClass =
    "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
  const labelClass =
    "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";

  return (
    <div className="space-y-6">
      <PageHeader title={t("pageTitle")} />

      <div className="max-w-2xl space-y-6">
        {/* Organisation */}
        <SettingsSection title={t("title")}>
          <div className="space-y-4">
            <div>
              <label htmlFor={`${fid}-f2`} className={labelClass}>
                {t("name")}
              </label>
              <input
                id={`${fid}-f2`}
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="max-w-[260px]">
              <label className={labelClass} htmlFor="overtime-threshold">
                {t("overtimeThreshold")}
              </label>
              <input
                id="overtime-threshold"
                type="text"
                inputMode="decimal"
                value={overtimeThreshold}
                onChange={(e) => setOvertimeThreshold(e.target.value)}
                placeholder={t("overtimePlaceholder")}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {t("overtimeHelp")}
              </p>
            </div>
            <div className="max-w-[260px]">
              <label className={labelClass} htmlFor="vacation-overdraft">
                {t("overdraft")}
              </label>
              <input
                id="vacation-overdraft"
                type="text"
                inputMode="decimal"
                value={vacationOverdraft}
                onChange={(e) => setVacationOverdraft(e.target.value)}
                placeholder="0"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {t("overdraftHelp")}
              </p>
            </div>
            <div>
              <Button
                onClick={() => {
                  if (!orgName.trim()) return;
                  const raw = overtimeThreshold.trim().replace(",", ".");
                  const parsed = raw === "" ? null : Number(raw);
                  if (
                    parsed !== null &&
                    (Number.isNaN(parsed) || parsed < 1 || parsed > 80)
                  ) {
                    toast.error(t("thresholdRange"));
                    return;
                  }
                  const overdraftRaw = vacationOverdraft
                    .trim()
                    .replace(",", ".");
                  const overdraft =
                    overdraftRaw === "" ? 0 : Number(overdraftRaw);
                  if (
                    Number.isNaN(overdraft) ||
                    overdraft < 0 ||
                    overdraft > 30
                  ) {
                    toast.error(t("overdraftRange"));
                    return;
                  }
                  updateOrgMutation.mutate({
                    name: orgName.trim(),
                    overtimeThresholdHours: parsed,
                    vacationOverdraftDays: overdraft,
                  });
                }}
                disabled={updateOrgMutation.isPending || !orgName.trim()}
              >
                {updateOrgMutation.isPending ? ts("saving") : ts("save")}
              </Button>
            </div>
          </div>
        </SettingsSection>

        {/* Arbejdstid og pauser (#449) */}
        <WorkSettingsSection
          org={org ?? null}
          inputClass={inputClass}
          labelClass={labelClass}
        />

        {/* Timeseddel-regler (#467) */}
        <TimesheetRulesSection
          org={org ?? null}
          inputClass={inputClass}
          labelClass={labelClass}
        />

        {/* Normperiode og flex (#507) */}
        <FlexNormSettingsSection
          org={org ?? null}
          inputClass={inputClass}
          labelClass={labelClass}
        />

        {/* Periodeafslutning (#518) */}
        <PeriodClosingSettingsSection
          org={org ?? null}
          inputClass={inputClass}
          labelClass={labelClass}
        />

        {/* Ferieår og optjening (#461) */}
        <VacationSettingsSection
          org={org ?? null}
          inputClass={inputClass}
          labelClass={labelClass}
        />

        {/* Absence types */}
        <AbsenceTypesSection />

        {/* Aktivitetstyper (#459) */}
        <ActivityTypesSection />

        {/* Compliance */}
        <ComplianceSection />

        {/* Løn (E5, #463) */}
        <SettingsSection title={ts("payroll.title")}>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {ts("payroll.description")}
          </p>
          <div className="mt-3">
            <Link
              href="/dashboard/enterprise/settings/payroll"
              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              {ts("payroll.open")}
            </Link>
          </div>
        </SettingsSection>

        {/* Notifikationer (E10, #468) */}
        <NotificationSettingsSection />

        {/* Login & domæner + DPA (E12, #470) */}
        <SettingsSection title={ts("loginBox.title")}>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {ts("loginBox.description")}
          </p>
          <div className="mt-3">
            <Link
              href="/dashboard/enterprise/settings/login"
              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              {ts("loginBox.open")}
            </Link>
          </div>
        </SettingsSection>

        {/* Data-import */}
        <SettingsSection title={ts("import.title")}>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {ts("import.description")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/dashboard/enterprise/employees/import"
              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              {ts("import.employees")}
            </Link>
            <Link
              href="/dashboard/enterprise/settings/import"
              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              {ts("import.timelog")}
            </Link>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

export default function EnterpriseSettingsPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="admin">
        <EnterpriseSettingsContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
