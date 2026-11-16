// src/lib/reports/generators/pdf/ReportPDF.tsx
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { toIntlLocale } from "@/i18n/format-locale";
import { resolveSharedLocale, sharedT } from "@/i18n/shared-text";
import { BRAND_LIGHT } from "@/lib/brand/tokens";
import { TT_IKON_PNG_DATA_URI } from "@/lib/pdf/brand-icon";
import { registerPdfFonts } from "@/lib/pdf/react-pdf-fonts";
import type { ReportEntry } from "../../columns";
import {
  type ReportTemplateConfig,
  showsBudgetColumn,
} from "../../config-schema";
import type { ReportAggregates } from "../../query";
import { BreakdownTable } from "./BreakdownTable";
import { EntriesTable } from "./EntriesTable";
import { PausesTable } from "./PausesTable";
import { SummaryCards } from "./SummaryCards";

// Schibsted Grotesk indlejret; tidligere hentet fra fonts.gstatic.com, hvor
// URL'erne nu giver 404.
const FONT = registerPdfFonts();
const T = BRAND_LIGHT;

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: FONT, fontSize: 10, color: T.blaek },
  header: { marginBottom: 20, paddingBottom: 15, borderBottomWidth: 2 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 22, fontWeight: 700 },
  logo: { width: 80, height: 40, objectFit: "contain" as const },
  periodText: { fontSize: 11, color: T.blaek, marginTop: 6 },
  intro: { fontSize: 10, color: T.blaek, marginTop: 10 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: T.graa,
    borderTopWidth: 1,
    borderTopColor: T.streg,
    paddingTop: 8,
  },
  section: { marginTop: 15 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: T.streg,
  },
  generatedBy: { flexDirection: "row", alignItems: "center", gap: 4 },
  generatedIcon: { width: 9, height: 9 },
});

const GROUPING_KEYS: Record<string, string> = {
  client: "pdf.byClient",
  project: "pdf.byProject",
  clientProject: "pdf.byClientProject",
  tag: "pdf.byTag",
};

export interface ReportPDFProps {
  config: ReportTemplateConfig;
  aggregates: ReportAggregates;
  entries: ReportEntry[];
  startDate: string;
  endDate: string;
  logoUrl: string | null;
  companyName: string;
}

export function ReportPDF({
  config,
  aggregates,
  entries,
  startDate,
  endDate,
  logoUrl,
  companyName,
}: ReportPDFProps) {
  const { branding } = config;
  const now = new Date().toLocaleString(toIntlLocale(resolveSharedLocale()), {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View
          style={[styles.header, { borderBottomColor: branding.primaryColor }]}
        >
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>{branding.title}</Text>
              <Text style={{ fontSize: 11, color: T.graa }}>{companyName}</Text>
            </View>
            {branding.showLogo && logoUrl ? (
              <Image src={logoUrl} style={styles.logo} />
            ) : null}
          </View>
          <Text style={styles.periodText}>
            {sharedT("sharedReports", "pdf.period", {
              start: startDate,
              end: endDate,
            })}
          </Text>
          <Text style={{ fontSize: 9, color: T.graa, marginTop: 2 }}>
            {sharedT("sharedReports", "pdf.generated", { when: now })}
          </Text>
          {branding.introText ? (
            <Text style={styles.intro}>{branding.introText}</Text>
          ) : null}
        </View>

        {branding.showSummaryCards && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {sharedT("sharedReports", "pdf.overview")}
            </Text>
            <SummaryCards summary={aggregates.summary} />
          </View>
        )}

        {(branding.showClientBreakdown || branding.showProjectBreakdown) &&
          aggregates.groups.length > 0 && (
            <View style={styles.section}>
              <BreakdownTable
                groups={aggregates.groups}
                showBudget={showsBudgetColumn(config)}
                note={aggregates.groupingNote}
                title={sharedT("sharedReports", "pdf.breakdownBy", {
                  by: sharedT(
                    "sharedReports",
                    GROUPING_KEYS[config.grouping] ?? "pdf.byGroup",
                  ),
                })}
              />
            </View>
          )}

        {branding.showPauses && aggregates.pauses && (
          <View style={styles.section}>
            <PausesTable pauses={aggregates.pauses} />
          </View>
        )}

        {branding.showEntriesTable && entries.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {sharedT("sharedReports", "pdf.entriesTitle", {
                count: aggregates.summary.entriesCount,
              })}
            </Text>
            <EntriesTable entries={entries} columns={config.columns} />
          </View>
        )}

        <View style={styles.footer} fixed>
          {branding.footerText ? (
            <Text>{branding.footerText}</Text>
          ) : (
            <View style={styles.generatedBy}>
              <Image src={TT_IKON_PNG_DATA_URI} style={styles.generatedIcon} />
              <Text>{sharedT("sharedReports", "pdf.generatedBy")}</Text>
            </View>
          )}
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
