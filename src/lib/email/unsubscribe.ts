import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrlEnv } from "@/lib/runtime-env";
import { getSigningSecret } from "@/lib/security/signing-secret";

/**
 * One-click unsubscribe support (RFC 8058). We sign a compact token with the
 * app secret so the unsubscribe endpoint can trust the userId without auth,
 * then expose it via the List-Unsubscribe / List-Unsubscribe-Post headers so
 * Gmail/Outlook render a native "Unsubscribe" button. This improves inbox
 * placement and gives recipients a friction-free opt-out.
 */

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(userId: string): string {
  return base64url(
    createHmac("sha256", getSigningSecret()).update(userId).digest(),
  );
}

/** Build a signed, URL-safe unsubscribe token for a user. */
export function generateUnsubscribeToken(userId: string): string {
  return `${base64url(userId)}.${sign(userId)}`;
}

/** Verify a token and return the userId, or null if invalid/tampered. */
export function verifyUnsubscribeToken(token: string): string | null {
  const [encodedId, sig] = token.split(".");
  if (!encodedId || !sig) return null;
  let userId: string;
  try {
    userId = Buffer.from(
      encodedId.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
  } catch {
    return null;
  }
  const expected = sign(userId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? userId : null;
}

/**
 * Signed unsubscribe URL for a visible link in the email body (GET shows a
 * confirmation page). Undefined if no app URL is set.
 */
export function buildUnsubscribeUrl(
  userId: string,
  /** Multibrand: kontoens app-URL (MailBrand.appUrl). Standard = appens. */
  baseUrl: string | undefined = appUrlEnv(),
): string | undefined {
  if (!baseUrl) return undefined;
  return `${baseUrl}/api/unsubscribe?token=${generateUnsubscribeToken(userId)}`;
}

/**
 * Headers to attach to bulk/marketing emails so mail clients show a native
 * one-click unsubscribe control. Returns an empty object if no app URL is set.
 */
export function buildUnsubscribeHeaders(
  userId: string,
  baseUrl?: string,
): Record<string, string> {
  const url = buildUnsubscribeUrl(userId, baseUrl ?? appUrlEnv());
  if (!url) return {};
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
