import { tokenMatchesHash } from "@/lib/security/token-hash";

/**
 * Verificér X-Goog-Channel-Token mod den gemte kanal-tokens hash (#713).
 *
 * Kun hashen accepteres (#726): klartekst-kolonnen er nulstillet, og
 * CRON_SECRET-fallbacken for kanaler fra før per-kanal-tokens (april 2026)
 * er fjernet — Google-kanaler udløber efter højst 7 dage, og renew-cron'en
 * registrerer dem med et nyt token. Sammenligningen er konstant-tid.
 */
export function verifyCalendarChannelToken(
  channelToken: string | null | undefined,
  stored: { webhookTokenHash: string | null },
): boolean {
  if (!channelToken) return false;
  return tokenMatchesHash(channelToken, stored.webhookTokenHash);
}
