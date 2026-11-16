import { parseCSV } from "./csv-parser";
import {
  type DateFormat,
  parseDuration,
  parseFlexDate,
  parseTimeOfDay,
} from "./date-parser";

export interface ClockifyEntry {
  client: string;
  project: string;
  description: string;
  task: string;
  tags: string;
  hours: number;
  date: Date;
  startTime: Date | null;
  endTime: Date | null;
  isBillable: boolean;
  billableRate: number | null;
}

export function parseClockifyCSV(
  csvContent: string,
  dateFormat: DateFormat,
): ClockifyEntry[] {
  const rows = parseCSV(csvContent);
  const entries: ClockifyEntry[] = [];

  for (const row of rows) {
    const client = row.Client || "";
    const project = row.Project || "";
    const description = row.Description || "";
    const task = row.Task || "";
    const tags = row.Tags || "";

    // Prefer "Duration (decimal)" if available, otherwise "Duration (h)"
    const durationDecimal = row["Duration (decimal)"];
    const durationH = row["Duration (h)"] || row.Duration || "";
    const hours = durationDecimal
      ? Number.parseFloat(durationDecimal.replace(",", ".")) || 0
      : parseDuration(durationH);

    if (hours === 0) continue;

    // Parse date
    const dateStr = row["Start Date"] || "";
    const date = parseFlexDate(dateStr, dateFormat);
    if (!date) continue;

    // Parse start/end times
    const startTimeStr = row["Start Time"] || "";
    const endTimeStr = row["End Time"] || "";
    let startTime: Date | null = null;
    let endTime: Date | null = null;

    const startTod = parseTimeOfDay(startTimeStr);
    if (startTod) {
      startTime = new Date(date);
      startTime.setHours(startTod.hours, startTod.minutes, startTod.seconds);
    }

    const endDateStr = row["End Date"] || dateStr;
    const endDate = parseFlexDate(endDateStr, dateFormat) || date;
    const endTod = parseTimeOfDay(endTimeStr);
    if (endTod) {
      endTime = new Date(endDate);
      endTime.setHours(endTod.hours, endTod.minutes, endTod.seconds);
    }

    // Billable
    const billableStr = (row.Billable || "").toLowerCase();
    const isBillable = billableStr === "yes";

    // Rate — column header contains currency, e.g. "Billable Rate (DKK)"
    let billableRate: number | null = null;
    const rateKey = Object.keys(row).find((k) =>
      k.toLowerCase().startsWith("billable rate"),
    );
    if (rateKey && row[rateKey]) {
      const parsed = Number.parseFloat(row[rateKey].replace(",", "."));
      if (!Number.isNaN(parsed) && parsed > 0) billableRate = parsed;
    }

    entries.push({
      client,
      project,
      description,
      task,
      tags,
      hours,
      date,
      startTime,
      endTime,
      isBillable,
      billableRate,
    });
  }

  return entries;
}
