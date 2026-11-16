import { parseCSV } from "./csv-parser";
import { parseFlexDate } from "./date-parser";

export interface HarvestEntry {
  client: string;
  project: string;
  description: string;
  notes: string;
  hours: number;
  date: Date;
  isBillable: boolean;
  isBilled: boolean;
  billableRate: number | null;
  externalUrl: string;
}

export function parseHarvestCSV(csvContent: string): HarvestEntry[] {
  const rows = parseCSV(csvContent);
  const entries: HarvestEntry[] = [];

  for (const row of rows) {
    const client = row.Client || "";
    const project = row.Project || "";
    const task = row.Task || "";
    const notes = row.Notes || "";
    const hours = Number.parseFloat((row.Hours || "0").replace(",", "."));
    if (hours === 0) continue;

    // Harvest uses YYYY-MM-DD — unambiguous
    const dateStr = row.Date || "";
    const date = parseFlexDate(dateStr, "YYYY-MM-DD");
    if (!date) continue;

    const billableStr = (row["Billable?"] || "").toLowerCase();
    const isBillable = billableStr === "yes";

    const invoicedStr = (row["Invoiced?"] || "").toLowerCase();
    const isBilled = invoicedStr === "yes";

    let billableRate: number | null = null;
    const rateStr = row["Billable Rate"] || "";
    if (rateStr) {
      const parsed = Number.parseFloat(rateStr.replace(",", "."));
      if (!Number.isNaN(parsed) && parsed > 0) billableRate = parsed;
    }

    const externalUrl = row["External Reference URL"] || "";

    entries.push({
      client,
      project,
      description: task,
      notes,
      hours,
      date,
      isBillable,
      isBilled,
      billableRate,
      externalUrl,
    });
  }

  return entries;
}
