// src/lib/reports/generators/json.ts

import type { ReportEntry } from "../columns";
import { entryColumns, REPORT_COLUMNS } from "../columns";
import type { ReportColumnKey } from "../config-schema";
import type { ReportAggregates } from "../query";

export function generateJSON(
  entries: ReportEntry[],
  opts: {
    columns: readonly ReportColumnKey[];
    /**
     * Gruppe-niveau data (budget). Uden den returneres en ren array som før,
     * så eksisterende integrationer ikke brækker (#593).
     */
    groups?: ReportAggregates["groups"];
    groupingNote?: string | null;
  },
): string {
  const cols = entryColumns(opts.columns);
  const rows = entries.map((e) => {
    const row: Record<string, string | number | boolean> = {};
    for (const k of cols) {
      row[k] = REPORT_COLUMNS[k].getValue(e);
    }
    return row;
  });
  if (!opts.groups || opts.groups.length === 0) {
    return JSON.stringify(rows, null, 2);
  }

  return JSON.stringify(
    {
      entries: rows,
      groupingNote: opts.groupingNote ?? null,
      groups: opts.groups.map((g) => ({
        key: g.key,
        label: g.label,
        hours: g.hours,
        revenue: g.revenue,
        budget: g.budget,
      })),
    },
    null,
    2,
  );
}
