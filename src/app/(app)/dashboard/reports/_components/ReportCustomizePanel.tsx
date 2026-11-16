// src/app/dashboard/reports/_components/ReportCustomizePanel.tsx
"use client";
import { Columns3, Group, Paintbrush } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  REPORT_COLUMN_KEYS,
  type ReportColumnKey,
} from "@/lib/reports/column-keys";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";

type Tab = "columns" | "grouping" | "branding";

interface Props {
  config: ReportTemplateConfig;
  onChange: (patch: Partial<ReportTemplateConfig>) => void;
}

const TABS: Array<{ key: Tab; labelKey: string; icon: typeof Columns3 }> = [
  { key: "columns", labelKey: "customize.tabColumns", icon: Columns3 },
  { key: "grouping", labelKey: "customize.tabGrouping", icon: Group },
  { key: "branding", labelKey: "customize.tabBranding", icon: Paintbrush },
];

export function ReportCustomizePanel({ config, onChange }: Props) {
  const t = useTranslations("reports");
  const [tab, setTab] = useState<Tab>("columns");

  return (
    <aside className="w-full shrink-0 overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900 lg:w-80">
      <div
        role="tablist"
        className="flex border-b border-gray-200/80 dark:border-gray-800"
      >
        {TABS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              tab === key
                ? "border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                : "border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="p-4">
        {tab === "columns" && (
          <ColumnsTab config={config} onChange={onChange} />
        )}
        {tab === "grouping" && (
          <GroupingTab config={config} onChange={onChange} />
        )}
        {tab === "branding" && (
          <BrandingTab config={config} onChange={onChange} />
        )}
      </div>
    </aside>
  );
}

function ColumnsTab({ config, onChange }: Props) {
  const t = useTranslations("reports");
  const enabled = new Set(config.columns);
  const toggle = (k: ReportColumnKey) => {
    const next = enabled.has(k)
      ? config.columns.filter((x) => x !== k)
      : [...config.columns, k];
    if (next.length === 0) return;
    onChange({ columns: next });
  };
  return (
    <div className="space-y-1">
      {REPORT_COLUMN_KEYS.map((k) => (
        <label
          key={k}
          className="flex min-h-[36px] cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <input
            type="checkbox"
            checked={enabled.has(k)}
            onChange={() => toggle(k)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600"
          />
          <span className="text-gray-900 dark:text-gray-200">
            {t(`columns.${k}`)}
          </span>
        </label>
      ))}
    </div>
  );
}

function GroupingTab({ config, onChange }: Props) {
  const t = useTranslations("reports");
  const opts: Array<{ k: ReportTemplateConfig["grouping"]; label: string }> = [
    { k: "none", label: t("customize.groupNone") },
    { k: "client", label: t("customize.groupClient") },
    { k: "clientProject", label: t("customize.groupClientProject") },
    { k: "project", label: t("customize.groupProject") },
    { k: "tag", label: t("customize.groupTag") },
    { k: "task", label: t("customize.groupTask") },
    { k: "member", label: t("customize.groupMember") },
    { k: "day", label: t("customize.groupDay") },
    { k: "week", label: t("customize.groupWeek") },
    { k: "month", label: t("customize.groupMonth") },
  ];
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t("customize.tabGrouping")}
        </p>
        {opts.map(({ k, label }) => (
          <label
            key={k}
            className="flex min-h-[36px] cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <input
              type="radio"
              name="grouping"
              checked={config.grouping === k}
              onChange={() => onChange({ grouping: k })}
              className="h-4 w-4 border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600"
            />
            <span className="text-gray-900 dark:text-gray-200">{label}</span>
          </label>
        ))}
        {config.grouping === "tag" && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {t("customize.tagNote")}
          </p>
        )}
        {config.columns.includes("budget") &&
          config.grouping !== "project" &&
          config.grouping !== "clientProject" && (
            <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {t("customize.budgetNote")}
            </p>
          )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t("customize.sorting")}
        </p>
        <select
          value={config.sortBy}
          onChange={(e) =>
            onChange({
              sortBy: e.target.value as ReportTemplateConfig["sortBy"],
            })
          }
          aria-label={t("customize.sortBy")}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
        >
          <option value="date">{t("customize.sortDate")}</option>
          <option value="hours">{t("customize.sortHours")}</option>
          <option value="revenue">{t("customize.sortRevenue")}</option>
          <option value="client">{t("customize.sortClient")}</option>
          <option value="project">{t("customize.sortProject")}</option>
        </select>
        <select
          value={config.sortDir}
          onChange={(e) =>
            onChange({
              sortDir: e.target.value as ReportTemplateConfig["sortDir"],
            })
          }
          aria-label={t("customize.sortDirection")}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
        >
          <option value="desc">{t("customize.desc")}</option>
          <option value="asc">{t("customize.asc")}</option>
        </select>
      </div>
    </div>
  );
}

function BrandingTab({ config, onChange }: Props) {
  const t = useTranslations("reports");
  const b = config.branding;
  const set = (patch: Partial<typeof b>) =>
    onChange({ branding: { ...b, ...patch } });

  return (
    <div className="space-y-3">
      {/* Toggle switches */}
      {[
        { key: "showLogo" as const, label: t("customize.showLogo") },
        {
          key: "showSummaryCards" as const,
          label: t("customize.showSummaryCards"),
        },
        {
          key: "showClientBreakdown" as const,
          label: t("customize.showClientBreakdown"),
        },
        {
          key: "showProjectBreakdown" as const,
          label: t("customize.showProjectBreakdown"),
        },
        {
          key: "showEntriesTable" as const,
          label: t("customize.showEntriesTable"),
        },
        {
          key: "showPauses" as const,
          label: t("customize.showPauses"),
        },
      ].map(({ key, label }) => (
        <label
          key={key}
          className="flex min-h-[36px] cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <span className="text-gray-900 dark:text-gray-200">{label}</span>
          <input
            type="checkbox"
            checked={b[key]}
            onChange={(e) => set({ [key]: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600"
          />
        </label>
      ))}
      {b.showPauses && (
        <p className="rounded-lg bg-gray-50 px-2.5 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {t("customize.pausesNote")}
        </p>
      )}

      <div className="my-2 h-px bg-gray-200/80 dark:bg-gray-800" />

      <div>
        <label
          htmlFor="branding-title"
          className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          {t("customize.title")}
        </label>
        <input
          id="branding-title"
          type="text"
          value={b.title}
          maxLength={120}
          onChange={(e) => set({ title: e.target.value })}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
        />
      </div>
      <div>
        <label
          htmlFor="branding-primary-color"
          className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          {t("customize.primaryColor")}
        </label>
        <input
          id="branding-primary-color"
          type="color"
          value={b.primaryColor}
          onChange={(e) => set({ primaryColor: e.target.value })}
          className="h-9 w-full rounded-lg border border-gray-200 dark:border-gray-700"
        />
      </div>
      <div>
        <label
          htmlFor="branding-intro-text"
          className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          {t("customize.introText")}
        </label>
        <textarea
          id="branding-intro-text"
          value={b.introText ?? ""}
          maxLength={2000}
          rows={3}
          onChange={(e) => set({ introText: e.target.value || undefined })}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
        />
      </div>
      <div>
        <label
          htmlFor="branding-footer-text"
          className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          {t("customize.footerText")}
        </label>
        <input
          id="branding-footer-text"
          type="text"
          value={b.footerText ?? ""}
          maxLength={500}
          onChange={(e) => set({ footerText: e.target.value || undefined })}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
        />
      </div>
    </div>
  );
}
