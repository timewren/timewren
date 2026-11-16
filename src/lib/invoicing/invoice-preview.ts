/**
 * Forhåndsvisning af en fakturakladde fra ufaktureret tid ("Fakturér nu", #89).
 *
 * Ren gruppering uden DB-adgang: posterne grupperes pr. projekt (poster uden
 * projekt samles i "Direkte tid"), og beløbet er timer × sats — samme
 * regnestykke som `invoices.generateFromTimeEntries` skriver fakturaen med.
 */

export interface PreviewEntry {
  id: string;
  hours: string | number | null;
  billableRate: string | null;
  projectId: string | null;
  projectName: string | null;
  /** Dansk dato "yyyy-MM-dd". */
  date: string;
}

export interface PreviewGroup {
  /** projectId, eller "direct" for poster uden projekt. */
  key: string;
  label: string;
  entryCount: number;
  hours: number;
  amount: number;
  /** Timer uden sats i gruppen (giver 0 kr på fakturaen). */
  hoursWithoutRate: number;
}

export interface InvoicePreview {
  entryIds: string[];
  entryCount: number;
  totalHours: number;
  totalAmount: number;
  hoursWithoutRate: number;
  /** Ældste og nyeste postdato, `null` uden poster. */
  firstDate: string | null;
  lastDate: string | null;
  groups: PreviewGroup[];
}

export const DIRECT_TIME_LABEL = "Direkte tid";

function num(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildInvoicePreview(entries: PreviewEntry[]): InvoicePreview {
  const groups = new Map<string, PreviewGroup>();
  let totalHours = 0;
  let totalAmount = 0;
  let hoursWithoutRate = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  for (const entry of entries) {
    const hours = num(entry.hours);
    const rate = num(entry.billableRate);
    // Afrundet pr. post, som fakturalinjerne.
    const amount = round2(hours * rate);
    const key = entry.projectId ?? "direct";

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: entry.projectId
          ? (entry.projectName ?? "Projekt")
          : DIRECT_TIME_LABEL,
        entryCount: 0,
        hours: 0,
        amount: 0,
        hoursWithoutRate: 0,
      };
      groups.set(key, group);
    }
    group.entryCount++;
    group.hours += hours;
    group.amount += amount;
    if (rate <= 0) {
      group.hoursWithoutRate += hours;
      hoursWithoutRate += hours;
    }

    totalHours += hours;
    totalAmount += amount;
    if (firstDate === null || entry.date < firstDate) firstDate = entry.date;
    if (lastDate === null || entry.date > lastDate) lastDate = entry.date;
  }

  return {
    entryIds: entries.map((e) => e.id),
    entryCount: entries.length,
    totalHours: round2(totalHours),
    totalAmount: round2(totalAmount),
    hoursWithoutRate: round2(hoursWithoutRate),
    firstDate,
    lastDate,
    groups: [...groups.values()]
      .map((g) => ({
        ...g,
        hours: round2(g.hours),
        amount: round2(g.amount),
        hoursWithoutRate: round2(g.hoursWithoutRate),
      }))
      .sort((a, b) => b.amount - a.amount || b.hours - a.hours),
  };
}

export const INVOICE_PREVIEW_PERIODS = [
  "all",
  "this_month",
  "last_month",
] as const;
export type InvoicePreviewPeriod = (typeof INVOICE_PREVIEW_PERIODS)[number];

/**
 * Periodens grænser som danske datoer (inklusiv). "all" = ingen grænser.
 * `today` er dagens danske dato "yyyy-MM-dd".
 */
export function previewPeriodRange(
  period: InvoicePreviewPeriod,
  today: string,
): { from: string | null; to: string | null } {
  if (period === "all") return { from: null, to: null };
  const [y, m] = today.split("-").map(Number);
  if (period === "this_month") {
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  const start = new Date(Date.UTC(y, m - 2, 1));
  const end = new Date(Date.UTC(y, m - 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}
