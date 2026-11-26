export const FEATURE_FLAG_KEYS = [
  "calendar",
  "ai",
  "emailToTask",
  "clientPortal",
  "browserExtension",
  "prepaidPackages",
  "accountingSync",
  "notifications",
  "recurringTemplates",
  "organizations",
  "systemAiKey",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export const FEATURE_FLAG_META: Record<
  FeatureFlagKey,
  { label: string; description: string; icon: string }
> = {
  calendar: {
    label: "Kalender Sync",
    description: "Google/Outlook kalender integration og synkronisering",
    icon: "Calendar",
  },
  ai: {
    label: "AI Funktioner",
    description: "AI-baseret opgaveparsing, kategorisering og tidsestimering",
    icon: "Brain",
  },
  emailToTask: {
    label: "Email-to-Task",
    description: "Opret opgaver automatisk fra indgående emails",
    icon: "Mail",
  },
  clientPortal: {
    label: "Kundeportal",
    description: "White-label portal hvor kunder kan se fakturaer og tid",
    icon: "Globe",
  },
  browserExtension: {
    label: "Browser Extension",
    description: "Chrome/Firefox extension til tidstracking",
    icon: "Puzzle",
  },
  prepaidPackages: {
    label: "Klippekort",
    description: "Forudbetalte timepakker med saldosporing",
    icon: "Ticket",
  },
  accountingSync: {
    label: "Bogføring Integration",
    description: "Synkronisering med Billy, Dinero og e-conomic",
    icon: "Calculator",
  },
  notifications: {
    label: "Notifikationer",
    description: "Email, Discord, Slack, Push og SMS notifikationer",
    icon: "Bell",
  },
  recurringTemplates: {
    label: "Gentagende Skabeloner",
    description: "Automatisk generering af tidsregistreringer",
    icon: "RefreshCw",
  },
  organizations: {
    label: "Organisation/Teams",
    description: "Team workspaces og samarbejdsfunktioner",
    icon: "Building2",
  },
  systemAiKey: {
    label: "System AI-nøgle",
    description:
      "Tillad brug af TimeTrack's egen AI-nøgle. Når deaktiveret skal brugere medbringe egen nøgle (BYOK)",
    icon: "KeyRound",
  },
};

/**
 * Standard for et flag, der ikke har en række i feature_flags. Uden række
 * var et flag slået fra, og admin-listen viste kun eksisterende rækker. På en
 * ny installation (selvhostet TimeWren, lokal udvikling) sagde Klippekort,
 * produktets kerne, derfor "deaktiveret af en administrator", uden at en
 * administrator kunne slå det til (gennemgang af første oplevelse,
 * 2026-11-22). Resten er som før: slået fra, til en administrator slår dem til.
 */
export const FEATURE_FLAG_DEFAULTS: Partial<Record<FeatureFlagKey, boolean>> = {
  prepaidPackages: true,
};

export function featureFlagDefault(key: FeatureFlagKey): boolean {
  return FEATURE_FLAG_DEFAULTS[key] ?? false;
}

/** Rækkerne fra feature_flags oven på standarderne. En række vinder altid. */
export function resolveFeatureFlags(
  rows: readonly { key: string; enabled: boolean }[],
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of FEATURE_FLAG_KEYS) {
    if (FEATURE_FLAG_DEFAULTS[key] !== undefined) {
      result[key] = featureFlagDefault(key);
    }
  }
  for (const row of rows) result[row.key] = row.enabled;
  return result;
}
