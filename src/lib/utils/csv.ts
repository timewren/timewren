import { escapeCsv } from "@/lib/utils/spreadsheet";

/**
 * CSV Export Utilities
 * Handles CSV generation and download for TimeTrack reports
 */

/**
 * Escapes a CSV field value, handling commas, quotes, and newlines
 */
function escapeCSVField(
  value: string | number | null | undefined,
  numeric = false,
): string {
  return escapeCsv(value, {
    delimiter: ",",
    numeric: numeric && /^-?\d+(\.\d+)?$/.test(String(value)),
  });
}

/**
 * Converts a 2D array to CSV format
 */
function arrayToCSV(
  data: Array<Array<string | number | null | undefined>>,
  numericColumns: number[],
): string {
  return data
    .map((row, rowIndex) =>
      row
        .map((value, column) =>
          escapeCSVField(
            value,
            rowIndex > 0 && numericColumns.includes(column),
          ),
        )
        .join(","),
    )
    .join("\n");
}

/**
 * Triggers a CSV file download in the browser
 */
function downloadCSV(csv: string, filename: string): void {
  // Add BOM for proper Danish character encoding in Excel
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csv], {
    type: "text/csv;charset=utf-8;",
  });

  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();

  // Clean up
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export time entries to CSV
 */
export function exportTimeEntriesCSV(
  entries: Array<{
    date: string | Date;
    project?: { name: string } | null;
    client?: { name: string } | null;
    description?: string | null;
    hours: string;
    billableRate: string | null;
    isBilled: boolean | null;
  }>,
  startDate: string,
  endDate: string,
): void {
  const headers = [
    "Dato",
    "Projekt",
    "Klient",
    "Beskrivelse",
    "Timer",
    "Timepris",
    "Beløb",
    "Faktureret",
  ];

  const rows = entries.map((entry) => {
    const hours = Number.parseFloat(entry.hours);
    const rate = Number.parseFloat(entry.billableRate || "0");
    const amount = (hours * rate).toFixed(2);

    return [
      new Date(entry.date).toLocaleDateString("da-DK", {
        timeZone: "Europe/Copenhagen",
      }),
      entry.project?.name || "—",
      entry.client?.name || "—",
      entry.description || "—",
      entry.hours,
      entry.billableRate || "0",
      amount,
      entry.isBilled ? "Ja" : "Nej",
    ];
  });

  const csv = arrayToCSV([headers, ...rows], [4, 5, 6]);
  const filename = `timetrack_tidsposteringer_${startDate}_til_${endDate}.csv`;

  downloadCSV(csv, filename);
}

/**
 * Export client revenue breakdown to CSV
 */
export function exportClientBreakdownCSV(
  breakdown: Array<{
    clientId: string;
    clientName: string;
    hours: string;
    revenue: string;
  }>,
  startDate: string,
  endDate: string,
): void {
  const headers = [
    "Klient",
    "Total Timer",
    "Total Omsætning (kr)",
    "Gennemsnit Timepris (kr)",
  ];

  const rows = breakdown.map((item) => {
    const hours = Number.parseFloat(item.hours);
    const revenue = Number.parseFloat(item.revenue);
    const averageRate = hours > 0 ? revenue / hours : 0;

    return [item.clientName, item.hours, item.revenue, averageRate.toFixed(2)];
  });

  // Add total row
  const totalHours = breakdown.reduce(
    (sum, item) => sum + Number.parseFloat(item.hours),
    0,
  );
  const totalRevenue = breakdown.reduce(
    (sum, item) => sum + Number.parseFloat(item.revenue),
    0,
  );
  const overallAverageRate = totalHours > 0 ? totalRevenue / totalHours : 0;

  rows.push([
    "TOTAL",
    totalHours.toFixed(2),
    totalRevenue.toFixed(2),
    overallAverageRate.toFixed(2),
  ]);

  const csv = arrayToCSV([headers, ...rows], [1, 2, 3]);
  const filename = `timetrack_klienter_${startDate}_til_${endDate}.csv`;

  downloadCSV(csv, filename);
}

/**
 * Export project revenue breakdown to CSV
 */
export function exportProjectBreakdownCSV(
  breakdown: Array<{
    projectId: string;
    projectName: string;
    clientName: string;
    hours: string;
    revenue: string;
  }>,
  startDate: string,
  endDate: string,
): void {
  const headers = [
    "Projekt",
    "Klient",
    "Total Timer",
    "Total Omsætning (kr)",
    "Gennemsnit Timepris (kr)",
  ];

  const rows = breakdown.map((item) => {
    const hours = Number.parseFloat(item.hours);
    const revenue = Number.parseFloat(item.revenue);
    const averageRate = hours > 0 ? revenue / hours : 0;

    return [
      item.projectName,
      item.clientName,
      item.hours,
      item.revenue,
      averageRate.toFixed(2),
    ];
  });

  // Add total row
  const totalHours = breakdown.reduce(
    (sum, item) => sum + Number.parseFloat(item.hours),
    0,
  );
  const totalRevenue = breakdown.reduce(
    (sum, item) => sum + Number.parseFloat(item.revenue),
    0,
  );
  const overallAverageRate = totalHours > 0 ? totalRevenue / totalHours : 0;

  rows.push([
    "TOTAL",
    "—",
    totalHours.toFixed(2),
    totalRevenue.toFixed(2),
    overallAverageRate.toFixed(2),
  ]);

  const csv = arrayToCSV([headers, ...rows], [2, 3, 4]);
  const filename = `timetrack_projekter_${startDate}_til_${endDate}.csv`;

  downloadCSV(csv, filename);
}
