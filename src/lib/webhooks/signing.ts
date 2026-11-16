import crypto from "node:crypto";
import { decryptSecret } from "@/lib/utils/encryption";

/**
 * Signeringssecret for udgående webhooks gemmes krypteret ("enc:v1:", #712).
 * Rækker fra før backfill er klartekst og læses uændret af decryptSecret.
 */

/** HMAC-SHA256 af payload med den gemte (krypterede eller gamle) secret. */
export function signWebhookPayload(
  payload: string,
  storedSecret: string,
): string {
  return crypto
    .createHmac("sha256", decryptSecret(storedSecret))
    .update(payload)
    .digest("hex");
}

/** Maskeret visning (første 10 + sidste 4 tegn) af den gemte secret. */
export function maskWebhookSecret(storedSecret: string): string {
  try {
    const secret = decryptSecret(storedSecret);
    return `${secret.substring(0, 10)}...${secret.substring(secret.length - 4)}`;
  } catch {
    return "••••••••";
  }
}
