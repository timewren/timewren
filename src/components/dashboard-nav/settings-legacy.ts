import { settingsNavGroups } from "./navigation-config";

const SETTINGS_ROOT = "/dashboard/settings";

/**
 * Gamle eller gættede adresser under /dashboard/settings/… og hvor de bor nu.
 * Nøglen er første URL-led med små bogstaver.
 */
const LEGACY_DESTINATIONS: Record<string, string> = {
  // Slettet i marts 2026 (8e8e8687), indholdet flyttede ind på andre sider
  pwa: "/dashboard/settings/notifications#pwa",
  "email-activity": "/dashboard/settings/email?tab=aktivitet",
  // Gængse navne, folk skriver eller har i gamle bogmærker og mails
  billing: "/dashboard/settings/subscription",
  betaling: "/dashboard/settings/subscription",
  abonnement: "/dashboard/settings/subscription",
  plan: "/dashboard/settings/subscription",
  profile: SETTINGS_ROOT,
  profil: SETTINGS_ROOT,
  account: SETTINGS_ROOT,
  konto: SETTINGS_ROOT,
  appearance: "/dashboard/settings#udseende",
  theme: "/dashboard/settings#udseende",
  rounding: "/dashboard/settings#afrunding",
  afrunding: "/dashboard/settings#afrunding",
  password: "/dashboard/settings/security#adgangskode",
  "2fa": "/dashboard/settings/security#to-faktor",
  passkeys: "/dashboard/settings/security#passkeys",
  team: "/dashboard/organization",
  members: "/dashboard/organization",
  medlemmer: "/dashboard/organization",
  organization: "/dashboard/organization",
  organisation: "/dashboard/organization",
  permissions: "/dashboard/organization/permissions",
  audit: "/dashboard/organization/audit",
  virksomhed: "/dashboard/settings/company",
  export: "/dashboard/settings/data",
  eksport: "/dashboard/settings/data",
};

/** Eksisterende indstillingssider efter første URL-led (fx "security"). */
const KNOWN_PAGES: Record<string, string> = Object.fromEntries(
  settingsNavGroups
    .flatMap((group) => group.items)
    .map((item) => item.href.split("?")[0])
    .filter((href) => href.startsWith(`${SETTINGS_ROOT}/`))
    .map((href) => [href.slice(SETTINGS_ROOT.length + 1).split("/")[0], href]),
);

/**
 * Hvor skal en ukendt adresse under /dashboard/settings hen? Gamle og
 * gættede navne går til deres nye hjem, en kendt side med et ukendt
 * underled går til siden, og alt andet til indstillingsforsiden. Svaret er
 * altid en intern sti, så den kan sendes direkte til redirect().
 */
export function legacySettingsDestination(segments: string[]): string {
  const first = (segments[0] ?? "").toLowerCase();
  // Object.hasOwn: "constructor" o.l. må ikke slå igennem fra prototypen
  if (Object.hasOwn(LEGACY_DESTINATIONS, first)) {
    return LEGACY_DESTINATIONS[first];
  }
  if (Object.hasOwn(KNOWN_PAGES, first)) return KNOWN_PAGES[first];
  return SETTINGS_ROOT;
}
