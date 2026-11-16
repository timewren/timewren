"use client";

import { Edit3, Plus, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutItem, verticalCompactor } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { InvoiceNudge } from "@/components/adoption/InvoiceNudge";
import { ActionBar } from "@/components/dashboard/ActionBar";
import { DemoDataBanner } from "@/components/dashboard/DemoDataBanner";
import { DesktopDownloadCard } from "@/components/dashboard/DesktopDownloadCard";
import { TrialActivationBanner } from "@/components/dashboard/TrialActivationBanner";
import { WidgetCatalog } from "@/components/dashboard/WidgetCatalog";
import { KlippekortAlerts } from "@/components/KlippekortAlerts";
import { ConfirmDialog } from "@/components/ui";
import { useEnterpriseLandingRedirect } from "@/hooks/useEnterpriseLandingRedirect";
import { useModules } from "@/hooks/useModules";
import { trpc } from "@/providers/trpc-provider";
import {
  DEFAULT_ACTIVE_WIDGETS,
  DEFAULT_DASHBOARD_LAYOUT,
  WIDGET_CONFIGS,
  type WidgetType,
} from "@/types/dashboard";

// Widget loading skeleton
function WidgetSkeleton() {
  return (
    <div className="h-full w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800 p-4">
      <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700 mb-3" />
      <div className="h-8 w-16 rounded bg-gray-200 dark:bg-gray-700" />
    </div>
  );
}

// Lazy-loaded GridLayout
const GridLayout = dynamic(() => import("react-grid-layout"), { ssr: false });

// Lazy-loaded widgets
const LazyStatsWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/StatsWidget").then((m) => ({
      default: m.StatsWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyDailyHoursChartWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/DailyHoursChartWidget").then(
      (m) => ({ default: m.DailyHoursChartWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyEmailTasksWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/EmailTasksWidget").then((m) => ({
      default: m.EmailTasksWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyExpiringPackagesWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/ExpiringPackagesWidget").then(
      (m) => ({ default: m.ExpiringPackagesWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyHoursComparisonWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/HoursComparisonWidget").then(
      (m) => ({ default: m.HoursComparisonWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyInvoiceOverviewWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/InvoiceOverviewWidget").then(
      (m) => ({ default: m.InvoiceOverviewWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyLowBalancePackagesWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/LowBalancePackagesWidget").then(
      (m) => ({ default: m.LowBalancePackagesWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyMonthComparisonWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/MonthComparisonWidget").then(
      (m) => ({ default: m.MonthComparisonWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyOverdueTasksWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/OverdueTasksWidget").then((m) => ({
      default: m.OverdueTasksWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyProductivityHeatmapWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/ProductivityHeatmapWidget").then(
      (m) => ({ default: m.ProductivityHeatmapWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyProjectHealthWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/ProjectHealthWidget").then((m) => ({
      default: m.ProjectHealthWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyQuickActionsWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/QuickActionsWidget").then((m) => ({
      default: m.QuickActionsWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyFlexBalanceWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/FlexBalanceWidget").then((m) => ({
      default: m.FlexBalanceWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyFlexNormWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/FlexNormWidget").then((m) => ({
      default: m.FlexNormWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyVacationBalanceWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/VacationBalanceWidget").then(
      (m) => ({ default: m.VacationBalanceWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyUpcomingAbsencesWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/UpcomingAbsencesWidget").then(
      (m) => ({ default: m.UpcomingAbsencesWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyPendingApprovalsWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/PendingApprovalsWidget").then(
      (m) => ({ default: m.PendingApprovalsWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyRecentActivityWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/RecentActivityWidget").then((m) => ({
      default: m.RecentActivityWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyRevenueByClientWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/RevenueByClientWidget").then(
      (m) => ({ default: m.RevenueByClientWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyRevenueForecastWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/RevenueForecastWidget").then(
      (m) => ({ default: m.RevenueForecastWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyTopClientsWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/TopClientsWidget").then((m) => ({
      default: m.TopClientsWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyUnbilledTimeWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/UnbilledTimeWidget").then((m) => ({
      default: m.UnbilledTimeWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyUpcomingTasksWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/UpcomingTasksWidget").then((m) => ({
      default: m.UpcomingTasksWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyCoverageWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/CoverageWidget").then((m) => ({
      default: m.CoverageWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyWeeklyGoalTrackerWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/WeeklyGoalTrackerWidget").then(
      (m) => ({ default: m.WeeklyGoalTrackerWidget }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyCalendarSyncWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/CalendarSyncWidget").then((m) => ({
      default: m.CalendarSyncWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyPrepaidStatusWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/PrepaidStatusWidget").then((m) => ({
      default: m.PrepaidStatusWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyRoundingBonusWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/RoundingBonusWidget").then((m) => ({
      default: m.RoundingBonusWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyProfitabilityWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/ProfitabilityWidget").then((m) => ({
      default: m.ProfitabilityWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyVatOverviewWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/VatOverviewWidget").then((m) => ({
      default: m.VatOverviewWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyAtRiskClientsWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/AtRiskClientsWidget").then((m) => ({
      default: m.AtRiskClientsWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyCashflowWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/CashflowWidget").then((m) => ({
      default: m.CashflowWidget,
    })),
  { loading: () => <WidgetSkeleton />, ssr: false },
);
const LazyUpcomingDeadlinesWidget = dynamic(
  () =>
    import("@/components/dashboard/widgets/UpcomingDeadlinesWidget").then(
      (m) => ({
        default: m.UpcomingDeadlinesWidget,
      }),
    ),
  { loading: () => <WidgetSkeleton />, ssr: false },
);

// Custom hook for responsive width
function useContainerWidth() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    let rafId: number;
    const updateWidth = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (containerRef.current) {
          setWidth(containerRef.current.offsetWidth);
        }
      });
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  return { containerRef, width };
}

// Calculate responsive columns based on width
function getResponsiveCols(width: number): number {
  if (width < 480) return 1;
  if (width < 768) return 2;
  if (width < 1024) return 3;
  return 4;
}

export default function OverblikPage() {
  const t = useTranslations("overview.page");
  const tWidget = useTranslations("overview.widget");
  const { isEnabled } = useModules();
  const { hold } = useEnterpriseLandingRedirect();

  const [isEditMode, setIsEditMode] = useState(false);
  const [showWidgetCatalog, setShowWidgetCatalog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const { containerRef, width } = useContainerWidth();
  const cols = getResponsiveCols(width);

  // Fetch preferences
  const { data: preferences, refetch: refetchPreferences } =
    trpc.dashboard.getPreferences.useQuery(undefined, {
      staleTime: 10 * 60 * 1000,
    });

  // Local state for layout and active widgets — initialized with defaults for instant render
  const [layout, setLayout] = useState<LayoutItem[]>(
    DEFAULT_DASHBOARD_LAYOUT as LayoutItem[],
  );
  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>(
    DEFAULT_ACTIVE_WIDGETS as WidgetType[],
  );
  const hasSyncedFromServer = useRef(false);

  // Sync from server preferences once on first load
  useEffect(() => {
    if (preferences && !hasSyncedFromServer.current) {
      hasSyncedFromServer.current = true;
      setLayout(preferences.layout as LayoutItem[]);
      setActiveWidgets(preferences.activeWidgets as WidgetType[]);
    }
  }, [preferences]);

  // Save preferences mutation
  const savePreferencesMutation = trpc.dashboard.savePreferences.useMutation({
    onSuccess: () => {
      toast.success(t("layoutSaved"));
      setHasUnsavedChanges(false);
      refetchPreferences();
    },
    onError: (error) => {
      toast.error(error.message || t("layoutSaveFailed"));
    },
  });

  // Reset to default mutation
  const resetMutation = trpc.dashboard.resetToDefault.useMutation({
    onSuccess: () => {
      toast.success(t("resetDone"));
      setHasUnsavedChanges(false);
      refetchPreferences();
    },
    onError: (error) => {
      toast.error(error.message || t("resetFailed"));
    },
  });

  const handleLayoutChange = (newLayout: readonly LayoutItem[]) => {
    setLayout([...newLayout]);
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    await savePreferencesMutation.mutateAsync({
      layout: layout.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: item.minW,
        minH: item.minH,
        maxW: item.maxW,
        maxH: item.maxH,
      })),
      activeWidgets,
    });
    setIsEditMode(false);
  };

  const handleReset = () => {
    setShowResetConfirm(true);
  };

  const handleAddWidget = (widgetId: WidgetType) => {
    if (activeWidgets.includes(widgetId)) {
      toast.error(t("alreadyAdded"));
      return;
    }

    const config = WIDGET_CONFIGS[widgetId as WidgetType];
    const newLayout: LayoutItem = {
      i: widgetId,
      x: 0,
      y: Number.POSITIVE_INFINITY, // Add to bottom
      w: config.defaultSize.w,
      h: config.defaultSize.h,
      minW: config.minSize.w,
      minH: config.minSize.h,
    };

    setLayout([...layout, newLayout]);
    setActiveWidgets([...activeWidgets, widgetId]);
    setHasUnsavedChanges(true);
    setShowWidgetCatalog(false);
    toast.success(
      t("widgetAdded", {
        title: tWidget.has(`${widgetId}.title`)
          ? tWidget(`${widgetId}.title`)
          : config.title,
      }),
    );
  };

  const handleRemoveWidget = (widgetId: string) => {
    setLayout(layout.filter((item) => item.i !== widgetId));
    setActiveWidgets(activeWidgets.filter((id) => id !== widgetId));
    setHasUnsavedChanges(true);
    toast.success(t("widgetRemoved"));
  };

  // Memoized widget rendering to prevent unnecessary re-renders
  const renderWidget = useCallback(
    (widgetId: string) => {
      switch (widgetId as WidgetType) {
        case "stats-clients":
        case "stats-projects":
        case "stats-hours":
        case "stats-revenue":
          return (
            <LazyStatsWidget
              type={
                widgetId as Extract<
                  WidgetType,
                  | "stats-clients"
                  | "stats-projects"
                  | "stats-hours"
                  | "stats-revenue"
                >
              }
            />
          );
        case "unbilled-time":
          return <LazyUnbilledTimeWidget />;
        case "tasks-overdue":
          return <LazyOverdueTasksWidget />;
        case "email-tasks":
          return <LazyEmailTasksWidget />;
        case "tasks-upcoming":
          return <LazyUpcomingTasksWidget />;
        case "prepaid-low-balance":
          return <LazyLowBalancePackagesWidget />;
        case "quick-actions":
          return <LazyQuickActionsWidget />;
        case "recent-activity":
          return <LazyRecentActivityWidget />;
        case "top-clients":
          return <LazyTopClientsWidget />;
        case "hours-comparison":
          return <LazyHoursComparisonWidget />;
        case "weekly-goal-tracker":
          return <LazyWeeklyGoalTrackerWidget />;
        case "coverage":
          return <LazyCoverageWidget />;
        case "revenue-forecast":
          return <LazyRevenueForecastWidget />;
        case "project-health":
          return <LazyProjectHealthWidget />;
        case "expiring-packages":
          return <LazyExpiringPackagesWidget />;
        case "productivity-heatmap":
          return <LazyProductivityHeatmapWidget />;
        case "daily-hours-chart":
          return <LazyDailyHoursChartWidget />;
        case "revenue-by-client":
          return <LazyRevenueByClientWidget />;
        case "invoice-overview":
          return <LazyInvoiceOverviewWidget />;
        case "month-comparison":
          return <LazyMonthComparisonWidget />;
        case "calendar-sync":
          return <LazyCalendarSyncWidget />;
        case "prepaid-status":
          return <LazyPrepaidStatusWidget />;
        case "flex-balance":
          return <LazyFlexBalanceWidget />;
        case "flex-norm":
          return <LazyFlexNormWidget />;
        case "vacation-balance":
          return <LazyVacationBalanceWidget />;
        case "upcoming-absences":
          return <LazyUpcomingAbsencesWidget />;
        case "pending-approvals":
          return <LazyPendingApprovalsWidget />;
        case "rounding-bonus":
          return <LazyRoundingBonusWidget />;
        case "profitability":
          return <LazyProfitabilityWidget />;
        case "vat-overview":
          return <LazyVatOverviewWidget />;
        case "at-risk-clients":
          return <LazyAtRiskClientsWidget />;
        case "cashflow":
          return <LazyCashflowWidget />;
        case "upcoming-deadlines":
          return <LazyUpcomingDeadlinesWidget />;
        default:
          return <div>{t("unknownWidget", { id: widgetId })}</div>;
      }
    },
    [t],
  );

  // Helper: is a given widget allowed by current module flags?
  const isWidgetAllowed = useCallback(
    (widgetId: string) => {
      const cfg = WIDGET_CONFIGS[widgetId as WidgetType];
      if (!cfg?.requiresModule) return true;
      return isEnabled(cfg.requiresModule);
    },
    [isEnabled],
  );

  // Active widgets filtered to only those whose required module is enabled
  const visibleWidgets = useMemo(
    () => activeWidgets.filter(isWidgetAllowed),
    [activeWidgets, isWidgetAllowed],
  );

  // Memoize available widgets calculation (also filtered by module)
  const availableWidgets = useMemo(
    () =>
      (Object.keys(WIDGET_CONFIGS) as WidgetType[]).filter(
        (id) => !activeWidgets.includes(id) && isWidgetAllowed(id),
      ),
    [activeWidgets, isWidgetAllowed],
  );

  // Memoize responsive layout calculation (only for visible widgets)
  const responsiveLayout = useMemo(
    () =>
      layout
        .filter((item) => isWidgetAllowed(item.i))
        .map((item) => ({
          ...item,
          w: Math.min(item.w, cols),
          x: Math.min(item.x, Math.max(0, cols - Math.min(item.w, cols))),
        })),
    [layout, cols, isWidgetAllowed],
  );

  // Memoize grid settings
  const gridSettings = useMemo(
    () => ({
      rowHeight: width < 768 ? 80 : 100,
      margin: (width < 480 ? [8, 8] : [16, 16]) as [number, number],
    }),
    [width],
  );

  if (hold) return null;

  return (
    <div className="space-y-4">
      {/* Critical Klippekort Alerts */}
      <KlippekortAlerts />

      {/* Demo-eksempeldata: markering + "Ryd demo-data" (#86) */}
      <DemoDataBanner />

      {/* Trial-nedtælling + aktiverings-checklist */}
      <TrialActivationBanner />

      {/* Aggregated action alerts */}
      <ActionBar />

      {/* "Fakturér nu"-nudge (#89): kun når en kunde har oplagt tid */}
      <InvoiceNudge surface="dashboard" />

      {/* Desktop app download (Windows/macOS, Beta) */}
      <DesktopDownloadCard />

      {/* Header — Hjem har hilsen og hurtig registrering; her er det tal */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t.rich("subtitle", {
              link: (chunks) => (
                <Link
                  href="/dashboard"
                  className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {isEditMode ? (
            <>
              {hasUnsavedChanges && (
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  {t("unsaved")}
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowWidgetCatalog(true)}
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-3 py-1.5 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("addWidget")}</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-3 py-1.5 transition-colors"
                title={t("reset")}
              >
                <RotateCcw className="h-4 w-4" />
                <span className="hidden sm:inline">{t("reset")}</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasUnsavedChanges}
                className="inline-flex items-center gap-2 bg-tt-gran text-tt-paa-gran text-sm font-medium rounded-lg px-3 py-1.5 transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
                title={t("save")}
              >
                <Save className="h-4 w-4" />
                <span className="hidden sm:inline">{t("save")}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (hasUnsavedChanges) {
                    setShowDiscardConfirm(true);
                    return;
                  }
                  setIsEditMode(false);
                }}
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-3 py-1.5 transition-colors"
              >
                <span className="hidden sm:inline">{t("finish")}</span>
                <span className="sm:hidden">×</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditMode(true)}
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-3 py-1.5 transition-colors"
              title={t("editDashboard")}
              data-tour="dashboard-edit-btn"
            >
              <Edit3 className="h-4 w-4" />
              <span className="hidden sm:inline">{t("editDashboard")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid Layout Container */}
      <div ref={containerRef} className="w-full" data-tour="dashboard-widgets">
        <GridLayout
          className="layout"
          layout={responsiveLayout}
          gridConfig={{
            cols,
            rowHeight: gridSettings.rowHeight,
            margin: gridSettings.margin,
          }}
          width={width}
          dragConfig={{ enabled: isEditMode }}
          resizeConfig={{ enabled: isEditMode }}
          onLayoutChange={handleLayoutChange}
          compactor={verticalCompactor}
        >
          {visibleWidgets.map((widgetId) => (
            <div
              key={widgetId}
              className={`relative ${isEditMode ? "cursor-move" : ""}`}
            >
              {isEditMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveWidget(widgetId);
                  }}
                  className="absolute -top-2 -right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"
                  title={t("removeWidget")}
                >
                  ×
                </button>
              )}
              {renderWidget(widgetId)}
            </div>
          ))}
        </GridLayout>
      </div>

      <WidgetCatalog
        isOpen={showWidgetCatalog}
        onClose={() => setShowWidgetCatalog(false)}
        availableWidgets={availableWidgets}
        onAddWidget={handleAddWidget}
      />

      <ConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={async () => {
          await resetMutation.mutateAsync();
          setIsEditMode(false);
          setShowResetConfirm(false);
        }}
        title={t("resetTitle")}
        description={t("resetDescription")}
        confirmLabel={t("reset")}
        variant="warning"
        isLoading={resetMutation.isPending}
      />

      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={() => {
          setIsEditMode(false);
          refetchPreferences();
          setHasUnsavedChanges(false);
          setShowDiscardConfirm(false);
        }}
        title={t("discardTitle")}
        description={t("discardDescription")}
        confirmLabel={t("continue")}
        variant="warning"
      />
    </div>
  );
}
