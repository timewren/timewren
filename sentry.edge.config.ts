// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { resolveSentryEnvironment } from "@/lib/utils/sentry-environment";
import {
  shouldDropLocalhostEvent,
  withoutRequestBody,
} from "@/lib/utils/sentry-filter";

// Opslag via et alias i stedet for process.env.X, så Next ikke bager
// build-tidens værdi ind: beta og prod skal kunne skilles ad ved runtime.
const runtimeEnv = process.env;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Beta og prod kører begge med NODE_ENV=production (#764)
  environment: resolveSentryEnvironment({
    explicit: runtimeEnv.SENTRY_ENVIRONMENT,
    appUrl: runtimeEnv.NEXT_PUBLIC_APP_URL,
    nodeEnv: process.env.NODE_ENV,
  }),

  // Kun fejl, ingen tracing (tracesSampleRate udeladt) som i browseren.
  // Transaktionerne gav Sentry-performance-issues som "Degraded HTTP
  // Operation" (TIMETRACK-16), som ikke er fejl og ikke kan handles på.
  // Uden tracesSampleRate/tracesSampler optager v11's span-streaming intet.

  // Ingen persondata, se lib/sentry/data-collection.ts.
  dataCollection: SENTRY_DATA_COLLECTION,
  // Ingen client reports (optællinger af droppede spans m.m.): kun fejl.
  sendClientReports: false,

  beforeSend(event) {
    if (shouldDropLocalhostEvent(event)) {
      return null;
    }

    return withoutRequestBody(event);
  },

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
