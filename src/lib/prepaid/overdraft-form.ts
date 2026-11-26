/**
 * Overtræks-politikken (#93) i klippekort-formularerne. Bruges af
 * redigeringssiden, så et eksisterende kort kan skifte politik (#1319).
 */
export type OverdraftPolicy = "block" | "allow" | "invoice";

/** Ukendte eller manglende værdier fra databasen læses som "block" (standard). */
export function toOverdraftPolicy(
  value: string | null | undefined,
): OverdraftPolicy {
  return value === "allow" || value === "invoice" ? value : "block";
}

/**
 * Formularens felter → `prepaid.update`. Satsen bruges kun ved "invoice", og
 * kun dér sendes den: en tom eller ugyldig sats er `null` (= postens egen
 * sats). Ved andre politikker udelades den (`undefined`), så serveren lader
 * en gemt sats stå urørt, når brugeren kun retter fx navnet.
 */
export function overdraftUpdateFromForm(
  policy: string | null | undefined,
  rate: string | null | undefined,
): { overdraftPolicy: OverdraftPolicy; overdraftRate?: number | null } {
  const overdraftPolicy = toOverdraftPolicy(policy);
  if (overdraftPolicy !== "invoice") return { overdraftPolicy };
  const parsed = Number.parseFloat(rate ?? "");
  return {
    overdraftPolicy,
    overdraftRate: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
  };
}
