// src/lib/reports/columns.ts
import { toIntlLocale } from "@/i18n/format-locale";
import { resolveSharedLocale, sharedT } from "@/i18n/shared-text";
import { withDemoCurrency } from "@/lib/demo/currency-messages";
import { toLocalDateStr } from "@/lib/format";
import type { ReportColumnKey } from "./config-schema";

export interface ReportEntry {
  /** Tidspostens id — nødvendig for at koble segmenter på (#593 pauser) */
  id: string;
  date: Date;
  startTime: Date | null;
  endTime: Date | null;
  hours: string;
  billableRate: string | null;
  description: string | null;
  isBilled: boolean;
  /** `null` = gammel række fra før kolonnen fik default `true` (#623) */
  isBillable: boolean | null;
  isPrepaid: boolean;
  /**
   * `defaultBillable` på postens RESOLVEREDE kunde (egen klient, ellers
   * projektets) — `null` når posten ingen kunde har. Bruges af den fælles
   * "ufaktureret"-definition (#626).
   */
  clientDefaultBillable: boolean | null;
  isFromTemplate: boolean;
  /** "manual" | "timer" | "import" | … — gap-kernen skelner på den */
  source: string | null;
  approvalStatus: string | null;
  /** Timer-segmenter, når posten har dem (#593 pauser) */
  segments: Array<{
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
  }>;
  _rounded: number;
  _value: number;
  client: { id: string; name: string } | null;
  project: {
    id: string;
    name: string;
    client: { id: string; name: string } | null;
    /** Timebudget pr. kalendermåned — null når projektet ikke har et (#593) */
    monthlyBudgetHours: number | null;
  } | null;
  prepaidPackage: { id: string; name: string } | null;
  tags: Array<{ id: string; name: string }>;
  task: { id: string; title: string } | null;
  member: { userId: string; name: string } | null;
}

export interface ColumnDef {
  label: string;
  getValue: (entry: ReportEntry) => string | number | boolean;
  format: "text" | "number" | "currency" | "date" | "time" | "boolean";
}

/**
 * Celleværdi til visning (rapportens forhåndsvisning og PDF). Eksportfilerne
 * (CSV/XLSX/JSON) bruger stadig de rå værdier, så regneark kan regne på dem.
 * Dato som "15.03.2026" og decimalkomma, jf. BRAND.md → Tal, priser og tid.
 */
export function formatReportCell(
  value: string | number | boolean,
  format: ColumnDef["format"],
  locale?: string | null,
): string {
  if (typeof value === "boolean") {
    return sharedT("sharedFormat", value ? "yes" : "no", undefined, locale);
  }
  if (format === "date" && typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
  }
  if (typeof value === "number") {
    const n = value.toLocaleString(toIntlLocale(resolveSharedLocale(locale)), {
      maximumFractionDigits: 2,
    });
    return format === "currency"
      ? `${n}${withDemoCurrency(sharedT("sharedLabels", "report.currencySuffix", undefined, locale))}`
      : n;
  }
  return value;
}

/** Nøgletal i timer med én decimal: "29,5 t". */
export function formatReportHours(
  hours: number,
  locale?: string | null,
): string {
  const n = hours.toLocaleString(toIntlLocale(resolveSharedLocale(locale)), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${n}${sharedT("sharedLabels", "report.hoursSuffix", undefined, locale)}`;
}

/** Kolonneoverskrift på kaldets sprog (`REPORT_COLUMNS[k].label` er den danske standard). */
export function reportColumnLabel(
  key: ReportColumnKey,
  locale?: string | null,
): string {
  return sharedT("sharedReports", `columns.${key}`, undefined, locale);
}

/** Lokal HH:mm — tom streng når tidspunktet mangler (manuelle entries). */
function toLocalTimeStr(d: Date | null): string {
  if (!d) return "";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export const REPORT_COLUMNS: Record<ReportColumnKey, ColumnDef> = {
  date: {
    label: "Dato",
    getValue: (e) => toLocalDateStr(e.date),
    format: "date",
  },
  client: {
    label: "Kunde",
    getValue: (e) => e.client?.name ?? e.project?.client?.name ?? "",
    format: "text",
  },
  project: {
    label: "Projekt",
    getValue: (e) => e.project?.name ?? "",
    format: "text",
  },
  task: {
    label: "Opgave",
    getValue: (e) => e.task?.title ?? "",
    format: "text",
  },
  description: {
    label: "Beskrivelse",
    getValue: (e) => e.description ?? "",
    format: "text",
  },
  startTime: {
    label: "Starttid",
    getValue: (e) => toLocalTimeStr(e.startTime),
    format: "text",
  },
  endTime: {
    label: "Sluttid",
    getValue: (e) => toLocalTimeStr(e.endTime),
    format: "text",
  },
  hours: {
    label: "Timer",
    getValue: (e) => Number.parseFloat(e.hours),
    format: "time",
  },
  roundedHours: {
    label: "Timer (afrundet)",
    getValue: (e) => e._rounded,
    format: "time",
  },
  rate: {
    label: "Timepris",
    getValue: (e) => Number.parseFloat(e.billableRate ?? "0"),
    format: "currency",
  },
  value: {
    label: "Værdi",
    getValue: (e) => e._value,
    format: "currency",
  },
  billed: {
    label: "Faktureret",
    getValue: (e) => e.isBilled,
    format: "boolean",
  },
  prepaid: {
    label: "Klippekort",
    getValue: (e) => e.isPrepaid,
    format: "boolean",
  },
  prepaidPackage: {
    label: "Klippekort Navn",
    getValue: (e) => e.prepaidPackage?.name ?? "",
    format: "text",
  },
  tags: {
    label: "Tags",
    getValue: (e) => e.tags.map((t) => t.name).join(", "),
    format: "text",
  },
  member: {
    label: "Medarbejder",
    getValue: (e) => e.member?.name ?? "",
    format: "text",
  },
  fromTemplate: {
    label: "Fra Skabelon",
    getValue: (e) => e.isFromTemplate,
    format: "boolean",
  },
  // Gruppe-niveau: beregnes i aggregateReport og vises i gruppe-tabellen.
  // Tomt pr. tidspost — kolonnen filtreres fra detaljetabellen af
  // entryColumns() nedenfor.
  budget: {
    label: "Budget (måned)",
    getValue: () => "",
    format: "text",
  },
};

/** Gruppe-niveau kolonner der ikke hører hjemme i detaljetabellen. */
const GROUP_LEVEL_COLUMNS = new Set<ReportColumnKey>(["budget"]);

export function isGroupLevelColumn(key: ReportColumnKey): boolean {
  return GROUP_LEVEL_COLUMNS.has(key);
}

/** Kolonnerne der kan vises pr. tidspost (alt undtagen gruppe-niveau). */
export function entryColumns(
  columns: readonly ReportColumnKey[],
): ReportColumnKey[] {
  return columns.filter((k) => !GROUP_LEVEL_COLUMNS.has(k));
}
