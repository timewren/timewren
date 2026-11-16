/**
 * CSV Import utilities for time entries
 * Supports Effihub format auto-detection and manual column mapping
 */
import { toLocalDateStr } from "@/lib/format";

export interface CSVRow {
  [key: string]: string;
}

export interface ParsedTimeEntry {
  date: string;
  hours: number;
  description: string;
  projectName?: string;
  clientName?: string;
  isValid: boolean;
  errors: string[];
}

export interface CSVParseResult {
  headers: string[];
  rows: CSVRow[];
  detectedFormat: "effihub" | "unknown";
  suggestedMapping: ColumnMapping | null;
}

export interface ColumnMapping {
  date: string;
  hours: string;
  description: string;
  projectName?: string;
  clientName?: string;
}

// Known Effihub column headers (Danish)
const EFFIHUB_HEADERS = {
  date: ["Dato", "Date", "dato"],
  hours: ["Timer", "Hours", "timer", "Tid", "tid"],
  description: [
    "Beskrivelse",
    "Description",
    "beskrivelse",
    "Kommentar",
    "kommentar",
  ],
  projectName: ["Projekt", "Project", "projekt"],
  clientName: ["Klient", "Client", "klient", "Kunde", "kunde"],
};

/**
 * Parse CSV content into rows
 */
export function parseCSV(content: string): {
  headers: string[];
  rows: CSVRow[];
} {
  // Detect delimiter (semicolon for Danish CSV, comma otherwise)
  const firstLine = content.split("\n")[0] || "";
  const delimiter = firstLine.includes(";") ? ";" : ",";

  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }

  const headers = parseCSVLine(lines[0], delimiter);
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    if (values.length === headers.length) {
      const row: CSVRow = {};
      headers.forEach((header, index) => {
        row[header] = values[index]?.trim() || "";
      });
      rows.push(row);
    }
  }

  return { headers, rows };
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Detect if CSV is Effihub format and suggest column mapping
 */
export function detectFormat(headers: string[]): {
  format: "effihub" | "unknown";
  mapping: ColumnMapping | null;
} {
  const _normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

  // Check for Effihub-like headers
  const dateCol = headers.find((h) =>
    EFFIHUB_HEADERS.date.some((eh) =>
      h.toLowerCase().includes(eh.toLowerCase()),
    ),
  );
  const hoursCol = headers.find((h) =>
    EFFIHUB_HEADERS.hours.some((eh) =>
      h.toLowerCase().includes(eh.toLowerCase()),
    ),
  );
  const descCol = headers.find((h) =>
    EFFIHUB_HEADERS.description.some((eh) =>
      h.toLowerCase().includes(eh.toLowerCase()),
    ),
  );
  const projectCol = headers.find((h) =>
    EFFIHUB_HEADERS.projectName.some((eh) =>
      h.toLowerCase().includes(eh.toLowerCase()),
    ),
  );
  const clientCol = headers.find((h) =>
    EFFIHUB_HEADERS.clientName.some((eh) =>
      h.toLowerCase().includes(eh.toLowerCase()),
    ),
  );

  // If we found date, hours and description, it's likely Effihub or similar
  if (dateCol && hoursCol && descCol) {
    return {
      format: "effihub",
      mapping: {
        date: dateCol,
        hours: hoursCol,
        description: descCol,
        projectName: projectCol,
        clientName: clientCol,
      },
    };
  }

  return { format: "unknown", mapping: null };
}

/**
 * Parse date string to ISO format
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // Try common formats
  // DD-MM-YYYY (Danish)
  const danishMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (danishMatch) {
    const [, day, month, year] = danishMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // DD/MM/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // YYYY-MM-DD (ISO)
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return dateStr;
  }

  // Try JavaScript Date parsing as fallback
  const parsed = new Date(dateStr);
  if (!Number.isNaN(parsed.getTime())) {
    return toLocalDateStr(parsed);
  }

  return null;
}

/**
 * Parse hours string (handles both "1.5" and "1,5" formats)
 */
function parseHours(hoursStr: string): number | null {
  if (!hoursStr) return null;

  // Replace comma with dot for Danish format
  const normalized = hoursStr.replace(",", ".").trim();
  const hours = parseFloat(normalized);

  if (Number.isNaN(hours) || hours < 0) return null;
  return hours;
}

/**
 * Convert CSV rows to time entry data using column mapping
 */
export function mapRowsToTimeEntries(
  rows: CSVRow[],
  mapping: ColumnMapping,
): ParsedTimeEntry[] {
  return rows.map((row) => {
    const errors: string[] = [];

    // Parse date
    const dateStr = row[mapping.date];
    const parsedDate = parseDate(dateStr);
    if (!parsedDate) {
      errors.push(`Ugyldig dato: "${dateStr}"`);
    }

    // Parse hours
    const hoursStr = row[mapping.hours];
    const parsedHours = parseHours(hoursStr);
    if (parsedHours === null) {
      errors.push(`Ugyldige timer: "${hoursStr}"`);
    }

    // Get description
    const description = row[mapping.description]?.trim() || "";
    if (!description) {
      errors.push("Beskrivelse mangler");
    }

    // Get optional project and client names
    const projectName = mapping.projectName
      ? row[mapping.projectName]?.trim()
      : undefined;
    const clientName = mapping.clientName
      ? row[mapping.clientName]?.trim()
      : undefined;

    return {
      date: parsedDate || "",
      hours: parsedHours || 0,
      description,
      projectName,
      clientName,
      isValid: errors.length === 0,
      errors,
    };
  });
}

/**
 * Full CSV import pipeline
 */
export function processCSVImport(
  content: string,
  customMapping?: ColumnMapping,
): {
  result: CSVParseResult;
  entries: ParsedTimeEntry[];
  validCount: number;
  invalidCount: number;
} {
  const { headers, rows } = parseCSV(content);
  const { format, mapping: autoMapping } = detectFormat(headers);

  const mapping = customMapping || autoMapping;

  const result: CSVParseResult = {
    headers,
    rows,
    detectedFormat: format,
    suggestedMapping: autoMapping,
  };

  if (!mapping) {
    return {
      result,
      entries: [],
      validCount: 0,
      invalidCount: rows.length,
    };
  }

  const entries = mapRowsToTimeEntries(rows, mapping);
  const validCount = entries.filter((e) => e.isValid).length;
  const invalidCount = entries.filter((e) => !e.isValid).length;

  return {
    result,
    entries,
    validCount,
    invalidCount,
  };
}
