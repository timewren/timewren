import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Calendar, Clock, CreditCard } from "lucide-react";
import { useMemo } from "react";
import { apiClient } from "../../api/client";
import { useT } from "../../i18n";
import { formatHoursShort } from "../../lib/format-hours";
import { useAuthStore } from "../../stores/authStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { addDays, getMonday, toLocalDateStr } from "../../utils/calendar-math";
import { getTodayStr } from "../../utils/date";

// Hele ugen: weekendtimer tæller med i ugetotalen
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const formatHours = formatHoursShort;

export function StatsBar() {
  const { t } = useT();
  const todayStr = getTodayStr();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const { settings } = useSettingsStore();
  const dailyGoal = settings.dailyGoalHours || 8;

  const monday = useMemo(() => getMonday(new Date()), []);
  const sunday = useMemo(() => addDays(monday, 6), [monday]);
  const mondayStr = toLocalDateStr(monday);
  const sundayStr = toLocalDateStr(sunday);

  // Ugens poster (dagen i dag ligger altid i ugen, så den hentes ikke for sig)
  const { data: weekEntries } = useQuery({
    queryKey: ["timeEntries", mondayStr, sundayStr, selectedOrgId],
    queryFn: () => apiClient.getTimeEntries(mondayStr, sundayStr),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });

  // Prepaid packages
  const { data: packages } = useQuery({
    queryKey: ["activePackages", selectedOrgId],
    queryFn: () => apiClient.getActivePackages(),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });

  const todayHours =
    weekEntries
      ?.filter((e) => e.date === todayStr)
      .reduce((sum, e) => sum + e.hours, 0) ?? 0;
  const todayProgressPct = Math.min((todayHours / dailyGoal) * 100, 100);

  // Compute hours per weekday (Mon=0..Sun=6)
  const weekdayHours = useMemo(() => {
    const hours = [0, 0, 0, 0, 0, 0, 0];
    if (!weekEntries) return hours;
    for (let i = 0; i < 7; i++) {
      const dayDate = toLocalDateStr(addDays(monday, i));
      for (const entry of weekEntries) {
        if (entry.date === dayDate) {
          hours[i] += entry.hours;
        }
      }
    }
    return hours;
  }, [weekEntries, monday]);

  const totalWeekHours = weekdayHours.reduce((a, b) => a + b, 0);
  const maxHours = Math.max(...weekdayHours, 0.1);

  const activePackages = packages?.length ?? 0;
  const lowBalanceCount =
    packages?.filter((p) => p.remainingHours <= p.totalHours * 0.2).length ?? 0;

  return (
    <div className="max-w-7xl mx-auto px-6 py-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Today */}
        <div className="bg-[var(--color-surface-sunken)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={12} className="text-[var(--color-text-muted)]" />
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">
              {t("newtab.stats.today")}
            </span>
          </div>
          <div className="text-lg font-bold text-[var(--color-text-primary)]">
            {formatHours(todayHours)}
          </div>
          <div className="mt-2 h-1.5 w-full bg-[var(--color-surface-base)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                todayProgressPct >= 100 ? "bg-primary-700" : "bg-primary-600"
              }`}
              style={{ width: `${todayProgressPct}%` }}
            />
          </div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">
            {t("newtab.stats.ofGoal", { goal: dailyGoal })}
          </div>
        </div>

        {/* This week */}
        <div className="bg-[var(--color-surface-sunken)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar size={12} className="text-[var(--color-text-muted)]" />
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">
              {t("newtab.stats.thisWeek")}
            </span>
          </div>
          <div className="text-lg font-bold text-[var(--color-text-primary)]">
            {formatHours(totalWeekHours)}
          </div>
          {/* Mini 7-bar chart */}
          <div className="flex items-end gap-1 mt-2" style={{ height: "28px" }}>
            {weekdayHours.map((hours, i) => {
              const barHeight = maxHours > 0 ? (hours / maxHours) * 24 : 0;
              return (
                <div
                  key={toLocalDateStr(addDays(monday, i))}
                  className="flex-1 flex flex-col items-center gap-0.5"
                >
                  <div
                    className="w-full bg-primary-600 rounded-sm transition-all duration-300"
                    style={{
                      height: `${Math.max(barHeight, hours > 0 ? 3 : 1)}px`,
                      opacity: hours > 0 ? 1 : 0.2,
                    }}
                  />
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {t(`format.weekdayLetter.${WEEKDAY_KEYS[i]}`)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active prepaid packages */}
        <div className="bg-[var(--color-surface-sunken)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={12} className="text-[var(--color-text-muted)]" />
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">
              {t("newtab.stats.activePackages")}
            </span>
          </div>
          <div className="text-lg font-bold text-[var(--color-text-primary)]">
            {activePackages}
          </div>
          {lowBalanceCount > 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              <AlertTriangle
                size={12}
                className="text-[var(--color-warning)]"
              />
              <span className="text-xs font-medium text-[var(--color-warning-text)]">
                {t("newtab.stats.lowBalance", { count: lowBalanceCount })}
              </span>
            </div>
          )}
          {lowBalanceCount === 0 && (
            <div className="text-xs text-[var(--color-text-muted)] mt-1.5">
              {t("newtab.stats.allGood")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
