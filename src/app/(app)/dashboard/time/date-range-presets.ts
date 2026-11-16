import { toLocalDateStr } from "@/lib/format";
import { addDaysToDateStr, weekStartDateStr } from "@/lib/time/copenhagen";

// Date range quick filter options
export type DateRangePreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "lastQuarter"
  | "thisYear"
  | "lastYear"
  | "custom";

export function getDateRangeForPreset(
  preset: DateRangePreset,
  today: Date = new Date(),
): {
  start: string;
  end: string;
} {
  const todayStr = toLocalDateStr(today);

  switch (preset) {
    case "today":
      return { start: todayStr, end: todayStr };
    case "yesterday": {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        start: toLocalDateStr(yesterday),
        end: toLocalDateStr(yesterday),
      };
    }
    // ISO-uge (mandag–søndag). getDay() er 0 om søndagen, så den gamle
    // "getDate() - getDay() + 1" pegede på NÆSTE uges mandag hver søndag.
    case "thisWeek": {
      const monday = weekStartDateStr(todayStr);
      return { start: monday, end: addDaysToDateStr(monday, 6) };
    }
    case "lastWeek": {
      const monday = addDaysToDateStr(weekStartDateStr(todayStr), -7);
      return { start: monday, end: addDaysToDateStr(monday, 6) };
    }
    case "thisMonth": {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return {
        start: toLocalDateStr(startOfMonth),
        end: toLocalDateStr(endOfMonth),
      };
    }
    case "lastMonth": {
      const startOfLastMonth = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1,
      );
      const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        start: toLocalDateStr(startOfLastMonth),
        end: toLocalDateStr(endOfLastMonth),
      };
    }
    case "thisQuarter": {
      const q = Math.floor(today.getMonth() / 3);
      return {
        start: toLocalDateStr(new Date(today.getFullYear(), q * 3, 1)),
        end: toLocalDateStr(new Date(today.getFullYear(), q * 3 + 3, 0)),
      };
    }
    case "lastQuarter": {
      const q = Math.floor(today.getMonth() / 3) - 1;
      const year = q < 0 ? today.getFullYear() - 1 : today.getFullYear();
      const qAdj = q < 0 ? 3 : q;
      return {
        start: toLocalDateStr(new Date(year, qAdj * 3, 1)),
        end: toLocalDateStr(new Date(year, qAdj * 3 + 3, 0)),
      };
    }
    case "thisYear":
      return {
        start: toLocalDateStr(new Date(today.getFullYear(), 0, 1)),
        end: toLocalDateStr(new Date(today.getFullYear(), 11, 31)),
      };
    case "lastYear":
      return {
        start: toLocalDateStr(new Date(today.getFullYear() - 1, 0, 1)),
        end: toLocalDateStr(new Date(today.getFullYear() - 1, 11, 31)),
      };
    default:
      return { start: todayStr, end: todayStr };
  }
}
