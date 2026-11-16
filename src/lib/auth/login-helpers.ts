import daAuth from "@/i18n/messages/da/auth.json";

// Rene hjælpere til login-flowet (web). Holdt fri af React/better-auth, så
// redirect-validering og fejloversættelse kan unit-testes.

// /dashboard/start slår brugerens valgte startside op (#startside) og
// redirecter dertil — ukendt/null falder selv tilbage til /dashboard.
export const DEFAULT_LOGIN_REDIRECT = "/dashboard/start";
export const TWO_FACTOR_PATH = "/login/two-factor";

/**
 * Returnerer `raw` hvis det er en intern sti, ellers `fallback`.
 * Afviser absolutte URL'er, protokol-relative (`//evil.dk`), backslash-
 * varianter (`/\evil.dk`, som browsere normaliserer til `//`) og
 * kontroltegn — alt der kan føre brugeren til et andet domæne.
 */
export function safeRedirectPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_LOGIN_REDIRECT,
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: afviser bevidst kontroltegn
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  try {
    const base = "https://timetrack.invalid";
    if (new URL(raw, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return raw;
}

export type TwoFactorMethod = "totp" | "otp";

/**
 * Bygger URL'en til 2FA-siden. `redirect` bevares kun hvis den er intern og
 * ikke er standard-destinationen; `methods` fortæller siden hvilke metoder
 * serveren tilbyder brugeren (better-auths `twoFactorMethods`).
 */
export function buildTwoFactorUrl(
  redirect: string | null | undefined,
  methods?: readonly string[] | null,
): string {
  const params = new URLSearchParams();
  const target = safeRedirectPath(redirect);
  if (target !== DEFAULT_LOGIN_REDIRECT) params.set("redirect", target);
  const known = (methods ?? []).filter(
    (m): m is TwoFactorMethod => m === "totp" || m === "otp",
  );
  if (known.length > 0) params.set("methods", known.join(","));
  const qs = params.toString();
  return qs ? `${TWO_FACTOR_PATH}?${qs}` : TWO_FACTOR_PATH;
}

/** Læser `methods`-parameteren tilbage; tom/ukendt → TOTP som standard. */
export function parseTwoFactorMethods(
  raw: string | null | undefined,
): TwoFactorMethod[] {
  const methods = (raw ?? "")
    .split(",")
    .filter((m): m is TwoFactorMethod => m === "totp" || m === "otp");
  return methods.length > 0 ? methods : ["totp"];
}

type AuthErrorLike = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
} | null;

/** Oversætter fra `useTranslations("auth")` / `getT("auth")`. Uden den bruges dansk. */
type AuthTranslator = (key: string) => string;

// Danske tekster ligger i auth.json (errors.*); koderne er better-auths.
const DA_ERRORS: Record<string, string> = daAuth.errors;

const ERROR_KEY_BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidEmailOrPassword",
  // Multibrand: kontoen hører til et andet brand (host-auth.ts).
  ACCOUNT_NOT_ON_THIS_SITE: "accountNotHere",
  INVALID_PASSWORD: "invalidPassword",
  INVALID_EMAIL: "invalidEmail",
  USER_NOT_FOUND: "invalidEmailOrPassword",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "credentialAccountNotFound",
  EMAIL_NOT_VERIFIED: "emailNotVerified",
  INVALID_TOKEN: "invalidToken",
  TOKEN_EXPIRED: "tokenExpired",
  // twoFactor-plugin
  INVALID_CODE: "invalidCode",
  INVALID_BACKUP_CODE: "invalidBackupCode",
  OTP_HAS_EXPIRED: "otpExpired",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "tooManyAttempts",
  ACCOUNT_TEMPORARILY_LOCKED: "accountLocked",
  INVALID_TWO_FACTOR_COOKIE: "invalidTwoFactorCookie",
  TOTP_NOT_ENABLED: "totpNotEnabled",
  OTP_NOT_ENABLED: "otpNotEnabled",
  BACKUP_CODES_NOT_ENABLED: "backupCodesNotEnabled",
};

// Fallback når serveren ikke sender `code` (fx ældre svar) — match på
// better-auths engelske standardbesked.
const ERROR_KEY_BY_MESSAGE: Record<string, string> = {
  "invalid email or password": "invalidEmailOrPassword",
  "we could not find an account with those details here": "accountNotHere",
  "invalid password": "invalidPassword",
  "invalid email": "invalidEmail",
  "user not found": "invalidEmailOrPassword",
  "email not verified": "emailNotVerified",
  "invalid code": "invalidCode",
  "invalid backup code": "invalidBackupCode",
  "otp has expired": "otpExpired",
  "invalid two factor cookie": "invalidTwoFactorCookie",
};

export const RATE_LIMIT_MESSAGE = DA_ERRORS.rateLimit;
const SSO_REQUIRED_DA = DA_ERRORS.ssoRequired;

/**
 * Oversætter better-auths fejl til brugerens sprog (`t` = auth-oversætteren;
 * uden `t` bliver det dansk). Ukendte beskeder sendes uændret videre, og
 * mangler der en besked, bruges `fallback`.
 */
export function translateAuthError(
  error: AuthErrorLike,
  fallback = DA_ERRORS.generic,
  t?: AuthTranslator,
): string {
  const text = (key: string) => (t ? t(`errors.${key}`) : DA_ERRORS[key]);
  if (!error) return fallback;
  if (error.status === 429) return text("rateLimit");
  const byCode = error.code ? ERROR_KEY_BY_CODE[error.code] : undefined;
  if (byCode) return text(byCode);
  const message = error.message?.trim();
  if (!message) return fallback;
  if (message === SSO_REQUIRED_DA) return text("ssoRequired");
  const normalized = message.replace(/[.!]+$/, "").toLowerCase();
  if (normalized.startsWith("too many requests")) return text("rateLimit");
  const byMessage = ERROR_KEY_BY_MESSAGE[normalized];
  return byMessage ? text(byMessage) : message;
}
