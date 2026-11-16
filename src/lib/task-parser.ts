/**
 * Client-side task text parser for Quick Add preview.
 * Mirrors the server-side simpleParseText() from tasks router.
 */

import { parseEstimate } from "@/lib/tasks/time-progress";

type Priority = "low" | "medium" | "high" | "urgent";

interface ParsedTask {
  title: string;
  deadline: Date | null;
  priority: Priority;
  /** Estimat fra fx "~4t", "30 min" (#212); null uden estimat. */
  estimatedMinutes: number | null;
}

function getNextWeekday(weekday: number): Date {
  const today = new Date();
  const currentDay = today.getDay();
  const daysUntil = (weekday - currentDay + 7) % 7 || 7;
  const result = new Date(today);
  result.setDate(result.getDate() + daysUntil);
  return result;
}

export function parseTaskText(text: string): ParsedTask {
  let title = text;
  let deadline: Date | null = null;
  let priority: Priority = "medium";
  let estimatedMinutes: number | null = null;

  // Estimat først, så "2t" ikke bliver hængende i titlen (#212)
  const estimate = parseEstimate(title);
  if (estimate) {
    estimatedMinutes = estimate.minutes;
    title = estimate.rest;
  }

  // Deadline extraction (Danish)
  const deadlinePatterns = [
    { pattern: /i morgen/i, days: 1 },
    { pattern: /i overmorgen/i, days: 2 },
    { pattern: /om (\d+) dag(e)?/i, daysMatch: 1 },
    { pattern: /inden fredag/i, weekday: 5 },
    { pattern: /inden mandag/i, weekday: 1 },
    { pattern: /inden tirsdag/i, weekday: 2 },
    { pattern: /inden onsdag/i, weekday: 3 },
    { pattern: /inden torsdag/i, weekday: 4 },
    { pattern: /inden lørdag/i, weekday: 6 },
    { pattern: /inden søndag/i, weekday: 0 },
  ] as const;

  for (const { pattern, ...rest } of deadlinePatterns) {
    const match = title.match(pattern);
    if (match) {
      if ("days" in rest && rest.days) {
        deadline = new Date();
        deadline.setDate(deadline.getDate() + rest.days);
      } else if (
        "daysMatch" in rest &&
        rest.daysMatch !== undefined &&
        match[rest.daysMatch]
      ) {
        deadline = new Date();
        deadline.setDate(
          deadline.getDate() + parseInt(match[rest.daysMatch], 10),
        );
      } else if ("weekday" in rest && rest.weekday !== undefined) {
        deadline = getNextWeekday(rest.weekday);
      }
      title = title.replace(pattern, "").trim();
      break;
    }
  }

  // Priority extraction
  if (/urgent|kritisk/i.test(title)) {
    priority = "urgent";
    title = title.replace(/urgent|kritisk/gi, "").trim();
  } else if (/haster|asap|vigtig/i.test(title)) {
    priority = "high";
    title = title.replace(/haster|asap|vigtig/gi, "").trim();
  } else if (/lavprioriteret|når du har tid/i.test(title)) {
    priority = "low";
    title = title.replace(/lavprioriteret|når du har tid/gi, "").trim();
  }

  return { title, deadline, priority, estimatedMinutes };
}
