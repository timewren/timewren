/**
 * Signeret OAuth-`state` til kalender-forbindelser (Google og Outlook).
 *
 * Staten bærer kontoens id, brandet (hvis klient flowet startede med),
 * udbyderen og et udløb, signeret med HMAC-SHA256 over BETTER_AUTH_SECRET.
 * Callbacken kræver desuden, at staten står i flowets cookie (CSRF, bundet til
 * browseren), og at kontoen i sessionen er den samme som i staten (bundet til
 * brugeren). Så kan en state hverken genbruges af en anden konto, efter
 * udløb eller på tværs af udbydere.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BRAND_KEYS, type BrandKey } from "@/lib/brands/registry";
import { getSigningSecret } from "@/lib/security/signing-secret";

export type CalendarOAuthProvider = "google" | "outlook";

/** Samme levetid som state-cookien (10 min). */
export const CALENDAR_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  /** Konto-id */
  u: string;
  /** Brand */
  b: BrandKey;
  /** Udbyder */
  p: CalendarOAuthProvider;
  /** Udløb (ms siden epoch) */
  e: number;
  /** Nonce */
  n: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(`calendar-oauth:${payload}`)
    .digest("base64url");
}

export function createCalendarOAuthState(params: {
  userId: string;
  brand: BrandKey;
  provider: CalendarOAuthProvider;
  now?: number;
}): string {
  const payload: StatePayload = {
    u: params.userId,
    b: params.brand,
    p: params.provider,
    e: (params.now ?? Date.now()) + CALENDAR_OAUTH_STATE_TTL_MS,
    n: randomBytes(16).toString("base64url"),
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export type CalendarOAuthStateError =
  | "missing"
  | "mismatch"
  | "invalid"
  | "expired"
  | "wrong_user"
  | "wrong_provider";

export type CalendarOAuthStateResult =
  | { ok: true; brand: BrandKey }
  | { ok: false; reason: CalendarOAuthStateError };

/**
 * Verificér staten fra callbacken mod cookien og den indloggede konto.
 * Returnerer brandet, hvis klient code-udvekslingen skal bruge.
 */
export function verifyCalendarOAuthState(params: {
  state: string | null | undefined;
  cookieState: string | null | undefined;
  userId: string;
  provider: CalendarOAuthProvider;
  now?: number;
}): CalendarOAuthStateResult {
  const { state, cookieState } = params;
  if (!state || !cookieState) return { ok: false, reason: "missing" };

  const a = Buffer.from(state);
  const b = Buffer.from(cookieState);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "mismatch" };
  }

  const [encoded, sig] = state.split(".");
  if (!encoded || !sig) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(encoded));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "invalid" };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    typeof payload?.u !== "string" ||
    typeof payload.e !== "number" ||
    !BRAND_KEYS.includes(payload.b)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (payload.e < (params.now ?? Date.now())) {
    return { ok: false, reason: "expired" };
  }
  if (payload.p !== params.provider) {
    return { ok: false, reason: "wrong_provider" };
  }
  if (payload.u !== params.userId) return { ok: false, reason: "wrong_user" };
  return { ok: true, brand: payload.b };
}
