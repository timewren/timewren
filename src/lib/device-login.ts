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
import { appSchemes, BRAND_APP_SCHEMES } from "@/lib/auth/trusted-origins";

export const DEVICE_CODE_TTL_MS = 5 * 60_000;
export const DEVICE_ACCESS_TTL_MS = 30 * 24 * 60 * 60_000;
export const DEVICE_REFRESH_TTL_MS = 180 * 24 * 60 * 60_000;

export const DEVICE_CALLBACK_URL = "timetrack://auth/callback";
/** Appens svar-sti efter scheme; samme for alle brands. */
const CALLBACK_SUFFIX = "auth/callback";
/** Callback pr. brand, når klienten ikke beder om et kendt scheme. */
const BRAND_CALLBACK_URLS: Readonly<Record<string, string>> = {
  timetrack: DEVICE_CALLBACK_URL,
  timewren: `${BRAND_APP_SCHEMES.timewren[0]}${CALLBACK_SUFFIX}`,
};

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

function isNativeCallback(callback: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\/auth\/callback$/i.test(callback) &&
    !/^(https?|javascript|data|file|exp):/i.test(callback)
  );
}

/**
 * Callbacks klienten må bede om: samme allowlist som better-auths
 * trustedOrigins (APP_SCHEMES + brandenes app-schemes) plus instansens
 * DEVICE_CALLBACK_URL. Aldrig en vilkårlig URL, så koden ikke kan sendes til
 * en fremmed adresse (open redirect).
 */
export function allowedDeviceCallbacks(): string[] {
  const schemes = [
    ...appSchemes(process.env.APP_SCHEMES),
    ...Object.values(BRAND_APP_SCHEMES).flat(),
  ];
  // Begge brands' standardcallbacks er altid med, også når APP_SCHEMES er
  // sat til andet, så en klient aldrig mister sit eget scheme.
  const callbacks = [
    ...Object.values(BRAND_CALLBACK_URLS),
    ...schemes.map((scheme) => `${scheme}${CALLBACK_SUFFIX}`),
  ];
  const configured = process.env.DEVICE_CALLBACK_URL;
  if (configured && isNativeCallback(configured)) callbacks.push(configured);
  return callbacks.filter((v, i, a) => a.indexOf(v) === i);
}

export interface DeviceCallbackOptions {
  /** `redirect_uri` fra klienten. Kun et eksakt match i allowlisten tæller. */
  redirectUri?: unknown;
  /** Instansens/hostens brand; styrer fallbacket. Uden: timetrack. */
  brand?: string;
}

/**
 * Callbacket for en godkendelse: klientens `redirect_uri`, hvis den står i
 * allowlisten; ellers instansens DEVICE_CALLBACK_URL; ellers brandets eget
 * (timewren://auth/callback for TimeWren, ellers timetrack://auth/callback).
 */
export function resolveDeviceCallback({
  redirectUri,
  brand,
}: DeviceCallbackOptions = {}): string {
  const configured = process.env.DEVICE_CALLBACK_URL;
  if (configured !== undefined && !isNativeCallback(configured)) {
    throw new Error(
      "DEVICE_CALLBACK_URL skal være et app-link til auth/callback",
    );
  }
  if (typeof redirectUri === "string") {
    const requested = redirectUri.trim().toLowerCase();
    const match = allowedDeviceCallbacks().find(
      (allowed) => allowed.toLowerCase() === requested,
    );
    if (match) return match;
  }
  return configured ?? BRAND_CALLBACK_URLS[brand ?? ""] ?? DEVICE_CALLBACK_URL;
}

export function deviceCallbackUrl(
  code: string,
  state: string,
  options: DeviceCallbackOptions = {},
): string {
  const params = new URLSearchParams({ code, state });
  return `${resolveDeviceCallback(options)}?${params.toString()}`;
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
