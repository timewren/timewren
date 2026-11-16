import { GripVertical } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useT } from "../../i18n";
import { PrepaidStatus } from "../../popup/components/PrepaidStatus";
import { QuickEntry } from "../../popup/components/QuickEntry";
import { Timer } from "../../popup/components/Timer";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTimerStore } from "../../stores/timerStore";
import { ClockWidget } from "./ClockWidget";
import { RecentEntriesWidget } from "./RecentEntriesWidget";
import { TodayStatsWidget } from "./TodayStatsWidget";
import { WeeklyChartWidget } from "./WeeklyChartWidget";

// Widgets that span 2 columns
const WIDE_WIDGETS = new Set(["clock", "recentEntries", "weeklyChart"]);

interface WidgetGridProps {
  widgets: string[];
}

export function WidgetGrid({ widgets }: WidgetGridProps) {
  const { t } = useT();
  const timer = useTimerStore((s) => s.timer);
  const { updateSettings } = useSettingsStore();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragCounter = useRef<Record<string, number>>({});

  const activeWidgets =
    widgets.length > 0 ? widgets : ["clock", "timer", "quickEntry"];

  const handleDragStart = useCallback(
    (e: React.DragEvent, widgetId: string) => {
      setDraggedId(widgetId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", widgetId);
      // Make the drag image slightly transparent
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = "0.5";
      }
    },
    [],
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    setDraggedId(null);
    setDragOverId(null);
    dragCounter.current = {};
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent, widgetId: string) => {
      e.preventDefault();
      dragCounter.current[widgetId] = (dragCounter.current[widgetId] || 0) + 1;
      if (widgetId !== draggedId) {
        setDragOverId(widgetId);
      }
    },
    [draggedId],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent, widgetId: string) => {
      e.preventDefault();
      dragCounter.current[widgetId] = (dragCounter.current[widgetId] || 0) - 1;
      if (dragCounter.current[widgetId] <= 0) {
        dragCounter.current[widgetId] = 0;
        if (dragOverId === widgetId) {
          setDragOverId(null);
        }
      }
    },
    [dragOverId],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === targetId) return;

      const newWidgets = [...activeWidgets];
      const sourceIdx = newWidgets.indexOf(sourceId);
      const targetIdx = newWidgets.indexOf(targetId);
      if (sourceIdx === -1 || targetIdx === -1) return;

      // Move source to target position
      newWidgets.splice(sourceIdx, 1);
      newWidgets.splice(targetIdx, 0, sourceId);

      updateSettings({ newTabWidgets: newWidgets });
      setDraggedId(null);
      setDragOverId(null);
      dragCounter.current = {};
    },
    [activeWidgets, updateSettings],
  );

  const renderWidgetContent = (widgetId: string) => {
    switch (widgetId) {
      case "clock":
        return <ClockWidget />;
      case "timer":
        return (
          <>
            <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
              {t("newtab.widgets.timer.name")}
            </h2>
            <Timer compact />
          </>
        );
      case "quickEntry":
        return (
          <>
            <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
              {t("newtab.widgets.quickEntry.name")}
            </h2>
            <QuickEntry />
          </>
        );
      case "prepaidStatus":
        return (
          <>
            <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
              {t("newtab.widgets.prepaidStatus.name")}
            </h2>
            <PrepaidStatus clientId={timer?.clientId || null} />
          </>
        );
      case "todayStats":
        return <TodayStatsWidget />;
      case "recentEntries":
        return <RecentEntriesWidget />;
      case "weeklyChart":
        return <WeeklyChartWidget />;
      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {activeWidgets.map((widgetId) => {
        const isWide = WIDE_WIDGETS.has(widgetId);
        const isDragging = draggedId === widgetId;
        const isDragOver = dragOverId === widgetId && draggedId !== widgetId;

        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: træk-og-slip af widgets er kun-mus; kortenes indhold er selv tastaturtilgængeligt
          <div
            key={widgetId}
            className={`widget-card animate-fade-in group/widget relative ${
              isWide ? "md:col-span-2" : ""
            } ${isDragging ? "opacity-50 scale-[0.98]" : ""} ${
              isDragOver
                ? "ring-2 ring-primary-600 ring-offset-2 scale-[1.02]"
                : ""
            } transition-all duration-200`}
            draggable
            onDragStart={(e) => handleDragStart(e, widgetId)}
            onDragEnd={handleDragEnd}
            onDragEnter={(e) => handleDragEnter(e, widgetId)}
            onDragLeave={(e) => handleDragLeave(e, widgetId)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, widgetId)}
          >
            {/* Drag handle */}
            <div className="absolute top-3 right-3 opacity-0 group-hover/widget:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10">
              <GripVertical className="w-4 h-4 text-[var(--color-text-muted)]" />
            </div>
            {renderWidgetContent(widgetId)}
          </div>
        );
      })}
    </div>
  );
}
