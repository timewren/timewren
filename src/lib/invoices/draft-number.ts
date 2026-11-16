// Kladde-numre (#196): danske momsregler kræver en FORTLØBENDE, ubrudt
// fakturanummer-serie. Kladder må derfor ikke forbruge rigtige numre — de får
// et UDKAST-placeholder, og det rigtige nummer tildeles først ved udstedelse
// (draft → sent), som i Billy/Dinero/e-conomic.
//
// Client-safe module: ingen DB/drizzle-imports.

export const DRAFT_NUMBER_PREFIX = "UDKAST-";

// Proces-lokal tæller: garanterer unikhed i tight loops (bulk-oprettelse i
// samme ms), hvor random alene kolliderer via fødselsdagsparadokset.
let draftSeq = 0;

/** Unikt placeholder-nummer til en kladde (ms-timestamp + tæller + random). */
export function draftInvoiceNumber(): string {
  draftSeq = (draftSeq + 1) % 1296; // 36^2
  const seq = draftSeq.toString(36).padStart(2, "0");
  const rand = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0");
  return `${DRAFT_NUMBER_PREFIX}${Date.now().toString(36)}${seq}${rand}`.toUpperCase();
}

export function isDraftInvoiceNumber(
  invoiceNumber: string | null | undefined,
): boolean {
  return !!invoiceNumber?.toUpperCase().startsWith(DRAFT_NUMBER_PREFIX);
}

/** UI-visning: kladder viser "Kladde" i stedet for placeholder-nummeret. */
export function formatInvoiceNumber(
  invoiceNumber: string | null | undefined,
): string {
  if (!invoiceNumber) return "Kladde";
  return isDraftInvoiceNumber(invoiceNumber) ? "Kladde" : invoiceNumber;
}
