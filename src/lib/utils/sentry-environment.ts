/**
 * Sentry-miljø for den kørende instans.
 *
 * Beta og prod kører begge med NODE_ENV=production, så NODE_ENV alene kan
 * ikke skille dem ad (#764). Rækkefølge:
 * 1. `explicit` (SENTRY_ENVIRONMENT på serveren, NEXT_PUBLIC_SENTRY_ENVIRONMENT
 *    i browseren), hvis sat.
 * 2. Hostnavnet: browserens `hostname`, ellers hosten i app-URL'en.
 *    `beta.*` giver "beta", localhost giver "development".
 * 3. NODE_ENV.
 */
export function resolveSentryEnvironment(input: {
  explicit?: string;
  hostname?: string;
  appUrl?: string;
  nodeEnv?: string;
}): string {
  const explicit = input.explicit?.trim();
  if (explicit) return explicit;

  const host = input.hostname || hostFromUrl(input.appUrl);
  if (host) {
    if (host.startsWith("beta.")) return "beta";
    if (host === "localhost" || host === "127.0.0.1") return "development";
  }

  return input.nodeEnv === "production" ? "production" : "development";
}

function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
