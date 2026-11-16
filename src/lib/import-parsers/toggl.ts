import { parseCSV } from "./csv-parser";
import {
  type DateFormat,
  parseDuration,
  parseFlexDate,
  parseTimeOfDay,
} from "./date-parser";

export interface TogglEntry {
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

export function parseTogglCSV(
  csvContent: string,
  dateFormat: DateFormat,
): TogglEntry[] {
  const rows = parseCSV(csvContent);
  const entries: TogglEntry[] = [];

  for (const row of rows) {
    const client = row.Client || "";
    const project = row.Project || "";
    const description = row.Description || "";
    const task = row.Task || "";
    const tags = row.Tags || "";

    // Toggl has a single "Duration" column (HH:MM:SS or decimal)
    const durationStr = row.Duration || "";
    const hours = parseDuration(durationStr);
    if (hours === 0) continue;

    // Toggl uses "Start date" (lowercase 'd')
    const dateStr = row["Start date"] || row["Start Date"] || "";
    const date = parseFlexDate(dateStr, dateFormat);
    if (!date) continue;

    // Parse start/end times
    const startTimeStr = row["Start time"] || row["Start Time"] || "";
    const endTimeStr = row["End time"] || row["End Time"] || "";
    let startTime: Date | null = null;
    let endTime: Date | null = null;

    const startTod = parseTimeOfDay(startTimeStr);
    if (startTod) {
      startTime = new Date(date);
      startTime.setHours(startTod.hours, startTod.minutes, startTod.seconds);
    }

    const endDateStr = row["End date"] || row["End Date"] || dateStr;
    const endDate = parseFlexDate(endDateStr, dateFormat) || date;
    const endTod = parseTimeOfDay(endTimeStr);
    if (endTod) {
      endTime = new Date(endDate);
      endTime.setHours(endTod.hours, endTod.minutes, endTod.seconds);
    }

    // Billable
    const billableStr = (row.Billable || "").toLowerCase();
    const isBillable = billableStr === "yes";

    // Rate — "Amount (XXX)" column, need to compute rate = amount / hours
    let billableRate: number | null = null;
    const amountKey = Object.keys(row).find((k) =>
      k.toLowerCase().startsWith("amount"),
    );
    if (amountKey && row[amountKey]) {
      const amount = Number.parseFloat(row[amountKey].replace(",", "."));
      if (!Number.isNaN(amount) && amount > 0 && hours > 0) {
        billableRate = amount / hours;
      }
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
