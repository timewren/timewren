"use client";

import { Clock, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { clockRangeHours } from "@/lib/time/clock-range";

interface TimeRangeInputProps {
  date: string; // YYYY-MM-DD format
  startTime: string | null; // HH:mm format
  endTime: string | null; // HH:mm format
  onStartTimeChange: (time: string | null) => void;
  onEndTimeChange: (time: string | null) => void;
  onHoursCalculated?: (hours: number) => void;
  disabled?: boolean;
}

export function TimeRangeInput({
  date,
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  onHoursCalculated,
  disabled = false,
}: TimeRangeInputProps) {
  const t = useTranslations("time");
  /** Format hours to "2t 15m" */
  const formatDuration = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return t("duration.hm", { h, m });
  };
  const [useTimeRange, setUseTimeRange] = useState(!!(startTime || endTime));
  const [calculatedHours, setCalculatedHours] = useState<number | null>(null);

  // Når tider sættes udefra (fx "kl. 9-11" fra fritekst-forslaget efter mount),
  // skal feltet foldes ud, ellers sendes et usynligt tidsrum med ved Gem.
  useEffect(() => {
    if (startTime || endTime) setUseTimeRange(true);
  }, [startTime, endTime]);

  // Calculate hours when both times are set
  useEffect(() => {
    if (startTime && endTime && useTimeRange) {
      // Reelle tidspunkter på datoen (sommertidsnætter giver ±1 t)
      const hours = clockRangeHours(date, startTime, endTime);
      setCalculatedHours(hours);
      onHoursCalculated?.(hours);
    } else {
      setCalculatedHours(null);
    }
  }, [date, startTime, endTime, useTimeRange, onHoursCalculated]);

  // Toggle handler
  const handleToggle = (checked: boolean) => {
    setUseTimeRange(checked);
    if (!checked) {
      onStartTimeChange(null);
      onEndTimeChange(null);
    } else {
      // Set default times when enabling
      const now = new Date();
      const currentHour = now.getHours();
      // Mellem 00:00 og 00:59 ville "currentHour - 1" give "-1:00"
      const startDefault = `${String(Math.max(0, currentHour - 1)).padStart(2, "0")}:00`;
      const endDefault = `${String(currentHour).padStart(2, "0")}:00`;
      onStartTimeChange(startDefault);
      onEndTimeChange(endDefault);
    }
  };

  // Quick duration presets
  const handleQuickDuration = (minutes: number) => {
    if (!startTime) {
      const now = new Date();
      const startDefault = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      onStartTimeChange(startDefault);

      // Calculate end time
      const startMinutes = now.getHours() * 60 + now.getMinutes();
      const endMinutes = startMinutes + minutes;
      const endHour = Math.floor(endMinutes / 60) % 24;
      const endMin = endMinutes % 60;
      onEndTimeChange(
        `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`,
      );
    } else {
      // Add duration to existing start time
      const [startHour, startMin] = startTime.split(":").map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = startMinutes + minutes;
      const endHour = Math.floor(endMinutes / 60) % 24;
      const endMin = endMinutes % 60;
      onEndTimeChange(
        `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`,
      );
    }
  };

  return (
    <div className="space-y-3">
      {/* Toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={useTimeRange}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("range.toggle")}
          </span>
        </div>
      </label>

      {/* Time inputs */}
      {useTimeRange && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Start time */}
            <div>
              <label
                htmlFor="startTime"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("range.start")}
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="startTime"
                  type="time"
                  value={startTime || ""}
                  onChange={(e) => onStartTimeChange(e.target.value || null)}
                  disabled={disabled}
                  className="w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </div>
            </div>

            {/* End time */}
            <div>
              <label
                htmlFor="endTime"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("range.end")}
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="endTime"
                  type="time"
                  value={endTime || ""}
                  onChange={(e) => onEndTimeChange(e.target.value || null)}
                  disabled={disabled}
                  className="w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Quick duration buttons */}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {t("range.quick")}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { mins: 15, label: t("duration.m", { m: 15 }) },
                { mins: 30, label: t("duration.m", { m: 30 }) },
                { mins: 45, label: t("duration.m", { m: 45 }) },
                { mins: 60, label: t("duration.h", { h: 1 }) },
                { mins: 90, label: t("duration.hHalf") },
                { mins: 120, label: t("duration.h", { h: 2 }) },
                { mins: 180, label: t("duration.h", { h: 3 }) },
                { mins: 240, label: t("duration.h", { h: 4 }) },
              ].map(({ mins, label }) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => handleQuickDuration(mins)}
                  disabled={disabled}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-brand-50 hover:border-brand-300 dark:hover:bg-tt-gran-lys dark:hover:border-brand-600 transition-colors disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Calculated duration display */}
          {calculatedHours !== null && calculatedHours > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {t("range.calculated")}
              </span>
              <span className="tabular-nums text-lg font-semibold text-brand-600 dark:text-brand-400">
                {formatDuration(calculatedHours)}
              </span>
            </div>
          )}

          {startTime && endTime && startTime === endTime && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {t("range.endAfterStart")}
            </p>
          )}

          {/* Warning for crossing midnight */}
          {calculatedHours !== null && calculatedHours > 12 && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {t("range.over12")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
