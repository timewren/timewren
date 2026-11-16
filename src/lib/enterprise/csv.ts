import { escapeCsv } from "@/lib/utils/spreadsheet";
/**
 * CSV-helpers til løn-eksport. Dansk Excel-venligt format:
 * semikolon-separator, decimalkomma, CRLF og UTF-8 BOM.
 */

export function csvEscape(value: string): string {
  return escapeCsv(value);
}

export function csvNumber(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function buildCsv(
  headers: string[],
  rows: Array<Array<string | number>>,
): string {
  const lines = [
    headers.map(csvEscape).join(";"),
    ...rows.map((row) =>
      row
        .map((cell) =>
          typeof cell === "number" ? csvNumber(cell) : csvEscape(cell),
        )
        .join(";"),
    ),
  ];
  // BOM så Excel læser æøå korrekt
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
