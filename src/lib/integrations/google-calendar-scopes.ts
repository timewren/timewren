import { syncT } from "@/i18n/sync-text";
// Google Calendar OAuth-scopes og adgangsniveau.
//
// Mindste rettigheder som standard: en ny forbindelse beder kun om læseadgang.
// Skriveadgang (calendar.events) bedes der om via inkrementel autorisation,
// først når brugeren slår en skrivende funktion til.
//
// Modulet er rent (ingen DB, ingen googleapis), så det kan bruges både på
// serveren og i klienten og unit-testes direkte.

export const GOOGLE_SCOPE_CALENDAR_READONLY =
  "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_SCOPE_CALENDAR_EVENTS =
  "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_SCOPE_USERINFO_EMAIL =
  "https://www.googleapis.com/auth/userinfo.email";

// Fuld kalenderadgang. Vi beder aldrig selv om den, men giver den skriveadgang
// hvis den af en eller anden grund står i et token.
const GOOGLE_SCOPE_CALENDAR_FULL = "https://www.googleapis.com/auth/calendar";

/** Scopes en ny forbindelse beder om: kun læsning. */
export const GOOGLE_CALENDAR_READ_SCOPES = [
  GOOGLE_SCOPE_CALENDAR_READONLY,
  GOOGLE_SCOPE_USERINFO_EMAIL,
] as const;

/** Scopes der bedes om når brugeren giver skriveadgang. */
export const GOOGLE_CALENDAR_WRITE_SCOPES = [
  ...GOOGLE_CALENDAR_READ_SCOPES,
  GOOGLE_SCOPE_CALENDAR_EVENTS,
] as const;

const WRITE_SCOPES = new Set([
  GOOGLE_SCOPE_CALENDAR_EVENTS,
  GOOGLE_SCOPE_CALENDAR_FULL,
]);

export type GoogleCalendarAccessLevel = "read" | "read_write";

/** Standardtekst (dansk); brug `calendarWriteAccessRequiredMessage()` til kaldets sprog. */
export const CALENDAR_WRITE_ACCESS_REQUIRED_MESSAGE = syncT(
  "integrations.google.readOnly",
);

export function calendarWriteAccessRequiredMessage(): string {
  return syncT("integrations.google.readOnly");
}

export function getAuthScopes(options: { write?: boolean } = {}): string[] {
  return options.write
    ? [...GOOGLE_CALENDAR_WRITE_SCOPES]
    : [...GOOGLE_CALENDAR_READ_SCOPES];
}

/** Google returnerer givne scopes som en mellemrumsadskilt streng. */
export function parseScopes(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return [...new Set(scope.split(/\s+/).filter(Boolean))];
}

/**
 * Normalisér token-svarets `scope` til den streng vi gemmer. Returnerer null
 * når Google ikke sendte scopes med, så kaldet kan beholde den gamle værdi.
 */
export function normalizeGrantedScopes(
  scope: string | null | undefined,
): string | null {
  const scopes = parseScopes(scope);
  return scopes.length > 0 ? scopes.sort().join(" ") : null;
}

/**
 * Har forbindelsen skriveadgang?
 *
 * `null` betyder at scopes aldrig er registreret: forbindelsen er oprettet
 * før read-only-standarden, hvor alle fik calendar.events. De fortsætter
 * uændret med skriveadgang (ingen tvungen gen-autorisation).
 */
export function hasCalendarWriteAccess(
  grantedScopes: string | null | undefined,
): boolean {
  if (grantedScopes === null || grantedScopes === undefined) return true;
  return parseScopes(grantedScopes).some((s) => WRITE_SCOPES.has(s));
}

export function getCalendarAccessLevel(
  grantedScopes: string | null | undefined,
): GoogleCalendarAccessLevel {
  return hasCalendarWriteAccess(grantedScopes) ? "read_write" : "read";
}

/** Kræver denne synkroniseringsretning, at vi skriver til Google? */
export function syncDirectionRequiresWrite(
  direction: string | null | undefined,
): boolean {
  return direction === "outbound" || direction === "both";
}
