// src/lib/modules/constants.ts

// IMPORTANT: When you add a new key here, EXISTING orgs will have no
// organizationModules row for it (seedNewOrgModules only seeds new orgs).
// You MUST ship a Drizzle migration that inserts a row for every existing org
// (isAvailable: true, isEnabled: false; enterprise gated by plan-tier), or the
// module will be invisible to existing customers and not self-serve enableable.
export const MODULE_KEYS = [
  "projects",
  "reports",
  "clients",
  "invoicing",
  "klippekort",
  "integrations",
  "tasks",
  "enterprise",
  "public_api",
  "browser_extension",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Bundle applied when migrating existing orgs and via the admin "freelance"
 * preset. Everything except `enterprise`. NOTE: new signups now use
 * `seedNewOrgModules` (opt-in CORE_BUNDLE), not this bundle.
 */
export const FREELANCE_BUNDLE: readonly ModuleKey[] = [
  "projects",
  "reports",
  "clients",
  "invoicing",
  "klippekort",
  "integrations",
  "tasks",
  "public_api",
  "browser_extension",
] as const;

/**
 * Default bundle for orgs created with `metadata.type === "enterprise"`.
 * Internal time tracking + enterprise HR-features, no clients/invoicing.
 */
export const ENTERPRISE_BUNDLE: readonly ModuleKey[] = [
  "projects",
  "reports",
  "tasks",
  "enterprise",
] as const;

/**
 * Kerne-bundle for NYE orgs (opt-in). Disse moduler er tændt fra start;
 * alle øvrige moduler er tilgængelige men slukkede, så brugeren selv kan
 * tænde dem i touren eller under Indstillinger → Moduler.
 */
export const CORE_BUNDLE: readonly ModuleKey[] = [
  "clients",
  "projects",
  "invoicing",
  "reports",
  "klippekort",
] as const;

/**
 * Human-readable labels for UI. Keys must match MODULE_KEYS exactly.
 */
export const MODULE_LABELS: Record<ModuleKey, string> = {
  projects: "Projekter",
  reports: "Rapporter",
  clients: "Kunder",
  invoicing: "Fakturering",
  klippekort: "Klippekort",
  integrations: "Integrationer",
  tasks: "Opgaver",
  enterprise: "Enterprise (flex, ferie, fravær)",
  public_api: "Public API",
  browser_extension: "Browser-udvidelse",
};

/**
 * Description shown under the toggle in settings UI.
 */
export const MODULE_DESCRIPTIONS: Record<ModuleKey, string> = {
  projects:
    "Aktivér projekt-styring. Uden projekter registreres tid kun som generel arbejdstid.",
  reports: "Adgang til rapporter og eksport af tidsdata.",
  clients:
    "Aktivér klientregister og klient-felt på projekter/tidsregistreringer.",
  invoicing:
    "Aktivér fakturering, tilbagevendende fakturaer og fakturerbar-markering.",
  klippekort: "Klippekort (prepaid hours packages) med saldo-tracking.",
  integrations:
    "Integrationer til eksterne regnskabssystemer (Billy, Dinero, e-conomic).",
  tasks: "Opgave-håndtering og pomodoro-timer.",
  enterprise:
    "Afdelinger, medarbejder-profiler, flex-saldo, ferie, fravær, helligdage.",
  public_api: "API-nøgler og programmatisk adgang til jeres data.",
  browser_extension: "Browser-udvidelse til hurtig tidsregistrering.",
};
