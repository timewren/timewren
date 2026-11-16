// Initialiserer Sentry i browseren. Next indlæser instrumentation-client.ts
// selv (også med Turbopack og uden withSentryConfig, som Docker-buildet
// springer over med SENTRY_DISABLED=1). Den gamle sentry.client.config.ts blev
// kun injiceret af Sentrys build-plugin og kørte derfor aldrig i prod.
//
// NEXT_PUBLIC_SENTRY_DSN bages ind ved build — den skal gives som build-arg
// (se Dockerfile og ci.yml), Dokploys runtime-env når ikke klienten.
// NEXT_PUBLIC_SENTRY_BROWSER_ENABLED=false slår browser-Sentry fra (default til).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import {
  BrowserClient,
  dedupeIntegration,
  defaultStackParser,
  getCurrentScope,
  globalHandlersIntegration,
  httpContextIntegration,
  linkedErrorsIntegration,
  makeFetchTransport,
} from "@sentry/browser";

import { hardNavigateIfStale } from "@/lib/pwa/stale-build";
import { SENTRY_DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { resolveSentryEnvironment } from "@/lib/utils/sentry-environment";
import {
  shouldDropLocalhostEvent,
  shouldDropThirdPartyScriptEvent,
  shouldDropUnhandledTrpcRejection,
} from "@/lib/utils/sentry-filter";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const browserEnabled =
  process.env.NEXT_PUBLIC_SENTRY_BROWSER_ENABLED !== "false";

const client = new BrowserClient({
  transport: makeFetchTransport,
  stackParser: defaultStackParser,
  integrations: [
    globalHandlersIntegration(),
    dedupeIntegration(),
    linkedErrorsIntegration(),
    httpContextIntegration(),
  ],
  dsn,
  enabled: browserEnabled && Boolean(dsn),

  // Beta og prod kører begge med NODE_ENV=production (#764). I browseren
  // afgør hostnavnet, medmindre NEXT_PUBLIC_SENTRY_ENVIRONMENT er bagt ind.
  environment: resolveSentryEnvironment({
    explicit: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    hostname: window.location.hostname,
    nodeEnv: process.env.NODE_ENV,
  }),

  // Kun fejl: ingen tracing (tracesSampleRate udeladt, så v11's span-
  // streaming optager intet), ingen trace-headere på udgående kald, ingen
  // session replay og ingen persondata.
  dataCollection: SENTRY_DATA_COLLECTION,
  sendClientReports: false,
  tracePropagationTargets: [],

  beforeSend(event, hint) {
    if (
      shouldDropLocalhostEvent(event) ||
      shouldDropThirdPartyScriptEvent(event, window.location.origin) ||
      shouldDropUnhandledTrpcRejection(event, hint)
    ) {
      return null;
    }

    return event;
  },

  debug: false,
});

getCurrentScope().setClient(client);
client.init();

// Fanen kører en gammel build (se lib/pwa/stale-build.ts): navigér med en
// fuld sideindlæsning i stedet for et RSC-kald, som den nye server måske
// ikke kan læse (Sentry TIMETRACK-1S).
export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  hardNavigateIfStale(url, navigationType);
}
