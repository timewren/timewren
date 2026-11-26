// Ren beslutningslogik for bulk-tilknytning af eksisterende tidsposter til
// et klippekort. Udskilt af samme grund som reconcile.ts: mutationen og
// testene skal dele ÉN sandhed om hvad der trækkes, hvad der springes over,
// og hvad der afvises — pengene i saldoen tåler ikke to versioner.

export const MAX_PREPAID_ASSIGN_SELECTION = 200;

export interface BulkAssignCandidate {
  id: string;
  /** Postens klient — direkte på posten eller arvet fra projektet */
  effectiveClientId: string | null;
  /** Pakken posten allerede er trukket på (null = ingen) */
  prepaidPackageId: string | null;
}

export interface BulkAssignPlan<T extends BulkAssignCandidate> {
  /** Poster der skal reverseres (hvis nødvendigt) og trækkes på målpakken */
  toAssign: T[];
  /** Poster der allerede ligger på målpakken — no-op, ikke reverse+deduct */
  alreadyOnPackage: T[];
  /** Poster der hører til en anden kunde end pakken — skal afvise hele kaldet */
  foreign: T[];
}

/**
 * Afgør hvad der skal ske med hver valgt post.
 *
 * Poster der allerede ligger på målpakken springes over med vilje: en
 * reverse+deduct ville give et unødigt udsving i saldoen (og et ekstra
 * usage-spor) uden at ændre noget.
 */
export function planBulkAssign<T extends BulkAssignCandidate>(
  targetPackageId: string,
  packageClientId: string,
  entries: T[],
): BulkAssignPlan<T> {
  const plan: BulkAssignPlan<T> = {
    toAssign: [],
    alreadyOnPackage: [],
    foreign: [],
  };

  for (const entry of entries) {
    if (entry.effectiveClientId !== packageClientId) {
      plan.foreign.push(entry);
      continue;
    }
    if (entry.prepaidPackageId === targetPackageId) {
      plan.alreadyOnPackage.push(entry);
      continue;
    }
    plan.toAssign.push(entry);
  }

  return plan;
}
