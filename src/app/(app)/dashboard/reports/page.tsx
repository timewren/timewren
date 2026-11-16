// src/app/dashboard/reports/page.tsx
"use client";
import { skipToken } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { ModuleDisabledState } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useDebounce } from "@/hooks/useDebounce";
import { isModuleDisabledError } from "@/lib/modules/forbidden-error";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";
import { ExportMenu } from "./_components/ExportMenu";
import { ReportCustomizePanel } from "./_components/ReportCustomizePanel";
import { ReportPreview } from "./_components/ReportPreview";
import { ReportStatsStrip } from "./_components/ReportStatsStrip";
import { ReportToolbar } from "./_components/ReportToolbar";
import { SaveTemplateDialog } from "./_components/SaveTemplateDialog";
import { ScheduleReportDialog } from "./_components/ScheduleReportDialog";
import { ShareLinkDialog } from "./_components/ShareLinkDialog";
import { TemplateBar } from "./_components/TemplateBar";

function ReportsPageContent() {
  const t = useTranslations("reports");
  const { data: templates } = trpc.reportTemplates.list.useQuery();
  const defaultTpl = useMemo(
    () => templates?.find((t) => t.isDefault) ?? templates?.[0],
    [templates],
  );

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [originalConfig, setOriginalConfig] =
    useState<ReportTemplateConfig | null>(null);
  const [config, setConfig] = useState<ReportTemplateConfig | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const utils = trpc.useUtils();

  // Initialize from default template once loaded
  useEffect(() => {
    if (!config && defaultTpl) {
      const c = defaultTpl.config as ReportTemplateConfig;
      setTemplateId(defaultTpl.id);
      setOriginalConfig(c);
      setConfig(c);
    }
  }, [config, defaultTpl]);

  const hasTriedSeed = useRef(false);

  const ensureSeeded = trpc.reportTemplates.ensureSeeded.useMutation({
    onSuccess: () => utils.reportTemplates.list.invalidate(),
    onError: () => {
      toast.error(t("page.seedError"));
      hasTriedSeed.current = false;
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: ref-vagten (hasTriedSeed) er nok; ensureSeeded.mutate i deps giver uendelige gen-renders
  useEffect(() => {
    if (templates && templates.length === 0 && !hasTriedSeed.current) {
      hasTriedSeed.current = true;
      ensureSeeded.mutate();
    }
  }, [templates]);
  const update = trpc.reportTemplates.update.useMutation({
    onSuccess: () => {
      utils.reportTemplates.list.invalidate();
      if (config) setOriginalConfig(config);
    },
  });

  const isDirty =
    config !== null &&
    originalConfig !== null &&
    JSON.stringify(config) !== JSON.stringify(originalConfig);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Shared report data query — used by both StatsStrip and Preview
  const debouncedConfig = useDebounce(config, 300);
  const isCustomIncomplete =
    config !== null &&
    config.filters.dateRange === "custom" &&
    (!config.filters.customStart || !config.filters.customEnd);
  const isDebouncedCustomIncomplete =
    debouncedConfig !== null &&
    debouncedConfig.filters.dateRange === "custom" &&
    (!debouncedConfig.filters.customStart ||
      !debouncedConfig.filters.customEnd);
  const {
    data: reportData,
    isLoading: reportLoading,
    isError: reportError,
    error: reportErrorDetail,
    refetch: refetchReport,
  } = trpc.reports.getReportData.useQuery(
    debouncedConfig && !isDebouncedCustomIncomplete
      ? { config: debouncedConfig }
      : skipToken,
    {
      staleTime: 10_000,
    },
  );

  if (!config || !originalConfig) {
    return <LoadingScreen message={t("page.loading")} />;
  }

  const patch = (p: Partial<ReportTemplateConfig>) =>
    setConfig({ ...config, ...p });

  return (
    <div className="space-y-5" data-tour="reports-page">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        helpTopicId="reports"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("page.shareLink")}
            </button>
            <Link
              href="/dashboard/reports/team-utilization"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("page.utilization")}
            </Link>
            <Link
              href="/dashboard/reports/team-profitability"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("page.teamProfitability")}
            </Link>
            <Link
              href="/dashboard/reports/profitability"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("page.realRate")}
            </Link>
            <Link
              href="/dashboard/reports/coverage"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("page.coverage")}
            </Link>
            <button
              type="button"
              onClick={() => setScheduleOpen(true)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("page.schedule")}
            </button>
            <ExportMenu config={config} templateId={templateId} />
          </div>
        }
      />

      {/* Error state for report data */}
      {reportError &&
        (isModuleDisabledError(reportErrorDetail) ? (
          <ModuleDisabledState />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 p-6 text-center">
            <p className="text-sm text-red-700 dark:text-red-300">
              {t("page.loadError")}
            </p>
            <button
              type="button"
              onClick={() => refetchReport()}
              className="rounded-lg border border-red-300 dark:border-red-700 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40"
            >
              {t("page.retry")}
            </button>
          </div>
        ))}

      {/* Stats strip */}
      <ReportStatsStrip data={reportData} isLoading={reportLoading} />

      <TemplateBar
        activeTemplateId={templateId}
        activeConfig={config}
        isDirty={isDirty}
        onSelect={(id, c) => {
          setTemplateId(id);
          setOriginalConfig(c);
          setConfig(c);
        }}
        onSave={() => {
          if (templateId) update.mutate({ id: templateId, config });
        }}
        onSaveAs={() => setSaveOpen(true)}
        onNew={() => setSaveOpen(true)}
      />

      <ReportToolbar config={config} onChange={patch} />

      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex-1 min-w-0">
          <ReportPreview
            config={config}
            data={reportData}
            isLoading={reportLoading}
            isCustomIncomplete={isCustomIncomplete}
          />
        </div>
        <ReportCustomizePanel config={config} onChange={patch} />
      </div>

      <ShareLinkDialog
        open={shareOpen}
        config={config}
        onClose={() => setShareOpen(false)}
      />

      <ScheduleReportDialog
        open={scheduleOpen}
        templateId={templateId}
        templateName={
          templates?.find((t) => t.id === templateId)?.name ?? undefined
        }
        onClose={() => setScheduleOpen(false)}
      />

      <SaveTemplateDialog
        open={saveOpen}
        config={config}
        onClose={() => setSaveOpen(false)}
        onSaved={(id) => {
          setTemplateId(id);
          setOriginalConfig(config);
        }}
      />
    </div>
  );
}

export default function ReportsPage() {
  return (
    <ModuleGuard module="reports">
      <ReportsPageContent />
    </ModuleGuard>
  );
}
