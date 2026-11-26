/** Dage uden registreret tid, før en kunde står under "Inaktive". */
export const INACTIVE_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ClientActivityInput {
  isArchived?: boolean | null;
  createdAt?: Date | string | null;
  stats: { lastActivityDate: Date | string | null };
}

/**
 * Fanen "Inaktive" på kundelisten: en ikke-arkiveret kunde uden tid de
 * seneste 30 dage. Uden tid overhovedet tæller kundens alder: en ny kunde er
 * aktiv, ikke både "Aktiv" og "Inaktiv" (fund 13).
 */
export function isInactiveClient(
  client: ClientActivityInput,
  now: number = Date.now(),
): boolean {
  if (client.isArchived) return false;
  const cutoff = now - INACTIVE_AFTER_DAYS * DAY_MS;
  const since = client.stats.lastActivityDate ?? client.createdAt;
  if (!since) return true;
  return new Date(since).getTime() < cutoff;
}
