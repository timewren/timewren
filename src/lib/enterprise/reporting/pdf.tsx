/**
 * PDF for enterprise-rapporter (E4, #462) — samme tabel som CSV/XLSX, rendret
 * server-side med @react-pdf/renderer (som cron'en for freelance-rapporter).
 * Schibsted Grotesk er indlejret (lib/pdf/fonts), så der ikke hentes fonte
 * over nettet i cron.
 */
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { sharedT } from "@/i18n/shared-text";
import { BRAND_LIGHT as T } from "@/lib/brand/tokens";
import { TT_IKON_PNG_DATA_URI } from "@/lib/pdf/brand-icon";
import { registerPdfFonts } from "@/lib/pdf/react-pdf-fonts";
import { formatCellValue } from "./columns";
import type { ReportTable } from "./render";

const FONT = registerPdfFonts();

const s = StyleSheet.create({
  page: {
    padding: 32,
    fontFamily: FONT,
    fontSize: 8,
    color: T.blaek,
  },
  title: { fontSize: 16, fontWeight: 700 },
  meta: { fontSize: 9, color: T.graa, marginTop: 4, marginBottom: 12 },
  header: {
    flexDirection: "row",
    backgroundColor: T.flade,
    padding: 4,
    borderBottomWidth: 1,
    borderBottomColor: T.kant,
  },
  headerCell: { fontWeight: 700, fontSize: 7, color: T.blaek },
  row: {
    flexDirection: "row",
    padding: 4,
    borderBottomWidth: 1,
    borderBottomColor: T.streg,
  },
  rowAlt: { backgroundColor: T.flade },
  subtotal: { backgroundColor: T.granLys, fontWeight: 700 },
  total: {
    backgroundColor: T.streg,
    fontWeight: 700,
    borderTopWidth: 1,
    borderTopColor: T.kant,
  },
  cell: { fontSize: 7, color: T.blaek, paddingRight: 3 },
  num: { textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: T.graa,
  },
  generatedBy: { flexDirection: "row", alignItems: "center", gap: 4 },
  generatedIcon: { width: 8, height: 8 },
});

export function EnterpriseReportPDF(props: {
  title: string;
  orgName: string;
  period: string;
  table: ReportTable;
}) {
  const { title, orgName, period, table } = props;
  const cols = table.columns;
  const landscape = cols.length > 7;
  const widthPct = `${Math.floor(100 / Math.max(1, cols.length))}%`;
  const isNumeric = (i: number) => {
    const f = cols[i].format;
    return f !== "text" && f !== "boolean";
  };

  const renderRow = (
    cells: ReportTable["totals"],
    key: string,
    style: (typeof s)[keyof typeof s] | Record<string, never>,
  ) => (
    <View key={key} style={[s.row, style]} wrap={false}>
      {cells.map((v, i) => (
        <Text
          key={cols[i].id}
          style={[s.cell, { width: widthPct }, isNumeric(i) ? s.num : {}]}
        >
          {formatCellValue(v, cols[i].format)}
        </Text>
      ))}
    </View>
  );

  return (
    <Document title={title} author={orgName}>
      <Page
        size="A4"
        orientation={landscape ? "landscape" : "portrait"}
        style={s.page}
      >
        <Text style={s.title}>{title}</Text>
        <Text style={s.meta}>
          {orgName
            ? sharedT("sharedReports", "enterprise.periodWithOrg", {
                org: orgName,
                period,
              })
            : sharedT("sharedReports", "enterprise.periodOnly", { period })}
        </Text>
        <View style={s.header} fixed>
          {cols.map((c, i) => (
            <Text
              key={c.id}
              style={[
                s.headerCell,
                { width: widthPct },
                isNumeric(i) ? s.num : {},
              ]}
            >
              {c.label}
            </Text>
          ))}
        </View>
        {table.rows.map((r, i) =>
          renderRow(
            r.cells,
            String(i),
            r.subtotal ? s.subtotal : i % 2 === 1 ? s.rowAlt : {},
          ),
        )}
        {renderRow(table.totals, "total", s.total)}
        <View style={s.footer} fixed>
          <View style={s.generatedBy}>
            <Image src={TT_IKON_PNG_DATA_URI} style={s.generatedIcon} />
            <Text>{sharedT("sharedReports", "pdf.generatedBy")}</Text>
          </View>
          <Text
            render={({ pageNumber, totalPages }) =>
              sharedT("sharedReports", "pdf.page", {
                page: pageNumber,
                total: totalPages,
              })
            }
          />
        </View>
      </Page>
    </Document>
  );
}
