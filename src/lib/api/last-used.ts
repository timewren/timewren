/**
 * "Senest brugt" på API-nøgler skal ikke koste en skrivning pr. kald (prod
 * 28/10: 42.000 UPDATE api_keys på et døgn). Rækken er allerede læst ved
 * opslaget, så beslutningen tages ud fra den: skriv kun når den gemte værdi
 * er ældre end intervallet, eller når kaldet kommer fra en ny IP. Virker på
 * tværs af replikaer uden delt tilstand.
 */
export const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000;

export function shouldRecordKeyUse(
  stored: { lastUsedAt: Date | null; lastUsedIp?: string | null },
  /** Udelades, når kalderen ikke gemmer IP (MCP). */
  ip?: string,
  now: number = Date.now(),
): boolean {
  if (!stored.lastUsedAt) return true;
  if (ip !== undefined && stored.lastUsedIp !== ip) return true;
  return now - stored.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS;
}
