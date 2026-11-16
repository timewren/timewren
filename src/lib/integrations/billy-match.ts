/**
 * Kobler TimeTrack-fakturaer uden Billy-id til den rigtige Billy-faktura.
 *
 * Baggrund (16/9-2026): tre fakturaer (INV-057/058/059) var sendt, men
 * havde aldrig fået `billy_invoice_id` — så betalingssyncen kunne aldrig
 * markere dem betalt, selv om Billy viste "betalt". Vi matcher på
 * fakturadato + nettobeløb og kræver ÉT entydigt hit; er der flere
 * kandidater, kobler vi ikke (bedre et manuelt tjek end et forkert match).
 *
 * #730: kaldes fra /api/cron/invoice-sync. Flertydighed gælder begge veje —
 * deler to TimeTrack-fakturaer samme Billy-kandidat, kobles ingen af dem.
 * Billy-kontakten (klientens billyId) bruges kun som tie-breaker, fordi
 * Billy kan have dublet-kontakter for samme kunde (#708).
 */

export interface LocalInvoiceForMatch {
  id: string;
  invoiceNumber: string;
  issueDate: Date | string;
  amount: string | number;
  /** Klientens Billy-kontakt — skiller kunder med samme dato og beløb */
  billyContactId?: string | null;
}

export interface BillyInvoiceForMatch {
  id?: string;
  invoiceNo?: number | string | null;
  /** "invoice" | "creditNote" */
  type?: string;
  state: string;
  currencyId?: string;
  contactId?: string;
  entryDate: string;
  amount?: number;
  netAmount?: number;
  isPaid?: boolean;
  balance?: number;
}

export interface InvoiceMatch {
  localId: string;
  invoiceNumber: string;
  billyId: string;
  billyInvoiceNo: string | null;
  isPaid: boolean;
}

export interface AmbiguousMatch {
  invoiceNumber: string;
  billyIds: string[];
}

/** "2026-08-31" — Billy's entryDate er en ren dato; vores issue_date er UTC-midnat */
export function toIsoDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Billy sætter `isPaid`; balance 0 på en godkendt faktura er samme signal. */
export function billyInvoiceIsPaid(inv: BillyInvoiceForMatch): boolean {
  if (inv.isPaid === true) return true;
  return (
    inv.state === "approved" &&
    typeof inv.balance === "number" &&
    inv.balance <= 0
  );
}

/**
 * @param ambiguous udfyldes med de fakturaer der havde mere end én mulig
 *   kobling, så kalderen kan logge dem til manuel kobling.
 */
export function matchUnlinkedInvoices(
  local: LocalInvoiceForMatch[],
  billy: BillyInvoiceForMatch[],
  ambiguous: AmbiguousMatch[] = [],
): InvoiceMatch[] {
  // Kun godkendte DKK-fakturaer kan matches — kladder har hverken nummer
  // eller endelig dato, annullerede og kreditnotaer må aldrig kobles, og
  // TimeTrack-beløb er altid i kroner.
  const candidates = billy.filter(
    (b) =>
      b.id &&
      b.state === "approved" &&
      (b.type == null || b.type === "invoice") &&
      (b.currencyId == null || b.currencyId === "DKK"),
  );

  const proposed: { inv: LocalInvoiceForMatch; hit: BillyInvoiceForMatch }[] =
    [];
  for (const inv of local) {
    const date = toIsoDate(inv.issueDate);
    const amount = Number(inv.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let hits = candidates.filter((b) => {
      const net = b.amount ?? b.netAmount;
      return (
        b.entryDate === date &&
        typeof net === "number" &&
        sameAmount(net, amount)
      );
    });
    if (hits.length > 1 && inv.billyContactId) {
      const sameContact = hits.filter(
        (b) => b.contactId === inv.billyContactId,
      );
      if (sameContact.length === 1) hits = sameContact;
    }
    if (hits.length > 1) {
      ambiguous.push({
        invoiceNumber: inv.invoiceNumber,
        billyIds: hits.map((b) => b.id as string),
      });
    }
    if (hits.length === 1) proposed.push({ inv, hit: hits[0] });
  }

  // Samme Billy-faktura foreslået til flere TimeTrack-fakturaer = gæt.
  const claims = new Map<string, number>();
  for (const p of proposed) {
    const id = p.hit.id as string;
    claims.set(id, (claims.get(id) ?? 0) + 1);
  }

  const matches: InvoiceMatch[] = [];
  for (const { inv, hit } of proposed) {
    const billyId = hit.id as string;
    if ((claims.get(billyId) ?? 0) > 1) {
      ambiguous.push({ invoiceNumber: inv.invoiceNumber, billyIds: [billyId] });
      continue;
    }
    matches.push({
      localId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      billyId,
      billyInvoiceNo: hit.invoiceNo != null ? String(hit.invoiceNo) : null,
      isPaid: billyInvoiceIsPaid(hit),
    });
  }
  return matches;
}
