const MINUTE = 60 * 1000;

/** Tokens der udløber inden for dette vindue, fornyes proaktivt. */
const AHEAD_MS = 10 * MINUTE;
/** Ældre udløbne tokens prøves aldrig af cron'en (refresh-tokenet er dødt). */
const EXPIRED_MAX_AGE_MS = 24 * 60 * MINUTE;

/**
 * Udløbsvindue for refresh-tokens-cron'en (kører hvert 5. minut).
 *
 * Tokens der udløber inden for 10 min, fornyes ved hver kørsel. Tokens der
 * allerede er udløbet (højst et døgn siden), tages kun med i timens første
 * kørsel (minut 0-4), så et dødt refresh-token prøves højst én gang i timen
 * i stedet for hvert 5. minut. Brugeren fornyer ellers selv ved næste brug
 * (getValidDineroToken) eller ved at forbinde igen.
 */
export function tokenRefreshWindow(now: Date): { from: Date; to: Date } {
  const retryExpired = now.getUTCMinutes() < 5;
  return {
    from: retryExpired ? new Date(now.getTime() - EXPIRED_MAX_AGE_MS) : now,
    to: new Date(now.getTime() + AHEAD_MS),
  };
}
