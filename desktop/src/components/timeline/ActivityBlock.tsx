import { motion } from "framer-motion";
import { Check, Coffee, Pencil, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration, formatTime } from "@/lib/format";
import type { Activity, Project } from "@/lib/types";

interface ActivityBlockProps {
  activity: Activity;
  projects: Project[];
  onConfirm: (activity: Activity) => void;
  /** Open the "create rule from this activity" dialog, prefilled from it. */
  onCreateRule?: (activity: Activity) => void;
  /** Maximum duration of any activity in the day, used for bar sizing */
  maxDuration: number;
}

function getProjectColor(
  activity: Activity,
  projects: Project[],
): string | null {
  if (!activity.project_id) return null;
  const project = projects.find((p) => p.id === activity.project_id);
  return project?.color ?? null;
}

function getProjectName(
  activity: Activity,
  projects: Project[],
): string | null {
  if (!activity.project_id) return null;
  const project = projects.find((p) => p.id === activity.project_id);
  return project?.name ?? null;
}

function getConfidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * One discreet Danish explanation line for a classified activity, e.g.
 * "95% · Mønster — git_repo timetrack-desktop". Makes the classification
 * transparent so the user can trust "Godkend alle" and calibrate their rules.
 * Returns null when the activity was not auto-classified.
 */
function getClassificationExplanation(
  activity: Activity,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  if (activity.confidence === null || !activity.classification_source) {
    return null;
  }
  const parts = [`${Math.round(activity.confidence * 100)}%`];
  parts.push(
    t(`timeline.source.${activity.classification_source}`, {
      defaultValue: activity.classification_source,
    }),
  );
  let line = parts.join(" · ");
  if (activity.classification_reason) {
    line += ` — ${activity.classification_reason}`;
  }
  return line;
}

// Category labels are now fetched via i18n in the component

export function ActivityBlock({
  activity,
  projects,
  onConfirm,
  onCreateRule,
  maxDuration,
}: ActivityBlockProps) {
  const { t } = useTranslation();
  const projectColor = getProjectColor(activity, projects);
  const projectName = getProjectName(activity, projects);
  const explanation = getClassificationExplanation(activity, t);
  const isConfirmed =
    activity.is_confirmed ||
    (activity.confidence !== null && activity.confidence > 0.85);

  // Bar width proportional to duration (min 40%, max 100%)
  const barWidth = Math.min(
    100,
    Math.max(40, (activity.duration / maxDuration) * 100),
  );

  if (activity.is_idle) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex items-center gap-3 rounded-lg border border-dashed border-(--color-border) bg-(--color-surface)/50 px-3 py-2 opacity-60"
        style={{ width: `${barWidth}%` }}
      >
        {/* Idle indicator */}
        <div className="h-8 w-1 shrink-0 rounded-full bg-(--color-text-muted)/30" />

        {/* Time range */}
        <span className="shrink-0 font-mono text-xs text-(--color-text-muted)">
          {formatTime(activity.started_at)}&ndash;
          {formatTime(activity.ended_at)}
        </span>

        {/* Content */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Coffee size={14} className="shrink-0 text-(--color-text-muted)/60" />
          <span className="text-xs text-(--color-text-muted)">
            {t("timeline.idle")}
          </span>
        </div>

        {/* Duration */}
        <span className="shrink-0 font-mono text-xs text-(--color-text-muted)">
          {formatDuration(activity.duration)}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`group relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
        isConfirmed
          ? "border-(--color-border) bg-(--color-surface) hover:border-(--color-text-muted)/30"
          : "cursor-pointer border-dashed border-(--color-border) bg-(--color-surface)/70 opacity-80 hover:border-(--color-accent)/50 hover:opacity-100"
      }`}
      style={{ width: `${barWidth}%` }}
      onClick={() => {
        if (!isConfirmed) onConfirm(activity);
      }}
      onKeyDown={(e) => {
        if (!isConfirmed && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onConfirm(activity);
        }
      }}
      role={isConfirmed ? undefined : "button"}
      tabIndex={isConfirmed ? undefined : 0}
    >
      {/* Project color indicator */}
      <div
        className="h-8 w-1 shrink-0 rounded-full"
        style={{
          backgroundColor: projectColor ?? "#6b7280",
        }}
      />

      {/* Time range */}
      <span className="shrink-0 font-mono text-xs text-(--color-text-muted)">
        {formatTime(activity.started_at)}&ndash;{formatTime(activity.ended_at)}
      </span>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-(--color-text)">
            {activity.app_name}
          </span>
          {projectName && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-(--color-border)/60 px-1.5 py-px text-[10px] text-(--color-text-muted)">
              {projectColor && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: projectColor }}
                />
              )}
              {projectName}
            </span>
          )}
          {activity.category && (
            <span className="shrink-0 rounded bg-(--color-border)/40 px-1.5 py-px text-[10px] text-(--color-text-muted)">
              {t(`categories.${activity.category}`, {
                defaultValue: activity.category,
              })}
            </span>
          )}
        </div>
        {activity.window_title && (
          <p className="truncate text-xs text-(--color-text-muted)">
            {activity.window_title}
          </p>
        )}
        {explanation && (
          <p
            className="truncate text-[10px] text-(--color-text-muted)/70"
            title={explanation}
          >
            {explanation}
          </p>
        )}
      </div>

      {/* Right side: duration + confidence + action */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Confidence badge */}
        {activity.confidence !== null && !activity.is_confirmed && (
          <span
            className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium ${
              activity.confidence > 0.85
                ? "bg-emerald-500/15 text-emerald-400"
                : activity.confidence > 0.5
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-red-500/15 text-red-400"
            }`}
          >
            {getConfidenceLabel(activity.confidence)}
          </span>
        )}

        {/* Duration */}
        <span className="font-mono text-sm font-medium text-(--color-text)">
          {formatDuration(activity.duration)}
        </span>

        {/* Create rule from this activity */}
        {onCreateRule && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCreateRule(activity);
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-(--color-text-muted) opacity-0 transition-all hover:bg-(--color-border) hover:text-(--color-text) group-hover:opacity-100"
            title={t("timeline.createRuleFromActivity")}
            aria-label={t("timeline.createRuleFromActivity")}
          >
            <Wand2 size={13} />
          </button>
        )}

        {/* Action icon */}
        <div className="flex h-6 w-6 items-center justify-center">
          {isConfirmed ? (
            <Check size={14} className="text-emerald-400" />
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onConfirm(activity);
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-(--color-text-muted) opacity-0 transition-all hover:bg-(--color-border) hover:text-(--color-text) group-hover:opacity-100"
              title={t("timeline.confirm")}
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
