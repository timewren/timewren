// src/app/dashboard/reports/_components/ReportToolbar.tsx
"use client";
import { Calendar, Filter, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { ClientSearchCombobox } from "@/components/ui";
import { MemberMultiSelect } from "@/components/ui/MemberMultiSelect";
import { useModules } from "@/hooks/useModules";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";

interface Props {
  config: ReportTemplateConfig;
  onChange: (patch: Partial<ReportTemplateConfig>) => void;
}

const DATE_RANGE_OPTIONS: Array<{
  value: ReportTemplateConfig["filters"]["dateRange"];
}> = [
  { value: "thisMonth" },
  { value: "lastMonth" },
  { value: "thisQuarter" },
  { value: "thisYear" },
  { value: "custom" },
];

export function ReportToolbar({ config, onChange }: Props) {
  const t = useTranslations("reports");
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: members } = trpc.organization.getMembers.useQuery();
  // Only teams (more than one member) get the member filter.
  const isTeam = (members?.length ?? 0) > 1;

  const setFilter = (patch: Partial<ReportTemplateConfig["filters"]>) =>
    onChange({ filters: { ...config.filters, ...patch } });

  return (
    <div className="space-y-3">
      {/* Period pill tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <Calendar className="h-3.5 w-3.5" />
          {t("toolbar.period")}
        </div>
        <div
          role="tablist"
          aria-label={t("toolbar.choosePeriod")}
          className="flex flex-wrap gap-1"
        >
          {DATE_RANGE_OPTIONS.map((opt) => {
            const isActive = config.filters.dateRange === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter({ dateRange: opt.value })}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
              >
                {t(`toolbar.${opt.value}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom date range + filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200/80 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        {config.filters.dateRange === "custom" && (
          <>
            <div>
              <label
                htmlFor="toolbar-custom-start"
                className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                {t("toolbar.from")}
              </label>
              <input
                id="toolbar-custom-start"
                type="date"
                value={config.filters.customStart ?? ""}
                onChange={(e) => setFilter({ customStart: e.target.value })}
                className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
              />
            </div>
            <div>
              <label
                htmlFor="toolbar-custom-end"
                className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                {t("toolbar.to")}
              </label>
              <input
                id="toolbar-custom-end"
                type="date"
                value={config.filters.customEnd ?? ""}
                onChange={(e) => setFilter({ customEnd: e.target.value })}
                className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
              />
            </div>
            {config.filters.customStart &&
              config.filters.customEnd &&
              config.filters.customStart > config.filters.customEnd && (
                <p
                  className="self-end border-l-[3px] border-red-400 pl-2 text-xs text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {t("toolbar.dateOrder")}
                </p>
              )}
            <div className="hidden h-8 w-px bg-gray-200 sm:block dark:bg-gray-700" />
          </>
        )}

        <div className="w-full sm:w-56">
          <label
            htmlFor="toolbar-client"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            <span className="inline-flex items-center gap-1">
              <Filter className="h-3 w-3" />
              {t("toolbar.client")}
            </span>
          </label>
          <ClientSearchCombobox
            id="toolbar-client"
            clients={clients}
            multiple
            values={config.filters.clientIds}
            onValuesChange={(ids) => setFilter({ clientIds: ids })}
            placeholder={t("toolbar.allClients")}
            allowClear
            clearLabel={t("toolbar.allClients")}
          />
        </div>

        {isTeam && (
          <div className="w-full sm:w-56">
            <label
              htmlFor="toolbar-member"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {t("toolbar.member")}
              </span>
            </label>
            <MemberMultiSelect
              id="toolbar-member"
              members={members}
              values={config.filters.memberIds ?? []}
              onValuesChange={(ids) => setFilter({ memberIds: ids })}
            />
          </div>
        )}

        <div>
          <label
            htmlFor="toolbar-billable"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            {t("toolbar.billable")}
          </label>
          <select
            id="toolbar-billable"
            value={config.filters.billable}
            onChange={(e) =>
              setFilter({
                billable: e.target
                  .value as ReportTemplateConfig["filters"]["billable"],
              })
            }
            className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
          >
            <option value="all">{t("toolbar.all")}</option>
            <option value="billable">{t("toolbar.onlyBillable")}</option>
            <option value="nonBillable">{t("toolbar.onlyNonBillable")}</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="toolbar-billed-status"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            {t("toolbar.status")}
          </label>
          <select
            id="toolbar-billed-status"
            value={config.filters.billedStatus}
            onChange={(e) =>
              setFilter({
                billedStatus: e.target
                  .value as ReportTemplateConfig["filters"]["billedStatus"],
              })
            }
            className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
          >
            <option value="all">{t("toolbar.all")}</option>
            <option value="billed">{t("toolbar.billed")}</option>
            <option value="unbilled">{t("toolbar.unbilled")}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
