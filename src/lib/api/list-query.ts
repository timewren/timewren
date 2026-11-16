/**
 * Oversættelse fra REST/MCP-lagets side-baserede paginering til de
 * `listPage`-procedurer der paginerer i databasen (#573).
 *
 * Rene funktioner, så netop den oversættelse kan testes — det var den der
 * manglede, da /time-entries (#572) og /invoices tavst stoppede ved
 * procedurens egen default-limit.
 */

/** Rækker der springes over for at nå `page` (1-indekseret). */
export function pageOffset(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit);
}

/**
 * ILIKE-mønster for "indeholder". Søgningen var tidligere en ren
 * delstreng-match i hukommelsen, så `%` og `_` i søgeteksten skal matche sig
 * selv og ikke blive jokertegn.
 */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export type InvoiceSortField =
  | "createdAt"
  | "status"
  | "amount"
  | "issueDate"
  | "dueDate";

/** Sorteringsfelter REST-ruten accepterer for fakturaer. */
export const INVOICE_SORT_PARAMS = [
  "createdAt",
  "status",
  "totalAmount",
  "amount",
  "issueDate",
  "dueDate",
];

/**
 * `totalAmount` har stået i OpenAPI-spec'en, men kolonnen hedder `amount`.
 * Sorteringen skete tidligere i hukommelsen på et felt der ikke fandtes, og
 * var dermed en tavs no-op. Navnet bevares som alias.
 */
export function toInvoiceSortField(sort: string): InvoiceSortField {
  switch (sort) {
    case "totalAmount":
    case "amount":
      return "amount";
    case "status":
    case "issueDate":
    case "dueDate":
      return sort;
    default:
      return "createdAt";
  }
}

/**
 * Hint til MCP-værktøjer, når svaret kun er en del af resultatet. En
 * sprogmodel kan ellers ikke se forskel på "det var alt" og "her er første
 * side". Returnerer `null` når der ikke er mere.
 */
export function moreResultsHint(
  noun: string,
  page: number,
  limit: number,
  shown: number,
  total: number,
): string | null {
  const from = pageOffset(page, limit);
  if (from + shown >= total) return null;
  const first = shown > 0 ? from + 1 : from;
  return `Showing ${noun} ${first}-${from + shown} of ${total}. There are more results: call again with page=${page + 1} (limit=${limit}) or narrow the filters.`;
}
