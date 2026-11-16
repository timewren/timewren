// Pure decision logic for klippekort-reconcile when a time entry is edited
// (#204). Extracted so time.update and the unit tests share ONE truth about
// when the deduction must follow the entry.

/**
 * En posts kunde, som den er gemt: egen `clientId` og/eller projektets
 * kunde. Posterne gemmes i to konventioner (klient+projekt fra extensionen,
 * kun projekt fra topbaren), så kun den EFFEKTIVE kunde kan sammenlignes.
 */
export interface EntryClientRef {
  clientId: string | null;
  projectClientId: string | null;
}

/** Postens effektive kunde: egen klient, ellers projektets. */
export function effectiveClientId(ref: EntryClientRef): string | null {
  return ref.clientId ?? ref.projectClientId ?? null;
}

export interface PrepaidReconcileInput {
  /** Entry was prepaid with a package before the edit */
  wasPrepaid: boolean;
  oldPackageId: string | null;
  /** Kunden før redigeringen (rå felter — den effektive udledes her) */
  oldClient: EntryClientRef;
  /** Kunden efter redigeringen */
  newClient: EntryClientRef;
  /**
   * The edit's explicit package choice: undefined = not specified,
   * null = remove deduction, uuid = deduct on this package.
   */
  requestedPackageId: string | null | undefined;
  oldHours: number;
  newHours: number;
}

export interface PrepaidReconcileDecision {
  /** Package the entry should be deducted on after the edit (null = none) */
  targetPackageId: string | null;
  /** Whether reverse/deduct needs to run at all */
  needsReconcile: boolean;
  packageChanged: boolean;
  clientChanged: boolean;
  /**
   * Re-deduction may skip the isActive check: same package and the net
   * effect frees hours — a decrease must not be blocked by a package that
   * expired since the entry was created.
   */
  allowInactive: boolean;
}

export function resolvePrepaidReconcile(
  input: PrepaidReconcileInput,
): PrepaidReconcileDecision {
  const {
    wasPrepaid,
    oldPackageId,
    oldClient,
    newClient,
    requestedPackageId,
    oldHours,
    newHours,
  } = input;

  // Effektiv kunde (A1 P1-1): "fortsæt" kan gemme en klient+projekt-post
  // som kun projekt. Den rå clientId skifter da X → null, men kunden er den
  // samme — at sammenligne rå felter detachede trækket stille.
  const clientChanged =
    effectiveClientId(oldClient) !== effectiveClientId(newClient);

  let targetPackageId: string | null;
  if (requestedPackageId !== undefined) {
    targetPackageId = requestedPackageId;
  } else if (wasPrepaid && clientChanged) {
    // Klient-skift uden eksplicit pakkevalg: detach som sikker default —
    // det gamle træk må ikke blive stående hos den forkerte kunde.
    targetPackageId = null;
  } else {
    targetPackageId = wasPrepaid ? oldPackageId : null;
  }

  const packageChanged = (oldPackageId ?? null) !== targetPackageId;
  const needsReconcile = wasPrepaid
    ? packageChanged || oldHours !== newHours
    : targetPackageId !== null;

  return {
    targetPackageId,
    needsReconcile,
    packageChanged,
    clientChanged,
    allowInactive: !packageChanged && newHours <= oldHours,
  };
}
