import { z } from "zod";
import { convertToCSV } from "@/lib/utils/csv-export";
import { sanitizeForSpreadsheet } from "@/lib/utils/spreadsheet";

export const recordsInput = z.object({
  year: z.number().int().min(1900).max(9998),
  month: z.number().int().min(1).max(12).optional(),
  offset: z.number().int().min(0).default(0),
});

export interface PersonalRecord {
  id: string;
  date: Date;
  description: string | null;
  hours: string;
}

export function recordsCSV(entries: PersonalRecord[]) {
  const rows = entries.map((entry) => ({
    date: entry.date.toISOString().slice(0, 10).split("-").reverse().join("."),
    description:
      entry.description == null
        ? entry.description
        : sanitizeForSpreadsheet(entry.description),
    hours: Number(entry.hours),
  }));
  return rows.length
    ? convertToCSV(rows, [
        { key: "date", header: "Dato" },
        { key: "description", header: "Beskrivelse" },
        { key: "hours", header: "Timer", format: "number" },
      ])
    : "Dato;Beskrivelse;Timer";
}

export async function collectRecords(
  fetchPage: (
    offset: number,
  ) => Promise<{ entries: PersonalRecord[]; nextOffset: number | null }>,
) {
  const entries: PersonalRecord[] = [];
  let offset: number | null = 0;
  do {
    const page = await fetchPage(offset);
    entries.push(...page.entries);
    offset = page.nextOffset;
  } while (offset !== null);
  return entries;
}
