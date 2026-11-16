/**
 * Fælles signeringshemmelighed til selvbærende tokens (desktop-JWT,
 * unsubscribe-HMAC). Der er bevidst ingen fallback: en forudsigelig nøgle i et
 * offentligt repo lader alle forfalske tokens (#1013). Læses lazy, så
 * `next build` ikke fejler uden runtime-env; første signering/verificering
 * fejler i stedet. Tests sætter værdien eksplicit (vitest.config.ts).
 */
export function getSigningSecret(): Uint8Array<ArrayBuffer> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET mangler: tokens kan ikke signeres eller verificeres. " +
        "Generér en med: openssl rand -base64 32",
    );
  }
  return new TextEncoder().encode(secret);
}
