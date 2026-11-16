import { useMemo } from "react";
import { toIntlLocale, useT } from "../../../i18n";
import { addDays, getMonday, toLocalDateStr } from "../../utils/calendar-math";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

interface WeekStripProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  entryCountsByDate: Record<string, number>;
}

export function WeekStrip({
  selectedDate,
  onSelectDate,
  entryCountsByDate,
}: WeekStripProps) {
  const { t, locale } = useT();
  const todayStr = toLocalDateStr(new Date());
  const selectedStr = toLocalDateStr(selectedDate);

  const weekDays = useMemo(() => {
    const monday = getMonday(selectedDate);
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      const dateStr = toLocalDateStr(date);
      return {
        date,
        dateStr,
        dayNum: date.getDate(),
        dayAbbr: t(`format.weekdayShort.${DAY_KEYS[i]}`),
        isWeekend: i >= 5,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedStr,
        entryCount: entryCountsByDate[dateStr] || 0,
      };
    });
  }, [selectedDate, todayStr, selectedStr, entryCountsByDate, t]);

  return (
    <div className="flex gap-0.5 px-2 py-1.5 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-subtle)]">
      {weekDays.map((day) => (
        <button
          key={day.dateStr}
          type="button"
          onClick={() => onSelectDate(day.date)}
          aria-pressed={day.isSelected}
          aria-label={day.date.toLocaleDateString(toIntlLocale(locale), {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all duration-150 ${
            day.isSelected
              ? "bg-primary-600 text-[var(--color-on-primary)] shadow-sm"
              : "hover:bg-[var(--color-surface-sunken)]"
          }`}
        >
          <span
            className={`text-[11px] font-medium ${
              day.isSelected
                ? "text-[var(--color-on-primary)] opacity-80"
                : day.isToday
                  ? "text-primary-600 font-semibold"
                  : day.isWeekend
                    ? "text-[var(--color-text-muted)]"
                    : "text-[var(--color-text-tertiary)]"
            }`}
          >
            {day.dayAbbr}
          </span>
          <span
            className={`text-xs font-semibold leading-none ${
              day.isSelected
                ? "text-[var(--color-on-primary)]"
                : day.isToday
                  ? "text-primary-600"
                  : day.isWeekend
                    ? "text-[var(--color-text-muted)]"
                    : "text-[var(--color-text-primary)]"
            }`}
          >
            {day.dayNum}
          </span>
          {/* Entry count dots */}
          <div className="flex gap-0.5 h-1">
            {Array.from({ length: Math.min(day.entryCount, 3) }, (_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
                key={i}
                className={`w-1 h-1 rounded-full ${
                  day.isSelected
                    ? "bg-[var(--color-on-primary)] opacity-70"
                    : "bg-primary-600"
                }`}
              />
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}
