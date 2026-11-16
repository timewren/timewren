import type { BrowserOptions } from "@sentry/nextjs";

// Sentry bruges KUN til fejl, og der må ikke følge persondata med. Fra v11 er
// sendDefaultPii fjernet, og uden dataCollection indsamler SDK'et brugerinfo,
// cookies, headere, bodies, query-parametre og lokale variabler. Én delt
// konstant til browser, server og edge, så de tre init-filer ikke glider fra
// hinanden.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/migration/v10-to-v11/
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  // Kun de request-headere, sentry-filter.ts skal bruge for at droppe støj
  // (localhost og forældede RSC-kald). Ingen af dem bærer persondata. Sentry
  // matcher på delstrenge uden store/små bogstaver; øvrige headere sendes
  // som "[Filtered]".
  httpHeaders: {
    request: {
      allow: ["host", "rsc", "next-action", "next-router-state-tree"],
    },
    response: false,
  },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies NonNullable<BrowserOptions["dataCollection"]>;
