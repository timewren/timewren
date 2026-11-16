// src/lib/reports/generators/pdf/EntriesTable.tsx
import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { BRAND_LIGHT as T } from "@/lib/brand/tokens";
import type { ReportEntry } from "../../columns";
import {
  entryColumns,
  formatReportCell,
  REPORT_COLUMNS,
  reportColumnLabel,
} from "../../columns";
import type { ReportColumnKey } from "../../config-schema";

const s = StyleSheet.create({
  table: { marginTop: 10 },
  header: {
    flexDirection: "row",
    backgroundColor: T.flade,
    padding: 5,
    borderBottomWidth: 1,
    borderBottomColor: T.kant,
  },
  headerCell: { fontWeight: 600, fontSize: 8, color: T.blaek },
  row: {
    flexDirection: "row",
    padding: 5,
    borderBottomWidth: 1,
    borderBottomColor: T.streg,
  },
  rowAlt: { backgroundColor: T.flade },
  cell: { fontSize: 8, color: T.blaek },
});

export function EntriesTable({
  entries,
  columns: allColumns,
}: {
  entries: ReportEntry[];
  columns: readonly ReportColumnKey[];
}) {
  // Gruppe-niveau kolonner (budget) hører kun til i fordelings-tabellen
  const columns = entryColumns(allColumns);
  const widthPct = `${Math.floor(100 / Math.max(1, columns.length))}%`;
  return (
    <View style={s.table}>
      <View style={s.header} fixed>
        {columns.map((k) => (
          <Text key={k} style={[s.headerCell, { width: widthPct }]}>
            {reportColumnLabel(k)}
          </Text>
        ))}
      </View>
      {entries.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
        <View key={i} style={[s.row, i % 2 === 1 ? s.rowAlt : {}]} wrap={false}>
          {columns.map((k) => (
            <Text key={k} style={[s.cell, { width: widthPct }]}>
              {formatReportCell(
                REPORT_COLUMNS[k].getValue(e),
                REPORT_COLUMNS[k].format,
              )}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
