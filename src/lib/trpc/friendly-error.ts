import type { TRPCClientError, TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { LOCALES } from "@/i18n/config";
import { syncT } from "@/i18n/sync-text";
import { isNetworkError } from "@/lib/offline/queue";
import type { AppRouter } from "@/lib/trpc/routers";

// Sproget i browseren (html lang, sat af layoutet); uden dokument (tests, server) dansk.
function currentLocale(): string | null {
  return typeof document === "undefined" ? null : document.documentElement.lang;
}

function msg(key: string): string {
  return syncT(key, undefined, currentLocale());
}

// Danske standardtekster; brug `friendlyErrorMessage` til den tekst brugeren ser.
export const NETWORK_ERROR_MESSAGE = syncT("friendly.network");
export const SERVER_ERROR_MESSAGE = syncT("friendly.server");

function isServerErrorMessage(message: string): boolean {
  return LOCALES.some(
    (l) => syncT("friendly.server", undefined, l) === message,
  );
}

// Browsernes egne tekster, når fetch ikke når serveren (Chrome, Firefox,
// Safari, React Native/undici). Firefox' variant er Sentry TIMETRACK-1T.
const NETWORK_FAILURE =
  /^(failed to fetch|networkerror when attempting to fetch resource\.?|load failed|network request failed|fetch failed)$/i;

// Svaret var ikke tRPC-JSON: typisk proxyens HTML-fejlside under et deploy.
const NOT_JSON_RESPONSE =
  /unexpected token|is not valid json|json\.parse|unexpected end of json|unable to transform response/i;

// Rå fejltekst fra database, runtime og Node, som aldrig er skrevet til
// brugeren. Bevidste beskeder i routerne er hele sætninger og rammes ikke.
const TECHNICAL_MESSAGE =
  /failed query|violates|duplicate key|relation "|column "|syntax error|ECONN|ETIMEDOUT|EAI_AGAIN|cannot read propert|is not a function|is not defined|is not iterable|of undefined|of null|TypeError|ReferenceError|internal server error/i;

// Tekster, når serveren kun har sendt koden (TRPCError uden message).
const CODE_MESSAGE_KEYS: Record<string, string> = {
  UNAUTHORIZED: "friendly.unauthorized",
  FORBIDDEN: "friendly.forbidden",
  NOT_FOUND: "friendly.notFound",
  TOO_MANY_REQUESTS: "friendly.tooManyRequests",
  TIMEOUT: "friendly.server",
  INTERNAL_SERVER_ERROR: "friendly.server",
  BAD_GATEWAY: "friendly.server",
  SERVICE_UNAVAILABLE: "friendly.server",
  GATEWAY_TIMEOUT: "friendly.server",
};

type ErrorLike = {
  message: string;
  data?: { code?: string } | null;
  cause?: unknown;
};

function isAbort(error: ErrorLike): boolean {
  const cause = error.cause as { name?: string } | undefined;
  return cause?.name === "AbortError";
}

function isZodIssueList(message: string): boolean {
  if (!message.trimStart().startsWith("[")) return false;
  try {
    const parsed: unknown = JSON.parse(message);
    return (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((i) => i && typeof i === "object" && "code" in i)
    );
  } catch {
    return false;
  }
}

/**
 * Den besked brugeren skal se i stedet for fejlens rå tekst, eller null når
 * beskeden allerede er skrevet til brugeren (bevidste TRPCError-tekster).
 */
export function friendlyErrorMessage(error: ErrorLike): string | null {
  if (isAbort(error)) return null;
  const message = error.message.trim();
  const code = error.data?.code;

  if (!code) {
    // Intet tRPC-svar fra serveren: nettet eller proxyen fejlede.
    if (NETWORK_FAILURE.test(message)) return msg("friendly.network");
    if (NOT_JSON_RESPONSE.test(message)) return msg("friendly.server");
    return null;
  }

  if (message === code && CODE_MESSAGE_KEYS[code]) {
    return msg(CODE_MESSAGE_KEYS[code]);
  }
  if (code === "BAD_REQUEST" && isZodIssueList(message)) {
    return msg("friendly.validation");
  }
  if (
    (code === "INTERNAL_SERVER_ERROR" || code === "TIMEOUT") &&
    TECHNICAL_MESSAGE.test(message)
  ) {
    return msg("friendly.server");
  }
  return null;
}

/**
 * Hvilken handling en fejl-toast skal tilbyde: "Prøv igen" når fejlen er
 * forbigående (net, 5xx, proxy), "Log ind" når sessionen er udløbet, ellers
 * ingen (valideringsfejl og bevidste afvisninger hjælper et nyt forsøg ikke).
 */
export function errorToastAction(error: unknown): "retry" | "login" | null {
  if (!error || typeof error !== "object") return null;
  const e = error as ErrorLike & { data?: { httpStatus?: number } | null };
  if (e.data?.code === "UNAUTHORIZED") return "login";
  if (isNetworkError(error)) return "retry";
  const status = e.data?.httpStatus;
  if (status !== undefined) return status >= 500 ? "retry" : null;
  return isServerErrorMessage(e.message) ? "retry" : null;
}

/**
 * tRPC-link, der giver fejl en dansk besked, før komponenterne ser dem.
 * Sider viser typisk `error.message` i en toast; uden linket var det
 * "Failed to fetch", zod-JSON eller databasefejl. Fejlobjektet bevares
 * (kode, data, cause), kun beskeden skiftes.
 */
export const friendlyErrorLink: () => TRPCLink<AppRouter> =
  () =>
  () =>
  ({ next, op }) =>
    observable((observer) => {
      const subscription = next(op).subscribe({
        next: (value) => observer.next(value),
        error: (error: TRPCClientError<AppRouter>) => {
          const friendly = friendlyErrorMessage(error);
          if (friendly) error.message = friendly;
          observer.error(error);
        },
        complete: () => observer.complete(),
      });
      return subscription;
    });
