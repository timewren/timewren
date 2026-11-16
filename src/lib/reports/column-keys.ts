// Zod-fri: importeres af klientkomponenter. Selve zod-skemaet bor i
// ./config-schema, som re-eksporterer alt herfra.
import type { ReportTemplateConfig } from "./config-schema";

export const REPORT_COLUMN_KEYS = [
  "date",
  "client",
  "project",
  "task",
  "description",
  "startTime",
  "endTime",
  "hours",
  "roundedHours",
  "rate",
  "value",
  "billed",
  "prepaid",
  "prepaidPackage",
  "tags",
  "member",
  "fromTemplate",
  // Gruppe-niveau kolonne: månedsbudget vs. forbrug pr. projekt. Har ingen
  // værdi pr. tidspost, så den vises kun i gruppe-tabellen og kun når
  // grupperingen er "project" eller "clientProject" (#593).
  "budget",
] as const;

export type ReportColumnKey = (typeof REPORT_COLUMN_KEYS)[number];

/**
 * Budget-kolonnen kræver BÅDE at den er valgt OG at gruppen er et projekt —
 * et tag eller en medarbejder har ikke et månedsbudget. Ét prædikat, så
 * preview, PDF, CSV, XLSX og JSON viser præcis det samme (#593).
 */
export function showsBudgetColumn(config: ReportTemplateConfig): boolean {
  return (
    config.columns.includes("budget") &&
    (config.grouping === "project" || config.grouping === "clientProject")
  );
}
