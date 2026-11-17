/**
 * De rene regler bag sikkerhedsnettet mod genopstandne timere (se
 * resurrection.ts for baggrunden og SQL-prædikaterne). Uden databaseimporter,
 * så klientens reconcile kan bruge dem uden at trække skemaet med i bundtet.
 */
export const RESURRECTION_TOLERANCE_SECONDS = 300;

export interface TimerRowSnapshot {
  isRunning: boolean | null;
  elapsedSeconds: number | null;
  baseSeconds: number | null;
  projectId?: string | null;
  clientId?: string | null;
  lastSyncedAt?: Date | null;
  updatedAt?: Date | null;
}

export function isClearedTimerRow(row: TimerRowSnapshot): boolean {
  return (
    !row.isRunning &&
    (row.elapsedSeconds ?? 0) === 0 &&
    (row.baseSeconds ?? 0) === 0 &&
    !row.projectId &&
    !row.clientId
  );
}

/** Spejler `NOT noResurrectionGuardSql()` — true = skrivningen skal afvises. */
export function isStaleStartOnClearedRow(
  row: TimerRowSnapshot,
  incomingStartTime: Date | null,
  /**
   * Ligger starttiden inde i en gemt post? Udelades den (klienten kender
   * ikke posterne), afgør rydningstidspunktet alene.
   */
  coveredBySavedEntry = true,
): boolean {
  if (!isClearedTimerRow(row)) return false;
  if (!incomingStartTime) return true;
  const clearedAt = row.lastSyncedAt ?? row.updatedAt ?? null;
  if (!clearedAt) return false;
  return (
    incomingStartTime.getTime() <
      clearedAt.getTime() - RESURRECTION_TOLERANCE_SECONDS * 1000 &&
    coveredBySavedEntry
  );
}
