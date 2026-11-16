const NUMBER_LIKE = /^[+-]?[\d\s.,()/-]+$/;

/**
 * Phone numbers and formatted amounts, e.g. "+45 12 34 56 78" or "-1.250,00".
 * The digit check is separate so the regex stays linear on long input.
 */
function isNumberLike(value: string): boolean {
  const text = value.trimStart();
  return NUMBER_LIKE.test(text) && /\d/.test(text);
}

/** Neutralize spreadsheet formulas without changing ordinary text. */
export function sanitizeForSpreadsheet(value: string): string {
  if (isNumberLike(value)) return value;
  return /^[=+\-@\t\r]/.test(value) || /^\s+[=+\-@]/.test(value)
    ? `'${value}`
    : value;
}

export function escapeCsv(
  value: string | number | null | undefined,
  options: {
    delimiter?: string;
    quoteComma?: boolean;
    alwaysQuote?: boolean;
    /** Only set for values already formatted as numbers by the caller. */
    numeric?: boolean;
  } = {},
): string {
  const raw = value == null ? "" : String(value);
  const text =
    typeof value === "number" || options.numeric
      ? raw
      : sanitizeForSpreadsheet(raw);
  if (
    options.alwaysQuote ||
    text.includes(options.delimiter ?? ";") ||
    (options.quoteComma && text.includes(",")) ||
    /["\r\n]/.test(text)
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
