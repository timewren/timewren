/**
 * Enheds-login til desktop 1.0 (og senere mobil): browser-godkendelse med
 * deep link, `state` mod login-CSRF og PKCE (S256), så en opsnappet
 * engangskode ikke kan veksles af andre end den app, der startede login.
 *
 * Forløb:
 *  1. Appen laver `state`, en `code_verifier` og `code_challenge =
 *     base64url(sha256(verifier))` og åbner
 *     `/auth/device?state=…&challenge=…&device_id=…&device_name=…&os=…`.
 *  2. Brugeren godkender i browseren → POST /api/ext/device/approve laver
 *     en engangskode (5 min) og svarer med deep linket
 *     `timetrack://auth/callback?code=…&state=…`.
 *  3. Appen tjekker at `state` er dens egen og kalder
 *     `extension.device.exchangeCode({code, codeVerifier, state, deviceId})`
 *     → adgangstoken (30 dage) + refresh-token (180 dage).
 *  4. `extension.device.refresh` roterer begge uden nyt login.
 *
 * Ren modul uden DB, så reglerne kan unit-testes.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DEVICE_CODE_TTL_MS = 5 * 60_000;
export const DEVICE_ACCESS_TTL_MS = 30 * 24 * 60 * 60_000;
export const DEVICE_REFRESH_TTL_MS = 180 * 24 * 60 * 60_000;

export const DEVICE_CALLBACK_URL = "timetrack://auth/callback";

export const DEVICE_CLIENT_KINDS = ["desktop", "mobile", "extension"] as const;
export type DeviceClientKind = (typeof DEVICE_CLIENT_KINDS)[number];

/** state: 16-256 URL-sikre tegn (appen bør bruge mindst 32 tilfældige). */
const STATE_RE = /^[A-Za-z0-9._~-]{16,256}$/;
/** S256-challenge: base64url af en sha256 = 43 tegn. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/** PKCE-verifier (RFC 7636): 43-128 tegn. */
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
/** Stabilt enheds-id fra appen (fx en UUID gemt lokalt). */
const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function isValidState(state: unknown): state is string {
  return typeof state === "string" && STATE_RE.test(state);
}

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === "string" && CHALLENGE_RE.test(challenge);
}

export function isValidCodeVerifier(verifier: unknown): verifier is string {
  return typeof verifier === "string" && VERIFIER_RE.test(verifier);
}

export function isValidDeviceId(deviceId: unknown): deviceId is string {
  return typeof deviceId === "string" && DEVICE_ID_RE.test(deviceId);
}

/** base64url(sha256(verifier)) — PKCE S256. */
export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Konstant-tids sammenligning af verifier mod den gemte challenge. */
export function verifierMatchesChallenge(
  verifier: string,
  challenge: string,
): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) {
    return false;
  }
  const a = Buffer.from(codeChallengeS256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Konstant-tids sammenligning af to strenge (state). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Engangskode til deep linket (256 bit, URL-sikker). */
export function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

/** Navn/OS fra appen: trimmet, uden styretegn, afkortet til kolonnen. */
export function cleanDeviceLabel(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: styretegn fjernes med vilje
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export function deviceCallbackUrl(code: string, state: string): string {
  const callback = process.env.DEVICE_CALLBACK_URL ?? DEVICE_CALLBACK_URL;
  if (
    !/^[a-z][a-z0-9+.-]*:\/\/auth\/callback$/i.test(callback) ||
    /^(https?|javascript|data|file|exp):/i.test(callback)
  ) {
    throw new Error(
      "DEVICE_CALLBACK_URL skal være et app-link til auth/callback",
    );
  }
  const params = new URLSearchParams({ code, state });
  return `${callback}?${params.toString()}`;
}

/** Visningsnavn for tokenet i web's liste ("TimeTrack Desktop (Mads' Mac)"). */
export function deviceTokenName(
  kind: DeviceClientKind,
  deviceName: string | null,
): string {
  const app =
    kind === "desktop"
      ? "TimeTrack Desktop"
      : kind === "mobile"
        ? "TimeTrack mobil"
        : "Browserudvidelse";
  return (deviceName ? `${app} (${deviceName})` : app).slice(0, 100);
}
