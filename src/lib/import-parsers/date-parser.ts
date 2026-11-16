/**
 * Flexible date parser with auto-detection for imported CSV data.
 * Handles Clockify/Toggl/Harvest date formats.
 */

export type DateFormat =
  | "YYYY-MM-DD"
  | "MM/DD/YYYY"
  | "DD/MM/YYYY"
  | "DD.MM.YYYY"
  | "M/D/YYYY";

/**
 * Try to auto-detect the date format from sample date strings.
 * Returns "ambiguous" if unable to determine.
 */
export function detectDateFormat(samples: string[]): DateFormat | "ambiguous" {
  const validSamples = samples.map((s) => s.trim()).filter((s) => s.length > 0);
  if (validSamples.length === 0) return "ambiguous";

  // Check first sample for structure
  const sample = validSamples[0];

  // YYYY-MM-DD: starts with 4-digit year → unambiguous
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(sample)) {
    return "YYYY-MM-DD";
  }

  // DD.MM.YYYY: dot separator = European convention → unambiguous
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(sample)) {
    return "DD.MM.YYYY";
  }

  // Slash-separated: need to disambiguate MM/DD/YYYY vs DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sample)) {
    // Check all samples for a day component > 12 which would disambiguate
    for (const s of validSamples) {
      const parts = s.split("/");
      const first = Number.parseInt(parts[0], 10);
      const second = Number.parseInt(parts[1], 10);

      // If first part > 12, it must be the day → DD/MM/YYYY
      if (first > 12) return "DD/MM/YYYY";
      // If second part > 12, it must be the day → MM/DD/YYYY
      if (second > 12) return "MM/DD/YYYY";
    }

    // All values ≤ 12 → truly ambiguous
    return "ambiguous";
  }

  return "ambiguous";
}

/**
 * Parse a date string with a known format.
 * Returns null if parsing fails.
 */
export function parseFlexDate(
  dateString: string,
  format: DateFormat,
): Date | null {
  const s = dateString.trim();
  if (!s) return null;

  let year: number;
  let month: number;
  let day: number;

  switch (format) {
    case "YYYY-MM-DD": {
      const parts = s.split("-");
      if (parts.length !== 3) return null;
      year = Number.parseInt(parts[0], 10);
      month = Number.parseInt(parts[1], 10);
      day = Number.parseInt(parts[2], 10);
      break;
    }
    case "MM/DD/YYYY":
    case "M/D/YYYY": {
      const parts = s.split("/");
      if (parts.length !== 3) return null;
      month = Number.parseInt(parts[0], 10);
      day = Number.parseInt(parts[1], 10);
      year = Number.parseInt(parts[2], 10);
      break;
    }
    case "DD/MM/YYYY": {
      const parts = s.split("/");
      if (parts.length !== 3) return null;
      day = Number.parseInt(parts[0], 10);
      month = Number.parseInt(parts[1], 10);
      year = Number.parseInt(parts[2], 10);
      break;
    }
    case "DD.MM.YYYY": {
      const parts = s.split(".");
      if (parts.length !== 3) return null;
      day = Number.parseInt(parts[0], 10);
      month = Number.parseInt(parts[1], 10);
      year = Number.parseInt(parts[2], 10);
      break;
    }
    default:
      return null;
  }

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  // Lokal midnat — kalderen gør den til lagringsværdien med
  // `localDateToEntryDate` (copenhagen.ts). Dagen skal findes: `new Date`
  // ruller ellers "31.02." stille over til 3. marts.
  const date = new Date(year, month - 1, day);
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
 * Parse a duration string into decimal hours.
 * Handles HH:MM:SS, HH:MM, or decimal formats.
 */
export function parseDuration(duration: string): number {
  const s = duration.trim();
  if (!s) return 0;

  // HH:MM:SS
  const hmsMatch = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hmsMatch) {
    const hours = Number.parseInt(hmsMatch[1], 10);
    const minutes = Number.parseInt(hmsMatch[2], 10);
    const seconds = Number.parseInt(hmsMatch[3], 10);
    return hours + minutes / 60 + seconds / 3600;
  }

  // HH:MM
  const hmMatch = s.match(/^(\d+):(\d{2})$/);
  if (hmMatch) {
    const hours = Number.parseInt(hmMatch[1], 10);
    const minutes = Number.parseInt(hmMatch[2], 10);
    return hours + minutes / 60;
  }

  // Decimal (handles both "1.5" and "1,5")
  const decimal = Number.parseFloat(s.replace(",", "."));
  if (!Number.isNaN(decimal)) return decimal;

  return 0;
}

/**
 * Parse a time string like "HH:MM:SS" or "HH:MM" into a {hours, minutes, seconds} object,
 * or return null if not a time format.
 */
export function parseTimeOfDay(
  timeString: string,
): { hours: number; minutes: number; seconds: number } | null {
  const s = timeString.trim();
  if (!s) return null;

  const match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  return {
    hours: Number.parseInt(match[1], 10),
    minutes: Number.parseInt(match[2], 10),
    seconds: match[3] ? Number.parseInt(match[3], 10) : 0,
  };
}
