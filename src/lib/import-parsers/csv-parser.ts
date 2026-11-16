/**
 * Generic comma-delimited CSV parser.
 * The existing src/lib/csv-parser.ts uses semicolons for Effihub — this is separate.
 */
export function parseCSV(
  csvText: string,
  delimiter = ",",
): Array<Record<string, string>> {
  // Remove BOM and normalize line endings
  const text = csvText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!text) return [];

  const lines = parseCSVLines(text, delimiter);
  if (lines.length < 2) return [];

  const headers = lines[0];
  const results: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];
    if (values.length === 1 && values[0] === "") continue; // Skip empty lines

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? "").trim();
    }
    results.push(row);
  }

  return results;
}

/** Parse CSV text into array of arrays, handling quoted fields */
function parseCSVLines(text: string, delimiter: string): string[][] {
  const lines: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        current.push(field);
        field = "";
      } else if (char === "\n") {
        current.push(field);
        field = "";
        lines.push(current);
        current = [];
      } else {
        field += char;
      }
    }
  }

  // Push last field and last line
  current.push(field);
  if (current.length > 1 || current[0] !== "") {
    lines.push(current);
  }

  return lines;
}
