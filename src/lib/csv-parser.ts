/**
 * CSV Parser for Effihub exports
 * Handles semicolon-delimited CSV files with Danish encoding
 */

/**
 * Parse Effihub CSV text into array of objects
 * Handles semicolon delimiter and quoted fields
 */
export function parseEffihubCSV(
  csvText: string,
): Array<Record<string, string>> {
  // Remove BOM if present
  const cleanText = csvText.replace(/^\uFEFF/, "");

  const lines = cleanText.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return [];

  // Parse header row
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line with semicolon delimiter and quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quotes
        inQuotes = !inQuotes;
      }
    } else if (char === ";" && !inQuotes) {
      // Field separator
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  // Add last field
  result.push(current.trim());

  return result;
}

/**
 * Convert Effihub time format to decimal hours
 * Supports HH:MM:SS (Stopur/Projekt) and HH:MM (Timeseddel) formats
 * Example: "01:30:00" => 1.5, "00:12" => 0.2
 */
export function convertTimeToDecimal(timeString: string): number {
  if (!timeString || timeString === "---") return 0;

  const parts = timeString.split(":");
  if (parts.length === 2) {
    // HH:MM format (Timeseddel)
    const hours = Number.parseInt(parts[0], 10) || 0;
    const minutes = Number.parseInt(parts[1], 10) || 0;
    return hours + minutes / 60;
  }
  if (parts.length === 3) {
    // HH:MM:SS format (Stopur/Projekt)
    const hours = Number.parseInt(parts[0], 10) || 0;
    const minutes = Number.parseInt(parts[1], 10) || 0;
    const seconds = Number.parseInt(parts[2], 10) || 0;
    return hours + minutes / 60 + seconds / 3600;
  }
  return 0;
}

/**
 * Convert Effihub clips to hours
 * Example: 90 clips × 30 minutes = 45 hours
 */
export function convertClipsToHours(
  clips: number,
  clipValue: number,
  clipUnit: string,
): number {
  if (!clips || !clipValue) return 0;

  const normalizedUnit = clipUnit.toLowerCase();

  if (normalizedUnit === "minutter" || normalizedUnit === "minutes") {
    return (clips * clipValue) / 60;
  }

  if (normalizedUnit === "timer" || normalizedUnit === "hours") {
    return clips * clipValue;
  }

  // Default to hours if unit is unknown
  return clips * clipValue;
}

/**
 * Parse Danish date format (DD.MM.YYYY) to Date object
 * Example: "29.01.2027" => Date(2027, 0, 29)
 * Validates day/month ranges to prevent invalid dates
 */
export function parseDanishDate(dateString: string): Date | null {
  if (!dateString || dateString === "---") return null;

  const parts = dateString.split(".");
  if (parts.length !== 3) return null;

  const day = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10); // 1-indexed in input
  const year = Number.parseInt(parts[2], 10);

  // Validate parsed values
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    return null;
  }

  // Validate ranges
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;

  // Create date and verify it's valid (handles edge cases like Feb 30)
  const date = new Date(year, month - 1, day); // JS months are 0-indexed

  // Verify the date components match (catches invalid dates like Feb 30)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Convert Danish number format to decimal
 * Example: "22.500" => 22500
 */
export function parseDanishNumber(numberString: string): number {
  if (!numberString || numberString === "---") return 0;

  // Remove thousand separators (dots) and convert comma to decimal point
  const cleaned = numberString.replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(cleaned) || 0;
}

/**
 * Sanitize string for database (trim, handle empty values)
 */
export function sanitizeString(value: string | null | undefined): string {
  if (!value || value === "---") return "";
  return value.trim();
}

/**
 * Strip HTML tags from Effihub "Opgave detaljer" field
 * Converts common HTML entities and removes all tags
 */
export function stripHtmlTags(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
