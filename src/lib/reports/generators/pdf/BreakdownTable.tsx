// src/lib/reports/generators/pdf/BreakdownTable.tsx

import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { toIntlLocale } from "@/i18n/format-locale";
import { resolveSharedLocale, sharedT } from "@/i18n/shared-text";
import { BRAND_LIGHT as T } from "@/lib/brand/tokens";
import type { ReportAggregates } from "../../query";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat(toIntlLocale(resolveSharedLocale()), {
    style: "currency",
    currency: "DKK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0
    ? sharedT("sharedReports", "pdf.hoursH", { h: hh })
    : sharedT("sharedReports", "pdf.hoursHM", { h: hh, m: mm });
}

const s = StyleSheet.create({
  table: { marginTop: 10 },
  header: {
    flexDirection: "row",
    backgroundColor: T.flade,
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: T.kant,
  },
  headerCell: { fontWeight: 600, fontSize: 9, color: T.blaek },
  row: {
    flexDirection: "row",
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: T.streg,
  },
  rowAlt: { backgroundColor: T.flade },
  cell: { fontSize: 9, color: T.blaek },
  colName: { width: "40%" },
  colHours: { width: "30%", textAlign: "right" as const },
  colValue: { width: "30%", textAlign: "right" as const },
  // Med budget-kolonne bliver fordelingen 34/18/24/24
  colNameB: { width: "34%" },
  colHoursB: { width: "18%", textAlign: "right" as const },
  colValueB: { width: "24%", textAlign: "right" as const },
  colBudget: { width: "24%", textAlign: "right" as const },
});

const BUDGET_COLORS = {
  green: "#15803d",
  yellow: "#b45309",
  red: "#b91c1c",
} as const;

export function BreakdownTable({
  groups,
  title,
  showBudget = false,
  note = null,
}: {
  groups: ReportAggregates["groups"];
  title: string;
  /** Vis månedsbudget pr. gruppe (#593) */
  showBudget?: boolean;
  /** Fx "Poster med flere tags tælles i hver gruppe …" */
  note?: string | null;
}) {
  const nameStyle = showBudget ? s.colNameB : s.colName;
  const hoursStyle = showBudget ? s.colHoursB : s.colHours;
  const valueStyle = showBudget ? s.colValueB : s.colValue;
  return (
    <View style={s.table}>
      <Text style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        {title}
      </Text>
      {note ? (
        <Text style={{ fontSize: 8, color: T.graa, marginBottom: 4 }}>
          {note}
        </Text>
      ) : null}
      <View style={s.header} fixed>
        <Text style={[s.headerCell, nameStyle]}>
          {sharedT("sharedReports", "pdf.groupHeader")}
        </Text>
        <Text style={[s.headerCell, hoursStyle]}>
          {sharedT("sharedReports", "pdf.hoursHeader")}
        </Text>
        <Text style={[s.headerCell, valueStyle]}>
          {sharedT("sharedReports", "pdf.revenueHeader")}
        </Text>
        {showBudget && (
          <Text style={[s.headerCell, s.colBudget]}>
            {sharedT("sharedReports", "pdf.budgetHeader")}
          </Text>
        )}
      </View>
      {groups.map((g, i) => (
        <View
          key={g.key}
          style={[s.row, i % 2 === 1 ? s.rowAlt : {}]}
          wrap={false}
        >
          <Text style={[s.cell, nameStyle]}>{g.label}</Text>
          <Text style={[s.cell, hoursStyle]}>{formatHours(g.hours)}</Text>
          <Text style={[s.cell, valueStyle]}>{formatCurrency(g.revenue)}</Text>
          {showBudget && (
            <Text
              style={[
                s.cell,
                s.colBudget,
                g.budget ? { color: BUDGET_COLORS[g.budget.healthStatus] } : {},
              ]}
            >
              {g.budget
                ? `${formatHours(g.budget.usedHours)} / ${formatHours(g.budget.budgetHours)} (${g.budget.percentage} %)`
                : "—"}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
