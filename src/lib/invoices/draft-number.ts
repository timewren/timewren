// Kladde-numre (#196): danske momsregler kræver en FORTLØBENDE, ubrudt
// fakturanummer-serie. Kladder må derfor ikke forbruge rigtige numre — de får
// et UDKAST-placeholder, og det rigtige nummer tildeles først ved udstedelse
// (draft → sent), som i Billy/Dinero/e-conomic.
//
// Præfikset følger organisationens sprog (fund 18): en engelsk organisation
// får "DRAFT-", ikke "UDKAST-". Eksisterende kladder beholder deres nummer,
// så alle præfikser genkendes som kladder.
//
// Client-safe module: ingen DB/drizzle-imports.

export const DRAFT_NUMBER_PREFIX = "UDKAST-";

const DRAFT_PREFIX_BY_LANGUAGE: Record<string, string> = {
  da: DRAFT_NUMBER_PREFIX,
  en: "DRAFT-",
  de: "ENTWURF-",
  es: "BORRADOR-",
};

/** Alle kladdepræfikser; SQL, der udelader kladder, skal udelade dem alle. */
export const DRAFT_NUMBER_PREFIXES: readonly string[] = [
  ...new Set(Object.values(DRAFT_PREFIX_BY_LANGUAGE)),
];

/** Kladdepræfikset for et sprog; andre sprog end de fire får det engelske. */
export function draftNumberPrefix(locale?: string | null): string {
  const lang = (locale || "da").toLowerCase().split(/[-_]/)[0];
  return DRAFT_PREFIX_BY_LANGUAGE[lang] ?? DRAFT_PREFIX_BY_LANGUAGE.en;
}

// Proces-lokal tæller: garanterer unikhed i tight loops (bulk-oprettelse i
// samme ms), hvor random alene kolliderer via fødselsdagsparadokset.
let draftSeq = 0;

/**
 * Unikt placeholder-nummer til en kladde (ms-timestamp + tæller + random).
 * `locale` er organisationens sprog; uden det er præfikset dansk som før.
 */
export function draftInvoiceNumber(locale?: string | null): string {
  draftSeq = (draftSeq + 1) % 1296; // 36^2
  const seq = draftSeq.toString(36).padStart(2, "0");
  const rand = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0");
  return `${draftNumberPrefix(locale)}${Date.now().toString(36)}${seq}${rand}`.toUpperCase();
}

export function isDraftInvoiceNumber(
  invoiceNumber: string | null | undefined,
): boolean {
  const upper = invoiceNumber?.toUpperCase();
  return (
    !!upper && DRAFT_NUMBER_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

/**
 * UI-visning: kladder viser "Kladde" i stedet for placeholder-nummeret.
 * Klientkomponenter giver den oversatte tekst med `draftLabel`.
 */
export function formatInvoiceNumber(
  invoiceNumber: string | null | undefined,
  draftLabel = "Kladde",
): string {
  if (!invoiceNumber) return draftLabel;
  return isDraftInvoiceNumber(invoiceNumber) ? draftLabel : invoiceNumber;
}
