// Pure date-range resolution for report configs. Lives in its own module so
// client components (drill-down links in the report preview) can import it
// without pulling drizzle/schema from query.ts into the client bundle.
import { parseLocalDateStr } from "@/lib/format";
import type { ReportTemplateConfig } from "./config-schema";

export function resolveDateRange(
  filters: ReportTemplateConfig["filters"],
  reference: Date = new Date(),
): { start: Date; end: Date } {
  const y = reference.getFullYear();
  const m = reference.getMonth();

  switch (filters.dateRange) {
    case "thisMonth":
      return {
        start: new Date(y, m, 1),
        end: new Date(y, m + 1, 0),
      };
    case "lastMonth":
      return {
        start: new Date(y, m - 1, 1),
        end: new Date(y, m, 0),
      };
    case "thisQuarter": {
      const q = Math.floor(m / 3);
      return {
        start: new Date(y, q * 3, 1),
        end: new Date(y, q * 3 + 3, 0),
      };
    }
    case "thisYear":
      return {
        start: new Date(y, 0, 1),
        end: new Date(y, 11, 31),
      };
    case "custom":
      if (!filters.customStart || !filters.customEnd) {
        throw new Error("custom dateRange requires customStart and customEnd");
      }
      return {
        start: parseLocalDateStr(filters.customStart),
        end: parseLocalDateStr(filters.customEnd),
      };
  }
}
