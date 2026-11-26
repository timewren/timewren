// src/lib/reports/generators/csv.ts

import { sharedT } from "@/i18n/shared-text";
import { withDemoCurrencyUnit } from "@/lib/demo/currency-messages";
import { formatPause } from "@/lib/format";
import { escapeCsv } from "@/lib/utils/spreadsheet";
import type { ReportEntry } from "../columns";
import { entryColumns, REPORT_COLUMNS, reportColumnLabel } from "../columns";
import type { ReportColumnKey } from "../config-schema";
import type { ReportPauses } from "../pauses";
import type { ReportAggregates } from "../query";

const BOM = "\uFEFF";
const DELIM = ";";

export function generateCSV(
  entries: ReportEntry[],
  opts: {
    columns: readonly ReportColumnKey[];
    /**
     * Gruppe-tabel der lægges NEDERST i filen, efter posteringerne. Række 1
     * skal blive ved med at være header-rækken, ellers brækker import-
     * mappings hos modtageren (#593).
     */
    groups?: ReportAggregates["groups"];
    groupingNote?: string | null;
    /** Pause-blok øverst i filen, når rapporten har pauser slået til (#593) */
    pauses?: ReportPauses | null;
  },
): string {
  const cols = entryColumns(opts.columns);
  const header = cols
    .map((k) => {
      const label = reportColumnLabel(k);
      return escapeCell(
        REPORT_COLUMNS[k].format === "currency"
          ? withDemoCurrencyUnit(label)
          : label,
      );
    })
    .join(DELIM);

  const rows = entries.map((e) =>
    cols
      .map((k) => {
        const col = REPORT_COLUMNS[k];
        const value = col.getValue(e);
        const raw = formatValue(value, col.format);
        return escapeCell(raw, col.format);
      })
      .join(DELIM),
  );

  // Ekstra blokke (grupper, pauser) append'es EFTER posteringerne, så
  // header-rækken bliver liggende som række 1 (#593).
  const extraLines: string[] = [];
  if (opts.groups && opts.groups.length > 0) {
    extraLines.push("");
    extraLines.push(
      [
        sharedT("sharedReports", "group"),
        sharedT("sharedReports", "columns.hours"),
        withDemoCurrencyUnit(sharedT("sharedReports", "revenue")),
        sharedT("sharedReports", "monthlyBudget"),
        sharedT("sharedReports", "usedInMonth"),
        sharedT("sharedReports", "usedPct"),
      ]
        .map((h) => escapeCell(h))
        .join(DELIM),
    );
    for (const g of opts.groups) {
      extraLines.push(
        [
          escapeCell(g.label),
          escapeCell(num(g.hours), "time"),
          escapeCell(num(g.revenue), "currency"),
          escapeCell(g.budget ? num(g.budget.budgetHours) : "", "time"),
          escapeCell(g.budget ? num(g.budget.usedHours) : "", "time"),
          escapeCell(g.budget ? String(g.budget.percentage) : "", "number"),
        ].join(DELIM),
      );
    }
    if (opts.groupingNote) {
      extraLines.push(escapeCell(opts.groupingNote));
    }
  }

  if (opts.pauses) {
    const p = opts.pauses;
    extraLines.push("");
    extraLines.push(
      escapeCell(
        sharedT("sharedReports", "pausesSummary", {
          min: p.minGapMinutes,
          total: formatPause(p.totalGapMinutes),
        }),
      ),
    );
    if (p.untimedEntries > 0) {
      extraLines.push(
        escapeCell(
          sharedT("sharedReports", "untimedNote", { count: p.untimedEntries }),
        ),
      );
    }
    extraLines.push(
      [
        sharedT("sharedReports", "columns.date"),
        sharedT("sharedReports", "pauseMinutes"),
      ]
        .map((h) => escapeCell(h))
        .join(DELIM),
    );
    for (const d of p.byDay) {
      extraLines.push(
        [escapeCell(d.date), escapeCell(String(d.gapMinutes), "number")].join(
          DELIM,
        ),
      );
    }
  }

  // Ekstra blokke append'es EFTER posteringerne, så header-rækken bliver
  // liggende som række 1.
  return BOM + [header, ...rows, ...extraLines].join("\n");
}

function num(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

function formatValue(
  value: string | number | boolean,
  format: (typeof REPORT_COLUMNS)[keyof typeof REPORT_COLUMNS]["format"],
): string {
  if (typeof value === "boolean") {
    return sharedT("sharedFormat", value ? "yes" : "no");
  }
  if (format === "currency" || format === "number" || format === "time") {
    return typeof value === "number"
      ? value.toFixed(2).replace(".", ",")
      : String(value);
  }
  return String(value);
}

type ColFormat = (typeof REPORT_COLUMNS)[keyof typeof REPORT_COLUMNS]["format"];

function escapeCell(v: string, format?: ColFormat): string {
  const isNumeric =
    format === "currency" || format === "number" || format === "time";
  return escapeCsv(v, {
    delimiter: DELIM,
    quoteComma: !isNumeric,
    numeric: isNumeric,
  });
}
