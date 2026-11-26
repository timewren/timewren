/**
 * Offentlig demo (demo.timewren.com): én kontakt, `DEMO_MODE=1`, for alt det
 * demoen gør anderledes. Uden variablen er hver eneste ændring en no-op, så
 * timetrack.dk, beta og selvhostere opfører sig som før. Se docs/demo.md.
 *
 * Serveren læser env ved kørsel. Browseren læser `window.__TT_CONFIG__.demo`,
 * som /runtime-config.js kun sætter i demo-tilstand (runtime-env.ts), så
 * server og klient altid er enige. Modulet har ingen afhængigheder og kan
 * bruges i middleware (edge) og klientkode.
 */

export const DEMO_CURRENCY = "EUR";
export type DemoCurrency = typeof DEMO_CURRENCY | "DKK";
export const EUR_DEMO_EMAIL_PREFIX = "demo-eur-";

let resolveServerCurrency: (() => DemoCurrency | undefined) | undefined;

export function registerDemoCurrencyResolver(
  resolve: () => DemoCurrency | undefined,
): void {
  resolveServerCurrency = resolve;
}

/**
 * Valutaen, beløb vises i. Demoen vælger den pr. demokonto; uden for demoen
 * følger den organisationens valuta (src/lib/org/region.ts, fund 19), som
 * serveren sætter for kaldet (tRPC) og på <html data-demo-currency>. Uden
 * noget sat er den DKK som før.
 */
export function activeDemoCurrency(): DemoCurrency {
  if (typeof window !== "undefined") {
    return document.documentElement.dataset.demoCurrency === DEMO_CURRENCY
      ? DEMO_CURRENCY
      : "DKK";
  }
  return resolveServerCurrency?.() ?? "DKK";
}

const DEMO_MODE_ENV = "DEMO_MODE";

/** Er instansen den offentlige demo? */
export function isDemoMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (typeof window !== "undefined") {
    return window.__TT_CONFIG__?.demo === true;
  }
  // Dynamisk nøgle: Next inliner den ikke ved build.
  return env[DEMO_MODE_ENV] === "1";
}

/**
 * Reserveret domæne (RFC 2606) til demobrugernes adresser. Ingen mail kan
 * nogensinde nå frem, og oprydningen sletter kun brugere på dette domæne.
 */
export const DEMO_EMAIL_DOMAIN = "demo.invalid";

export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

/** The reserved demo address records the currency used to seed the account. */
export function demoCurrencyForEmail(
  email: string | null | undefined,
): DemoCurrency {
  return isDemoMode() &&
    isDemoEmail(email) &&
    email?.startsWith(EUR_DEMO_EMAIL_PREFIX)
    ? DEMO_CURRENCY
    : "DKK";
}

/** Demodata slettes, når brugeren er ældre end dette. */
export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;

/** Højst så mange levende demobrugere ad gangen (global loft). */
export const DEMO_MAX_LIVE_USERS = 500;

/** Fejlkoden for "ikke tilgængelig i demoen" (API-svar og ?error= i URL'en). */
export const DEMO_UNAVAILABLE_CODE = "demo_unavailable";

/** Til logs: én teknisk linje, aldrig modtagere eller indhold. */
export function logDemoSuppressed(what: string): void {
  console.info(`[Demo] ${what} ikke sendt (DEMO_MODE=1)`);
}
