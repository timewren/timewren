/**
 * Telefonnumre → E.164, så "+45 12 34 56 78", "0045 12345678" og "12 34 56 78"
 * er det samme nummer, når et opkald matches mod kundernes `phone`-felt.
 * Danske numre er altid 8 cifre; et nummer uden landekode antages dansk.
 */

const SEPARATORS_RE = /[\s\-()./]/g;
const TEL_PREFIX_RE = /^tel:/i;
const DIGITS_RE = /^\d+$/;
const DK_LOCAL_RE = /^\d{8}$/;
const DK_WITH_CODE_RE = /^45\d{8}$/;

export const DK_COUNTRY_CODE = '45';

/** E.164 tillader højst 15 cifre efter "+"; kortere end 7 er ikke et rigtigt nummer. */
const MIN_INTL_DIGITS = 7;
const MAX_INTL_DIGITS = 15;

/**
 * "+45 12 34 56 78" / "0045 12345678" / "12-34-56-78" → "+4512345678".
 * Udenlandske numre med "+" eller "00" bevares som E.164. Alt andet → null.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input)
    return null;
  let value = input.trim().replace(TEL_PREFIX_RE, '').replace(SEPARATORS_RE, '');
  if (value.startsWith('00'))
    value = `+${value.slice(2)}`;

  if (value.startsWith('+')) {
    const digits = value.slice(1);
    if (!DIGITS_RE.test(digits))
      return null;
    if (digits.startsWith(DK_COUNTRY_CODE))
      return DK_WITH_CODE_RE.test(digits) ? `+${digits}` : null;
    if (digits.length < MIN_INTL_DIGITS || digits.length > MAX_INTL_DIGITS)
      return null;
    return `+${digits}`;
  }

  if (DK_LOCAL_RE.test(value))
    return `+${DK_COUNTRY_CODE}${value}`;
  // "4512345678" uden plus: 10 cifre findes ikke som dansk nummer, så det er landekode + nummer.
  if (DK_WITH_CODE_RE.test(value))
    return `+${value}`;
  return null;
}

export type PhoneClient = {
  id: string;
  name: string;
  phone?: string | null;
  isArchived?: boolean | null;
};

/** Alle kunder hvis `phone` er samme nummer (efter normalisering). Aktive før arkiverede. */
export function findClientsByPhone<T extends PhoneClient>(clients: readonly T[], phone: string | null | undefined): T[] {
  const wanted = normalizePhone(phone);
  if (!wanted)
    return [];
  const hits = clients.filter(c => normalizePhone(c.phone) === wanted);
  return hits.sort((a, b) => Number(!!a.isArchived) - Number(!!b.isArchived));
}

/**
 * Den ene kunde nummeret peger på. Deler flere aktive kunder nummer (fx et
 * omstillingsnummer), gættes der ikke — så vælger brugeren selv.
 */
export function matchClientByPhone<T extends PhoneClient>(clients: readonly T[], phone: string | null | undefined): T | null {
  const hits = findClientsByPhone(clients, phone);
  const active = hits.filter(c => !c.isArchived);
  if (active.length === 1)
    return active[0];
  if (active.length === 0 && hits.length === 1)
    return hits[0];
  return null;
}
