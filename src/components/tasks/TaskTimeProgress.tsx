import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  formatTaskMinutes,
  getTaskTimeProgress,
  TASK_PROGRESS_TONES,
} from "@/lib/tasks/time-progress";

interface TaskTimeProgressProps {
  trackedMinutes: number | null | undefined;
  estimatedMinutes: number | null | undefined;
}

type TasksT = ReturnType<typeof useTranslations<"tasks">>;

function useFormatMinutes() {
  const t = useTranslations("tasks");
  const locale = toIntlLocale(useLocale());
  const minuteUnit = t("timeUnits.minute");
  const hourUnit = t("timeUnits.hour");
  return (minutes: number) =>
    formatTaskMinutes(minutes, { locale, minuteUnit, hourUnit });
}

function beskriv(
  t: TasksT,
  format: (minutes: number) => string,
  tracked: number,
  estimate: number | null,
  pct: number | null,
) {
  if (estimate === null) {
    return t("timeProgress.tracked", { tracked: format(tracked) });
  }
  return t("timeProgress.trackedOfEstimate", {
    tracked: format(tracked),
    estimate: format(estimate),
    pct: pct ?? 0,
  });
}

/**
 * Kompakt "1,5t / 3t"-chip til task-rækker (#212). Uden estimat vises kun den
 * registrerede tid; uden tid vises kun estimatet; uden begge intet.
 */
export function TaskTimeChip({
  trackedMinutes,
  estimatedMinutes,
}: TaskTimeProgressProps) {
  const t = useTranslations("tasks");
  const format = useFormatMinutes();
  const p = getTaskTimeProgress(trackedMinutes, estimatedMinutes);
  if (p.trackedMinutes === 0 && p.estimatedMinutes === null) return null;

  const tone =
    p.status && p.trackedMinutes > 0
      ? TASK_PROGRESS_TONES[p.status].text
      : "text-gray-500 dark:text-gray-400";
  const label =
    p.estimatedMinutes === null
      ? format(p.trackedMinutes)
      : p.trackedMinutes === 0
        ? format(p.estimatedMinutes)
        : `${format(p.trackedMinutes)} / ${format(p.estimatedMinutes)}`;

  return (
    <span
      className={`shrink-0 flex items-center gap-0.5 text-[10px] font-medium tabular-nums ${tone}`}
      title={beskriv(
        t,
        format,
        p.trackedMinutes,
        p.estimatedMinutes,
        p.percentage,
      )}
    >
      <Clock className="h-2.5 w-2.5" aria-hidden="true" />
      <span className="sr-only">
        {beskriv(t, format, p.trackedMinutes, p.estimatedMinutes, p.percentage)}
      </span>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

/** Tynd fremdriftsbar mod estimatet; intet uden estimat eller uden tid. */
export function TaskTimeBar({
  trackedMinutes,
  estimatedMinutes,
  className = "",
}: TaskTimeProgressProps & { className?: string }) {
  const p = getTaskTimeProgress(trackedMinutes, estimatedMinutes);
  if (p.status === null || p.percentage === null || p.trackedMinutes === 0) {
    return null;
  }
  return (
    <div
      className={`h-0.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 ${className}`}
      aria-hidden="true"
    >
      <div
        className={`h-full rounded-full ${TASK_PROGRESS_TONES[p.status].bar}`}
        style={{ width: `${Math.min(100, p.percentage)}%` }}
      />
    </div>
  );
}

/** Fremdrift som kolonne i listevisningen: mini-bar + procent. */
export function TaskTimeProgressCell({
  trackedMinutes,
  estimatedMinutes,
}: TaskTimeProgressProps) {
  const t = useTranslations("tasks");
  const format = useFormatMinutes();
  const p = getTaskTimeProgress(trackedMinutes, estimatedMinutes);
  if (p.status === null || p.percentage === null) {
    return (
      <span className="text-[11px] text-gray-400 dark:text-gray-500">–</span>
    );
  }
  return (
    <span
      className="flex w-full items-center gap-1.5"
      title={beskriv(
        t,
        format,
        p.trackedMinutes,
        p.estimatedMinutes,
        p.percentage,
      )}
    >
      <span
        className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        aria-hidden="true"
      >
        <span
          className={`block h-full rounded-full ${TASK_PROGRESS_TONES[p.status].bar}`}
          style={{ width: `${Math.min(100, p.percentage)}%` }}
        />
      </span>
      <span
        className={`text-[11px] font-medium tabular-nums ${TASK_PROGRESS_TONES[p.status].text}`}
      >
        {t("timeProgress.percent", { pct: p.percentage })}
      </span>
    </span>
  );
}
