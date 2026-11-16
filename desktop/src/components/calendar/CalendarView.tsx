import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { TimeEntryForm } from "@/components/tracker/TimeEntryForm";
import { Button } from "@/components/ui/Button";
import {
  addMonths,
  isToday as checkIsToday,
  formatShortDate,
  getMonthName,
  getWeekNumber,
} from "@/lib/calendar";
import { toLocalDateStr } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { DayView } from "./DayView";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";

type ViewMode = "dag" | "uge" | "maaned";

export function CalendarView() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ViewMode>("uge");
  const [currentDate, setCurrentDate] = useState(new Date());

  // Form state for create/edit
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | null>(null);
  const [prefillStart, setPrefillStart] = useState<string | null>(null);
  const [prefillEnd, setPrefillEnd] = useState<string | null>(null);

  // Force re-render key for refreshing views after saves
  const [refreshKey, setRefreshKey] = useState(0);

  function navigate(direction: -1 | 1) {
    setCurrentDate((prev) => {
      if (mode === "maaned") {
        return addMonths(prev, direction);
      }
      const d = new Date(prev);
      if (mode === "dag") {
        d.setDate(d.getDate() + direction);
      } else {
        d.setDate(d.getDate() + direction * 7);
      }
      return d;
    });
  }

  function goToToday() {
    setCurrentDate(new Date());
  }

  function getTitle(): string {
    if (mode === "dag") {
      return `${formatShortDate(currentDate)} ${currentDate.getFullYear()}`;
    }
    if (mode === "uge") {
      return t("calendar.weekNumber", { number: getWeekNumber(currentDate) });
    }
    return `${getMonthName(currentDate)} ${currentDate.getFullYear()}`;
  }

  const handleEditEntry = useCallback((entry: TimeEntry) => {
    setEditingEntry(entry);
    setPrefillDate(null);
    setPrefillStart(null);
    setPrefillEnd(null);
    setFormOpen(true);
  }, []);

  const handleCreateEntry = useCallback(
    (date: string, startTime: string, endTime: string) => {
      setEditingEntry(null);
      setPrefillDate(date);
      setPrefillStart(startTime);
      setPrefillEnd(endTime);
      setFormOpen(true);
    },
    [],
  );

  const handleSelectDay = useCallback((day: Date) => {
    setCurrentDate(day);
    setMode("dag");
  }, []);

  function handleFormSaved() {
    setFormOpen(false);
    setEditingEntry(null);
    setRefreshKey((k) => k + 1);
  }

  const todayVisible = checkIsToday(currentDate);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-(--color-border) px-4 py-2">
        <div className="flex items-center gap-2">
          {/* Navigation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            aria-label={t("calendar.previous")}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(1)}
            aria-label={t("calendar.nextLabel")}
          >
            <ChevronRight size={16} />
          </Button>

          <h2 className="ml-1 text-sm font-semibold text-(--color-text)">
            {getTitle()}
          </h2>

          <Button
            variant={todayVisible ? "ghost" : "secondary"}
            size="sm"
            onClick={goToToday}
            className={
              todayVisible ? "text-(--color-accent) font-semibold" : ""
            }
          >
            {t("common.today")}
          </Button>
        </div>

        {/* Keyboard hint — the grid can be driven without a mouse */}
        {mode !== "maaned" && (
          <span className="hidden text-[11px] text-(--color-text-muted)/70 lg:inline">
            {t("calendar.keyboardHint")}
          </span>
        )}

        {/* Mode switcher */}
        <div className="flex rounded-lg border border-(--color-border) bg-(--color-bg) p-0.5">
          {(
            [
              ["dag", t("calendar.day")],
              ["uge", t("calendar.week")],
              ["maaned", t("calendar.month")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value as ViewMode)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                mode === value
                  ? "bg-(--color-surface) text-(--color-text) shadow-sm"
                  : "text-(--color-text-muted) hover:text-(--color-text)"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* View */}
      {mode === "uge" && (
        <WeekView
          key={`week-${toLocalDateStr(currentDate)}-${refreshKey}`}
          date={currentDate}
          onEditEntry={handleEditEntry}
          onCreateEntry={handleCreateEntry}
        />
      )}
      {mode === "dag" && (
        <DayView
          key={`day-${refreshKey}`}
          date={currentDate}
          onEditEntry={handleEditEntry}
          onCreateEntry={handleCreateEntry}
          onNavigateDay={navigate}
        />
      )}
      {mode === "maaned" && (
        <MonthView
          key={`month-${currentDate.getFullYear()}-${currentDate.getMonth()}-${refreshKey}`}
          date={currentDate}
          onSelectDay={handleSelectDay}
        />
      )}

      {/* Time entry form dialog */}
      <TimeEntryForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingEntry(null);
        }}
        onSaved={handleFormSaved}
        entry={editingEntry}
        defaultDate={prefillDate ?? undefined}
        defaultStartTime={prefillStart ?? undefined}
        defaultEndTime={prefillEnd ?? undefined}
      />
    </div>
  );
}
