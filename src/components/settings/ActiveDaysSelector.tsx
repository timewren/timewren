// Weekday selector for notification channels.
// Days are 0=Sunday … 6=Saturday (matches JavaScript Date.getDay()).
// Order shown in UI starts with Monday since Denmark is a Mon-first locale.
"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

const DAYS: ReadonlyArray<{ value: number; key: string }> = [
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 0, key: "sun" },
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function ActiveDaysSelector({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("settingsSchedule.activeDays");
  const tDays = useTranslations("settingsSchedule.days");
  const selected = useMemo(() => new Set(value), [value]);
  const todayWeekday = new Date().getDay();
  const isActiveToday = selected.has(todayWeekday);
  const isMutedEveryDay = value.length === 0;

  const toggle = (day: number) => {
    const next = new Set(selected);
    if (next.has(day)) {
      next.delete(day);
    } else {
      next.add(day);
    }
    onChange([...next].sort((a, b) => a - b));
  };

  return (
    <div className="space-y-3">
      <fieldset className="flex flex-wrap gap-2 border-0 p-0 m-0">
        <legend className="sr-only">{t("legend")}</legend>
        {DAYS.map((d) => {
          const isOn = selected.has(d.value);
          const isToday = d.value === todayWeekday;
          const dayLabel = tDays(d.key);
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => toggle(d.value)}
              disabled={disabled}
              aria-pressed={isOn}
              aria-label={isToday ? t("today", { day: dayLabel }) : dayLabel}
              className={`relative min-w-[3.25rem] rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isOn
                  ? "border-brand-600 bg-tt-gran text-tt-paa-gran hover:bg-tt-gran-moerk"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              } ${isToday ? "ring-2 ring-offset-1 ring-brand-400 dark:ring-offset-gray-800" : ""}`}
            >
              {dayLabel}
            </button>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => onChange(WEEKDAYS)}
          disabled={disabled}
          className="rounded-md border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {t("weekdaysOnly")}
        </button>
        <button
          type="button"
          onClick={() => onChange(ALL_DAYS)}
          disabled={disabled}
          className="rounded-md border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {t("allDays")}
        </button>
        {!isMutedEveryDay && (
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              isActiveToday
                ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isActiveToday ? "bg-green-500" : "bg-gray-400"
              }`}
            />
            {isActiveToday ? t("activeToday") : t("quietToday")}
          </span>
        )}
      </div>

      {isMutedEveryDay && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <p>{t("noneSelected")}</p>
        </div>
      )}
    </div>
  );
}
