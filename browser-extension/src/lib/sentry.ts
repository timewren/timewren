import { captureException, captureMessage, init } from "@sentry/browser";
import { ApiError } from "./api-error";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let initialized = false;

/**
 * The extension token travels in the `input` query param of every GET tRPC
 * request (a tRPC-over-GET constraint). Redact that param from any URL Sentry
 * would otherwise capture (fetch breadcrumbs, request URLs) so the bearer
 * token never reaches Sentry's infrastructure.
 */
function scrubUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const u = new URL(url);
    if (u.searchParams.has("input")) {
      u.searchParams.set("input", "[redacted]");
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

const IS_FIREFOX = import.meta.env.MODE === "firefox";

/**
 * Firefox: fejlrapporter er en valgfri datatype (technicalAndInteraction i
 * manifestets data_collection_permissions). De sendes kun, hvis brugeren har
 * givet lov. Ældre Firefox uden den API sender intet.
 */
async function mayReportErrors(): Promise<boolean> {
  if (!IS_FIREFOX) return true;
  try {
    return await chrome.permissions.contains({
      data_collection: ["technicalAndInteraction"],
    } as chrome.permissions.Permissions);
  } catch {
    return false;
  }
}

/** Kun fejl: ingen tracing, ingen ydelsesmålinger. */
export function initSentry(context: "popup" | "newtab" | "background") {
  if (initialized || !DSN) return;
  initialized = true;
  void mayReportErrors().then((allowed) => {
    if (allowed) startSentry(context);
  });
}

function startSentry(context: "popup" | "newtab" | "background") {
  init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    release: `timetrack-extension@${chrome.runtime.getManifest().version}`,
    beforeBreadcrumb(breadcrumb) {
      if (
        (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") &&
        breadcrumb.data?.url
      ) {
        const scrubbed = scrubUrl(breadcrumb.data.url);
        if (scrubbed) breadcrumb.data.url = scrubbed;
      }
      return breadcrumb;
    },
    beforeSend(event, hint) {
      // Baggrunden kalder serveren hvert minut og afspiller køen igen og
      // igen. Under et nedbrud ville hver bruger sende en fejl pr. kald, så
      // forbigående fejl (timeout, net, 5xx) rapporteres kun fra popup og
      // ny fane.
      if (context === "background" && isTransient(hint.originalException)) {
        return null;
      }
      event.tags = { ...event.tags, extensionContext: context };
      const url = event.request?.url;
      if (url) {
        const scrubbed = scrubUrl(url);
        if (scrubbed && event.request) event.request.url = scrubbed;
      }
      return event;
    },
  });
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return (
    error.kind === "timeout" ||
    error.kind === "network" ||
    (error.kind === "http" && (error.status ?? 0) >= 500)
  );
}

export const Sentry = { captureException, captureMessage };
