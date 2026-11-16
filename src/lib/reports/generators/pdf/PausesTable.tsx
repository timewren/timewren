// src/lib/reports/generators/pdf/PausesTable.tsx
import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { sharedT } from "@/i18n/shared-text";
import { BRAND_LIGHT as T } from "@/lib/brand/tokens";
import { formatPause } from "@/lib/format";
import type { ReportPauses } from "../../pauses";

const s = StyleSheet.create({
  table: { marginTop: 10 },
  note: { fontSize: 8, color: T.graa, marginBottom: 4 },
  total: { fontSize: 10, fontWeight: 600, marginBottom: 6 },
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
  colLabel: { width: "60%" },
  colValue: { width: "40%", textAlign: "right" as const },
});

/**
 * Pauser pr. dag (#593). Viser kun huller på mindst `minGapMinutes`, og siger
 * eksplicit hvor mange registreringer der ikke kunne indgå.
 */
export function PausesTable({ pauses }: { pauses: ReportPauses }) {
  return (
    <View style={s.table}>
      <Text style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        {sharedT("sharedReports", "pdf.pausesTitle")}
      </Text>
      <Text style={s.note}>
        {sharedT("sharedReports", "pdf.pausesNote", {
          min: pauses.minGapMinutes,
        })}
        {pauses.untimedEntries > 0
          ? ` ${sharedT("sharedReports", "pdf.untimedPdf", { count: pauses.untimedEntries })}`
          : ""}
      </Text>
      <Text style={s.total}>
        {sharedT("sharedReports", "pdf.pausesTotal", {
          total: formatPause(pauses.totalGapMinutes),
        })}
      </Text>
      {pauses.byDay.length > 0 && (
        <>
          <View style={s.header} fixed>
            <Text style={[s.headerCell, s.colLabel]}>
              {sharedT("sharedReports", "pdf.dateHeader")}
            </Text>
            <Text style={[s.headerCell, s.colValue]}>
              {sharedT("sharedReports", "pdf.pauseHeader")}
            </Text>
          </View>
          {pauses.byDay.map((d, i) => (
            <View
              key={d.date}
              style={[s.row, i % 2 === 1 ? s.rowAlt : {}]}
              wrap={false}
            >
              <Text style={[s.cell, s.colLabel]}>{d.date}</Text>
              <Text style={[s.cell, s.colValue]}>
                {formatPause(d.gapMinutes)}
              </Text>
            </View>
          ))}
        </>
      )}
      {pauses.byUser.length > 1 && (
        <>
          <View style={[s.header, { marginTop: 8 }]}>
            <Text style={[s.headerCell, s.colLabel]}>
              {sharedT("sharedReports", "pdf.employeeHeader")}
            </Text>
            <Text style={[s.headerCell, s.colValue]}>
              {sharedT("sharedReports", "pdf.pauseHeader")}
            </Text>
          </View>
          {pauses.byUser.map((u, i) => (
            <View
              key={u.userId}
              style={[s.row, i % 2 === 1 ? s.rowAlt : {}]}
              wrap={false}
            >
              <Text style={[s.cell, s.colLabel]}>{u.name}</Text>
              <Text style={[s.cell, s.colValue]}>
                {formatPause(u.gapMinutes)}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}
