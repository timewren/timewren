import { t } from "../i18n/core";
/**
 * Fejl fra extensionens API-klient med nok struktur til at skelne "serveren
 * sagde nej" fra "vi ved ikke, hvad der skete".
 *
 * Forskellen er afgørende ved stop: en timeout betyder IKKE, at serveren ikke
 * gemte posten — svaret kan bare være gået tabt. Behandles den som en afvisning,
 * kører timeren videre med den oprindelige start, og næste stop gemmer samme
 * session én gang til (kunde A 2026-10: 2-3 ens poster minutter fra hinanden).
 */
export type ApiErrorKind = "timeout" | "network" | "http" | "invalid_response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  /** Serverens stabile fejlkode, fx "CLIENT_TOO_OLD" */
  readonly appCode: string | null;

  constructor(
    message: string,
    kind: ApiErrorKind,
    status?: number,
    appCode: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.appCode = appCode;
  }
}

/**
 * Serveren afviste kaldet, fordi denne extension-version er for gammel.
 * Intet er gemt, men det er ikke en "rigtig" afvisning af posten: efter
 * opdateringen lykkes samme kald — så offline-køen må ikke opgive den.
 */
export function isClientTooOld(error: unknown): boolean {
  return error instanceof ApiError && error.appCode === "CLIENT_TOO_OLD";
}

/**
 * True kun når serveren med sikkerhed har afvist kaldet (4xx, fx validering
 * eller et projekt der ikke findes) — så er intet gemt, og et nyt forsøg med
 * samme input vil fejle igen. Timeout, netværksfejl, 5xx (inkl. 502/504 fra
 * proxyen) og uforståelige svar er usikre: posten KAN være gemt.
 */
export function isDefiniteRejection(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.kind !== "http") return false;
  const status = error.status ?? 0;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Den del af et tRPC-fejlsvar, vi læser (med og uden superjson). */
interface TrpcErrorBody {
  error?: {
    json?: { message?: unknown; code?: unknown; data?: { code?: unknown } };
    data?: { code?: unknown };
    message?: unknown;
    code?: unknown;
  };
}

/**
 * tRPC's strengkode ("UNAUTHORIZED", "BAD_REQUEST" …). Den ligger i
 * `error.json.data.code`; `error.json.code` er JSON-RPC-tallet (fx -32001).
 * REST-svar har koden direkte i `error.code`.
 */
export function trpcErrorCode(body: unknown): string | null {
  const error = (body as TrpcErrorBody | null)?.error;
  if (!error || typeof error !== "object") return null;
  const candidates = [
    error.json?.data?.code,
    error.data?.code,
    error.json?.code,
    error.code,
  ];
  for (const code of candidates) {
    if (typeof code === "string" && code) return code;
  }
  return null;
}

const CODE_MESSAGE_KEYS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "TIMEOUT",
  "TOO_MANY_REQUESTS",
  "INTERNAL_SERVER_ERROR",
  "BAD_REQUEST",
  "PARSE_ERROR",
]);

function codeMessage(code: string): string | undefined {
  return CODE_MESSAGE_KEYS.has(code) ? t(`errors.api.${code}`) : undefined;
}

/** Koder hvor serverens egen besked aldrig er til brugeren. */
const ALWAYS_GENERIC = new Set([
  "UNAUTHORIZED",
  "INTERNAL_SERVER_ERROR",
  "TOO_MANY_REQUESTS",
  "PARSE_ERROR",
]);

/** Rå JSON (fx zod-valideringens issues) må aldrig nå brugeren. */
function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Brugerens besked for et tRPC-fejlsvar. Serverens danske besked bevares
 * (fx "Der kører allerede en timer" eller klippekort-fejl, som stop-flowet
 * genkender), men rå JSON og tekniske koder oversættes.
 */
export function trpcErrorMessage(body: unknown, fallback?: string): string {
  const error = (body as TrpcErrorBody | null)?.error;
  const code = trpcErrorCode(body);
  const rawMessage = error?.json?.message ?? error?.message;
  const message = typeof rawMessage === "string" ? rawMessage : "";
  if (code && ALWAYS_GENERIC.has(code)) return t(`errors.api.${code}`);
  if (message && !looksLikeJson(message)) return message;
  return (code && codeMessage(code)) || fallback || t("errors.api.fallback");
}

/** Brugerens besked for et fejlsvar som tekst (fx fra `response.text()`). */
export function errorTextMessage(text: string, fallback: string): string {
  try {
    return trpcErrorMessage(JSON.parse(text), fallback);
  } catch {
    // Proxyens HTML-fejlside eller tom krop
    return fallback;
  }
}

/** Besked ved netværksfejl, på det aktive sprog. */
export function noConnectionMessage(): string {
  return t("errors.noConnection");
}

/**
 * Fejl → dansk tekst til brugeren. Browserens egne netværksfejl
 * ("Failed to fetch", "signal is aborted …") oversættes.
 */
export function userErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return noConnectionMessage();
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return noConnectionMessage();
  }
  if (error instanceof Error && error.message) {
    return looksLikeJson(error.message) ? fallback : error.message;
  }
  return fallback;
}
