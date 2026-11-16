/**
 * Ren godkendelses-logik uden DB-/email-afhængigheder, så reglerne kan testes
 * isoleret (router'en kan ikke importeres i unit-tests pga. DB-importkæden).
 */

/** Tidsposter der mangler klient-godkendelse må ikke allerede være
 * fakturerede, betalt via klippekort, eller allerede afsendt/godkendt. */
export const PENDING_ELIGIBLE: string[] = ["not_required", "rejected"];

/**
 * Om en tidspost kan bundtes i en periode-godkendelsesanmodning. Spejler
 * SQL-filteret i approvalRequests.create (type "period"): ikke faktureret,
 * ikke betalt via klippekort, og endnu ikke afsendt/godkendt.
 */
export function isEntryEligibleForApproval(entry: {
  isBilled: boolean | null;
  isPrepaid: boolean | null;
  approvalStatus: string | null;
}): boolean {
  return (
    entry.isBilled !== true &&
    entry.isPrepaid !== true &&
    PENDING_ELIGIBLE.includes(entry.approvalStatus ?? "not_required")
  );
}

export function periodLabel(
  type: string,
  periodStart: string | null,
  periodEnd: string | null,
): string {
  if (type === "invoice_draft") return "et fakturaudkast";
  if (periodStart && periodEnd) return `perioden ${periodStart} – ${periodEnd}`;
  return "en periode";
}
