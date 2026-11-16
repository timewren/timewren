import * as Sentry from "@sentry/nextjs";

/**
 * Capture an exception to Sentry with route context.
 * Use in API routes, webhooks, and cron jobs.
 */
export function captureRouteError(
  error: unknown,
  context: {
    route: string;
    type?: "webhook" | "cron" | "api";
    userId?: string;
    extra?: Record<string, unknown>;
  },
) {
  Sentry.captureException(error, {
    tags: {
      source: context.type || "api",
      route: context.route,
    },
    user: context.userId ? { id: context.userId } : undefined,
    extra: context.extra,
  });
}

type ServerMessageOptions = Pick<
  Sentry.Event,
  "level" | "tags" | "fingerprint" | "user" | "extra"
>;

/**
 * Send en driftsbesked (ikke en fejl) til Sentry fra serveren.
 *
 * Brug denne i stedet for Sentry.captureMessage på serveren: Next-SDK'et
 * hænger en syntetisk stacktrace på beskeden, og så navngiver Sentry issuet
 * efter den minificerede funktion i øverste frame ("C" i TIMETRACK-1W/1Z).
 * captureEvent sender beskeden uden stacktrace, så titlen er selve teksten.
 */
export function captureServerMessage(
  message: string,
  options: ServerMessageOptions = {},
) {
  Sentry.captureEvent({ ...options, message, level: options.level ?? "info" });
}
