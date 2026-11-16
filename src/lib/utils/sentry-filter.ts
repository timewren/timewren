import type { Event, EventHint } from "@sentry/nextjs";
import { isNetworkError } from "@/lib/offline/queue";

const MALFORMED_ROUTER_STATE_MESSAGE =
  "The router state header was sent but could not be parsed.";

type HeaderBag =
  | Headers
  | Record<string, unknown>
  | Array<[string, unknown]>
  | undefined;

function headerValue(headers: HeaderBag, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const lowerName = name.toLowerCase();

  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === lowerName);
    return match ? String(match[1]) : undefined;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value == null ? undefined : String(value);
    }
  }

  return undefined;
}

function normalizeHostname(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();

  if (trimmed.startsWith("[")) {
    const bracketEnd = trimmed.indexOf("]");
    return bracketEnd === -1 ? trimmed : trimmed.slice(1, bracketEnd);
  }

  return trimmed;
}

function hostnameFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return undefined;
  }
}

function hostnameFromHostHeader(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();

  if (trimmed.startsWith("[")) {
    const bracketEnd = trimmed.indexOf("]");
    return bracketEnd === -1 ? trimmed : trimmed.slice(1, bracketEnd);
  }

  return trimmed.split(":")[0];
}

function decodeHeader(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasMalformedRouterStateError(event: Event): boolean {
  return (event.exception?.values ?? []).some((exception) =>
    String(exception.value ?? "").includes(MALFORMED_ROUTER_STATE_MESSAGE),
  );
}

function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split(".");

  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

function isLoopbackHost(hostname: string | undefined): boolean {
  if (!hostname) {
    return false;
  }

  const normalized = hostname.toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    isLoopbackIpv4(normalized)
  );
}

export function shouldDropLocalhostEvent(event: Event): boolean {
  const headers = event.request?.headers as HeaderBag;
  const requestHost = hostnameFromUrl(event.request?.url);
  const headerHost = hostnameFromHostHeader(headerValue(headers, "host"));

  return isLoopbackHost(requestHost) || isLoopbackHost(headerHost);
}

export function shouldDropMalformedRouterStateEvent(event: Event): boolean {
  const headers = event.request?.headers as HeaderBag;
  const routerStateTree = decodeHeader(
    headerValue(headers, "next-router-state-tree"),
  );

  // Navigation/prefetch med et træ fra en ældre build (TIMETRACK-1S): Next
  // svarer 500, og klienten laver selv en fuld sideindlæsning af den nye
  // build. Fanen har intet at rette, og fanerne undgår det nu selv, når de
  // ved, at de er forældede (lib/pwa/stale-build.ts).
  if (
    event.request?.method === "GET" &&
    hasMalformedRouterStateError(event) &&
    headerValue(headers, "rsc") === "1"
  ) {
    return true;
  }

  return (
    event.request?.method === "POST" &&
    hasMalformedRouterStateError(event) &&
    headerValue(headers, "rsc") === "1" &&
    headerValue(headers, "next-action") === "x" &&
    routerStateTree === '[""]'
  );
}

// dataCollection.httpBodies styrer kun, om SDK'et selv læser bodies. En body,
// der allerede ligger på scopet (fx fra Pages-routerens request), sendes
// stadig, så serveren fjerner den her. Request-bodies kan rumme persondata.
export function withoutRequestBody<T extends Event>(event: T): T {
  if (event.request?.data === undefined) {
    return event;
  }

  const { data: _data, ...request } = event.request;
  return { ...event, request };
}

// Scripts, TimeTrack ikke selv indlæser, men som browserudvidelser og
// oversættelsesværktøjer sprøjter ind (Sentry TIMETRACK-1V: Googles
// apis.google.com/js/client.js blokeret af CSP eller adblock). Begynder
// appen selv at bruge et af dem, skal det fjernes herfra.
const FOREIGN_SCRIPT_PATTERN = /https?:\/\/apis\.google\.com\/js\//;
const EXTENSION_SCHEME =
  /^(chrome|moz|safari|safari-web|ms-browser)-extension:/;
// Browserens maskering af en fejl i et script fra en anden origin uden CORS:
// ingen besked og ingen stack, kun sidens egen URL som ramme. Egne scripts
// maskeres aldrig, så der er intet at rette (Sentry TIMETRACK-24).
const OPAQUE_SCRIPT_ERROR = /^Script error\.?$/;
// Fejl fra browserudvidelsers runtime-API. TimeTracks side kalder aldrig
// selv runtime-API'et (Sentry TIMETRACK-25).
const EXTENSION_API_MESSAGE =
  /\bruntime\.(sendMessage|connect)\(|Extension context invalidated/;

function frameSource(
  filename: string | undefined,
  origin: string,
): "own" | "foreign" | "unknown" {
  if (!filename) return "unknown";
  if (EXTENSION_SCHEME.test(filename)) return "foreign";
  if (filename.startsWith("/") || filename.startsWith("app://")) return "own";
  try {
    return new URL(filename).origin === origin ? "own" : "foreign";
  } catch {
    // "<anonymous>", "[native code]" og lignende siger intet om kilden.
    return "unknown";
  }
}

/**
 * Fejl, som ikke kommer fra TimeTracks egen kode: enten et fremmed script,
 * der ikke kunne indlæses, eller en stack der kun ligger i
 * browserudvidelser og fremmede scripts. De kan ikke rettes her, så de
 * sendes ikke til Sentry.
 */
export function shouldDropThirdPartyScriptEvent(
  event: Event,
  origin: string,
): boolean {
  const exceptions = event.exception?.values ?? [];
  const texts = [event.message, ...exceptions.map((e) => e.value)];
  if (
    texts.some(
      (text) =>
        text &&
        (FOREIGN_SCRIPT_PATTERN.test(text) ||
          OPAQUE_SCRIPT_ERROR.test(text.trim())),
    )
  ) {
    return true;
  }

  const sources = exceptions.flatMap((e) =>
    (e.stacktrace?.frames ?? []).map((f) => frameSource(f.filename, origin)),
  );
  if (sources.includes("own")) return false;
  return (
    sources.includes("foreign") ||
    texts.some((text) => text && EXTENSION_API_MESSAGE.test(text))
  );
}

const UNHANDLED_REJECTION = "auto.browser.global_handlers.onunhandledrejection";

/**
 * Ufanget afvisning af et tRPC-kald (typisk `await x.mutateAsync()` uden
 * catch, hvor mutationens onError allerede viser fejlen for brugeren).
 * Har serveren svaret, er en 5xx allerede sendt til Sentry fra serveren med
 * fuld kontekst, og en 4xx er en forventet afvisning; en netværksfejl er
 * brugerens forbindelse (Sentry TIMETRACK-1T). tRPC-fejl uden svar fra
 * serveren (fx et svar der ikke kunne læses) sendes stadig.
 */
export function shouldDropUnhandledTrpcRejection(
  event: Event,
  hint: EventHint | undefined,
): boolean {
  const unhandled = (event.exception?.values ?? []).some(
    (e) => e.mechanism?.type === UNHANDLED_REJECTION,
  );
  const error = hint?.originalException;
  if (!unhandled || !(error instanceof Error)) return false;
  if (error.name !== "TRPCClientError") return false;
  const data = (error as { data?: { httpStatus?: number } | null }).data;
  return typeof data?.httpStatus === "number" || isNetworkError(error);
}
