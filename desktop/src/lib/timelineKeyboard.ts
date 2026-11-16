import { formatTime } from "./format";
import type { Activity } from "./types";

/** Titles are clipped so one long window title cannot flood a screen reader. */
const MAX_TITLE_LENGTH = 60;

/**
 * Short label for an activity: the app, plus the window title when the window
 * actually says something. Mirrors what the row shows, so what is announced
 * matches what is highlighted.
 */
export function activityLabel(activity: Activity): string {
  const title = activity.window_title?.trim();
  if (!title || title === activity.app_name) return activity.app_name;
  const clipped =
    title.length > MAX_TITLE_LENGTH
      ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
      : title;
  return `${activity.app_name}, ${clipped}`;
}

/**
 * What a screen reader hears when the keyboard cursor lands on a row. Without
 * this, j/k in the timeline only moved a coloured ring that assistive tech
 * never learns about — the position ("2 of 12") matters as much as the label,
 * because it tells the user how far there is to go.
 */
export function activeActivityAnnouncement(
  activity: Activity,
  position: number,
  total: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const label = activityLabel(activity);
  const period = `${formatTime(activity.started_at)}–${formatTime(activity.ended_at)}`;
  return t("timeline.keyboardActive", { position, total, label, period });
}
