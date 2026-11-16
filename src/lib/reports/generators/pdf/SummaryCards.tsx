// src/lib/reports/generators/pdf/SummaryCards.tsx

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
  if (hh === 0) return sharedT("sharedReports", "pdf.hoursM", { m: mm });
  if (mm === 0) return sharedT("sharedReports", "pdf.hoursH", { h: hh });
  return sharedT("sharedReports", "pdf.hoursHM", { h: hh, m: mm });
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    width: "23%",
    padding: 10,
    backgroundColor: T.flade,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: T.streg,
  },
  label: { fontSize: 9, color: T.graa, marginBottom: 4 },
  value: { fontSize: 14, fontWeight: 700, color: T.blaek },
});

export function SummaryCards({
  summary,
}: {
  summary: ReportAggregates["summary"];
}) {
  return (
    <View style={s.grid}>
      <View style={s.card}>
        <Text style={s.label}>
          {sharedT("sharedReports", "pdf.totalHours")}
        </Text>
        <Text style={s.value}>{formatHours(summary.totalHours)}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>
          {sharedT("sharedReports", "pdf.totalRevenue")}
        </Text>
        <Text style={s.value}>{formatCurrency(summary.totalRevenue)}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>{sharedT("sharedReports", "pdf.unbilled")}</Text>
        <Text style={s.value}>{formatHours(summary.unbilledHours)}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>
          {sharedT("sharedReports", "pdf.unbilledValue")}
        </Text>
        <Text style={s.value}>{formatCurrency(summary.unbilledRevenue)}</Text>
      </View>
    </View>
  );
}
