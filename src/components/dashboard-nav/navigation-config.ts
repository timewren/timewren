import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Building2,
  Calendar,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileCheck2,
  FileText,
  FolderKanban,
  Hourglass,
  House,
  KeyRound,
  Layers,
  LayoutDashboard,
  Plug,
  RefreshCw,
  Settings,
  ShieldCheck,
  Star,
  Table,
  Ticket,
  Users,
} from "lucide-react";
import { brand } from "@/lib/brand";
import type { ModuleKey } from "@/lib/modules/constants";
import { type OrgRole, roleSatisfies } from "@/lib/permissions/org-role";

export interface NavItem {
  name: string;
  translationKey?: string;
  href: string;
  icon: LucideIcon;
  featureFlag?: string;
  requiresModule?: ModuleKey;
  /**
   * rolePermissions module key. When set, the item is hidden if the caller's
   * role has "none" access to it (read/write both show). Distinct from
   * requiresModule, which checks org-level module availability.
   */
  permissionModule?: string;
  /**
   * Minimum org role required to see the item (member < manager < admin <
   * owner). Hidden when the caller's role is unknown or too low.
   */
  minRole?: "manager" | "admin";
  /**
   * Roller der IKKE ser punktet selvom minRole er opfyldt — fx hr (read-all,
   * rang over manager) på Team-godkendelse (#464).
   */
  hideForRoles?: OrgRole[];
  /**
   * Freelance-only feature. Hidden for member/manager in an enterprise-profile
   * org (admin/owner still see everything).
   */
  freelancerOnly?: boolean;
  /**
   * Giver kun mening med kolleger (teamoverblik, ressourceplan). Skjult, når
   * organisationen har ét medlem og ingen ventende invitationer (fund 15).
   */
  teamOnly?: boolean;
  dataTour?: string;
}

export interface NavGroup {
  label: string;
  labelTranslationKey?: string;
  /**
   * Overskrift brugt i enterprise-profil i stedet for `label` (fx "Kunder" →
   * "Projekter"), hvor freelance-begreberne ikke giver mening.
   */
  enterpriseLabel?: string;
  /** Nøgle i nav-kataloget for `enterpriseLabel`. */
  enterpriseLabelTranslationKey?: string;
  items: NavItem[];
}

export type NavRole = OrgRole;
export type OrgProfile = "freelance" | "enterprise";

/**
 * Er rolle-/profil-gatede nav-items stadig ukendte? True mens moduler eller
 * rolle indlæses — men en FEJLET rolle-query afslutter loading (fail-open:
 * serveren håndhæver), så navigationen aldrig forbliver tom.
 */
export function isAclLoading(opts: {
  modulesLoading: boolean;
  modulesPlaceholder: boolean;
  roleLoaded: boolean;
  roleError: boolean;
}): boolean {
  if (opts.modulesLoading || opts.modulesPlaceholder) return true;
  return !opts.roleLoaded && !opts.roleError;
}

/**
 * Er brugeren en enterprise-medarbejder (member/manager i enterprise-profil)?
 * Styrer freelance-UI som timer-baren og dashboard-redirect.
 *
 * `resolved` = afgjort på RIGTIGE data (profil + rolle kendt, eller profil
 * freelance). Uafgjort (profil/rolle indlæses eller rolle-query fejlede)
 * falder tilbage på det sticky localStorage-hint, så freelancere (intet hint
 * eller "0") ser deres UI med det samme, og en kendt enterprise-medarbejder
 * ("1") får det skjult fra første paint.
 */
export function resolveEnterpriseMember(opts: {
  /** Undefined mens moduler indlæses / placeholder / fejl. */
  orgProfile?: OrgProfile;
  role?: NavRole;
  roleLoaded: boolean;
  /** Sticky hint: "1" | "0" | null. */
  hint: string | null;
}): { isMember: boolean; resolved: boolean } {
  if (opts.orgProfile === "freelance") {
    return { isMember: false, resolved: true };
  }
  if (opts.orgProfile === "enterprise" && opts.roleLoaded) {
    return { isMember: !roleSatisfies(opts.role, "admin"), resolved: true };
  }
  return { isMember: opts.hint === "1", resolved: false };
}

/** De felter i et menupunkt, der styrer synligheden (se isNavItemVisible). */
export type NavGating = Pick<
  NavItem,
  | "featureFlag"
  | "requiresModule"
  | "permissionModule"
  | "minRole"
  | "hideForRoles"
  | "freelancerOnly"
  | "teamOnly"
>;

export function isNavItemVisible(
  item: NavGating,
  opts: {
    isFlagEnabled: (flag: string) => boolean;
    isModuleEnabled: (module: ModuleKey) => boolean;
    /** Returns false only when the caller's role has "none" access. */
    canAccessModule?: (permissionModule: string) => boolean;
    /** Caller's effective org role. Undefined = unknown (minRole items hide). */
    role?: NavRole;
    /** Org profile. Undefined is treated as "freelance". */
    orgProfile?: OrgProfile;
    /**
     * Medlemmer plus ventende invitationer. Undefined = ukendt (vises som før).
     */
    teamSize?: number;
  },
): boolean {
  if (item.featureFlag && !opts.isFlagEnabled(item.featureFlag)) return false;
  if (item.requiresModule && !opts.isModuleEnabled(item.requiresModule)) {
    return false;
  }
  if (
    item.permissionModule &&
    opts.canAccessModule &&
    !opts.canAccessModule(item.permissionModule)
  ) {
    return false;
  }
  if (item.minRole && !roleSatisfies(opts.role, item.minRole)) return false;
  if (item.hideForRoles && opts.role && item.hideForRoles.includes(opts.role)) {
    return false;
  }
  if (
    item.freelancerOnly &&
    opts.orgProfile === "enterprise" &&
    !roleSatisfies(opts.role, "admin")
  ) {
    return false;
  }
  if (item.teamOnly && opts.teamSize !== undefined && opts.teamSize <= 1) {
    return false;
  }
  return true;
}

export const mainNavGroups: NavGroup[] = [
  {
    label: "",
    items: [
      {
        name: "Hjem",
        translationKey: "home",
        href: "/dashboard",
        icon: House,
        freelancerOnly: true,
        dataTour: "nav-hjem",
      },
      {
        name: "Overblik",
        translationKey: "overview",
        href: "/dashboard/overblik",
        icon: LayoutDashboard,
        freelancerOnly: true,
        dataTour: "nav-overblik",
      },
      {
        name: "Mine registreringer",
        ...(brand.id === "timewren" ? { translationKey: "myRecords" } : {}),
        href: "/dashboard/my-records",
        icon: FileText,
      },
      {
        name: "Tidsregistrering",
        translationKey: "time",
        href: "/dashboard/time",
        permissionModule: "time",
        icon: Clock,
        freelancerOnly: true,
        dataTour: "nav-tidstracking",
      },
      {
        name: "Opgaver",
        translationKey: "tasks",
        href: "/dashboard/tasks",
        permissionModule: "tasks",
        icon: CheckCircle2,
        requiresModule: "tasks",
      },
      {
        name: "Kalender",
        translationKey: "calendar",
        href: "/dashboard/calendar",
        permissionModule: "calendar",
        icon: Calendar,
        freelancerOnly: true,
      },
      {
        name: "Logbog",
        translationKey: "logbook",
        href: "/dashboard/logbook",
        permissionModule: "time",
        icon: BookOpen,
        freelancerOnly: true,
        dataTour: "nav-logbog",
      },
    ],
  },
  {
    label: "Kunder",
    labelTranslationKey: "groupClients",
    enterpriseLabel: "Projekter",
    enterpriseLabelTranslationKey: "projects",
    items: [
      {
        name: "Kunder",
        translationKey: "clients",
        href: "/dashboard/clients",
        permissionModule: "clients",
        icon: Users,
        requiresModule: "clients",
        dataTour: "nav-klienter",
      },
      {
        name: "Projekter",
        translationKey: "projects",
        href: "/dashboard/projects",
        permissionModule: "projects",
        icon: FolderKanban,
        requiresModule: "projects",
        dataTour: "nav-projekter",
      },
      {
        name: "Klippekort",
        translationKey: "prepaid",
        href: "/dashboard/klippekort",
        permissionModule: "klippekort",
        icon: Ticket,
        featureFlag: "prepaidPackages",
        requiresModule: "klippekort",
        dataTour: "nav-klippekort",
      },
    ],
  },
  {
    label: "Økonomi",
    labelTranslationKey: "groupEconomy",
    enterpriseLabel: "Rapporter",
    enterpriseLabelTranslationKey: "reports",
    items: [
      {
        name: "Fakturaer",
        translationKey: "invoices",
        href: "/dashboard/invoices",
        permissionModule: "invoices",
        icon: FileText,
        requiresModule: "invoicing",
        dataTour: "nav-fakturaer",
      },
      {
        name: "Rapporter",
        translationKey: "reports",
        href: "/dashboard/reports",
        permissionModule: "reports",
        icon: BarChart3,
        requiresModule: "reports",
        dataTour: "nav-rapporter",
      },
      {
        // Lederens dagsoverblik over teamet (hvem arbejdede på hvad, hvornår).
        // Kun admin/ejer — det er kollegers registreringer.
        name: "Teamoverblik",
        translationKey: "teamDay",
        href: "/dashboard/team/day",
        permissionModule: "time",
        icon: ClipboardCheck,
        minRole: "admin",
        teamOnly: true,
      },
      {
        // Planlagte timer pr. medarbejder × projekt mod registreret (#508).
        // Alle i en Team-/Virksomhed-org: lederen planlægger, medlemmet ser
        // sin egen plan.
        name: "Ressourceplan",
        translationKey: "resourcePlan",
        href: "/dashboard/resource-plan",
        icon: CalendarRange,
        teamOnly: true,
      },
    ],
  },
  {
    label: "Enterprise",
    labelTranslationKey: "groupEnterprise",
    items: [
      {
        name: "Oversigt",
        translationKey: "enterpriseOverview",
        href: "/dashboard/enterprise",
        icon: Building2,
        requiresModule: "enterprise",
      },
      {
        name: "Timeseddel",
        translationKey: "timesheet",
        href: "/dashboard/enterprise/timesheet",
        icon: Table,
        requiresModule: "enterprise",
      },
      {
        name: "Team",
        translationKey: "team",
        href: "/dashboard/enterprise/team",
        icon: ClipboardCheck,
        requiresModule: "enterprise",
        minRole: "manager",
        // hr godkender ikke timesedler (#464)
        hideForRoles: ["hr"],
      },
      {
        name: "Medarbejdere",
        translationKey: "employees",
        href: "/dashboard/enterprise/employees",
        icon: Users,
        requiresModule: "enterprise",
        minRole: "manager",
      },
      {
        name: "Ferie & fravær",
        translationKey: "absence",
        href: "/dashboard/enterprise/absence",
        icon: Calendar,
        requiresModule: "enterprise",
      },
      {
        name: "Flex",
        translationKey: "flex",
        href: "/dashboard/enterprise/flex",
        icon: Clock,
        requiresModule: "enterprise",
      },
      {
        name: "Arbejdsplan",
        translationKey: "workPlan",
        href: "/dashboard/enterprise/work-plan",
        icon: CalendarClock,
        requiresModule: "enterprise",
      },
      {
        name: "Periodeafslutning",
        translationKey: "periodClosing",
        href: "/dashboard/enterprise/period-closing",
        icon: FileCheck2,
        requiresModule: "enterprise",
      },
      {
        name: "Afspadsering",
        translationKey: "overtime",
        href: "/dashboard/enterprise/overtime",
        icon: Hourglass,
        requiresModule: "enterprise",
      },
      {
        name: "Rapporter",
        translationKey: "payrollReport",
        href: "/dashboard/enterprise/reports",
        icon: BarChart3,
        requiresModule: "enterprise",
        minRole: "manager",
      },
      {
        name: "Compliance",
        translationKey: "compliance",
        href: "/dashboard/enterprise/compliance",
        icon: ShieldCheck,
        requiresModule: "enterprise",
        minRole: "manager",
      },
      {
        name: "Helligdage",
        translationKey: "holidays",
        href: "/dashboard/enterprise/holidays",
        icon: Star,
        requiresModule: "enterprise",
        minRole: "manager",
      },
      {
        name: "Afdelinger",
        translationKey: "departments",
        href: "/dashboard/enterprise/departments",
        icon: Layers,
        requiresModule: "enterprise",
        minRole: "manager",
      },
      {
        name: "Faste ferieuger",
        translationKey: "closurePeriods",
        href: "/dashboard/enterprise/settings/closure-periods",
        icon: CalendarRange,
        requiresModule: "enterprise",
        minRole: "admin",
      },
      {
        name: "Indstillinger",
        translationKey: "enterpriseSettings",
        href: "/dashboard/enterprise/settings",
        icon: Settings,
        requiresModule: "enterprise",
        minRole: "admin",
      },
    ],
  },
  {
    label: "Værktøjer",
    labelTranslationKey: "groupTools",
    items: [
      {
        name: "Skabeloner",
        translationKey: "templates",
        href: "/dashboard/templates",
        icon: RefreshCw,
        featureFlag: "recurringTemplates",
        freelancerOnly: true,
      },
      {
        name: "Integrationer",
        translationKey: "integrations",
        href: "/dashboard/integrations",
        icon: Plug,
        requiresModule: "integrations",
      },
    ],
  },
];

// Organisationssiderne står bag feature-flaget "organizations"
// (organization/layout.tsx), så menupunkterne skal også.
export const bottomNavItems: NavItem[] = [
  {
    name: "Organisation",
    translationKey: "organization",
    href: "/dashboard/organization",
    icon: Building2,
    featureFlag: "organizations",
    freelancerOnly: true,
  },
  {
    name: "Adgangsstyring",
    translationKey: "permissions",
    href: "/dashboard/organization/permissions",
    icon: KeyRound,
    featureFlag: "organizations",
    freelancerOnly: true,
    minRole: "admin",
  },
];

// Mobile bottom navigation — 5 key destinations
export const mobileBottomNavItems: NavItem[] = [
  {
    name: "Hjem",
    translationKey: "home",
    href: "/dashboard",
    icon: House,
    freelancerOnly: true,
  },
  {
    name: "Tid",
    translationKey: "timeShort",
    href: "/dashboard/time",
    permissionModule: "time",
    icon: Clock,
    freelancerOnly: true,
  },
  {
    name: "Opgaver",
    translationKey: "tasks",
    href: "/dashboard/tasks",
    permissionModule: "tasks",
    icon: CheckCircle2,
    requiresModule: "tasks",
  },
  {
    name: "Kunder",
    translationKey: "clients",
    href: "/dashboard/clients",
    permissionModule: "clients",
    icon: Users,
    requiresModule: "clients",
  },
  {
    name: "Mere",
    translationKey: "more",
    href: "/dashboard/settings",
    icon: Settings,
  },
];

/**
 * "Gå til"-genveje: G efterfulgt af tasten. Bruges af tastaturhåndteringen i
 * DashboardShell og vises i kommandopaletten, så de ikke kan blive uenige.
 */
export const goToShortcuts: {
  key: string;
  href: string;
  label: string;
  /** Nøgle i nav-kataloget; `label` er den danske reserve. */
  labelKey?: string;
}[] = [
  { key: "d", href: "/dashboard", label: "Hjem", labelKey: "home" },
  {
    key: "o",
    href: "/dashboard/overblik",
    label: "Overblik",
    labelKey: "overview",
  },
  {
    key: "t",
    href: "/dashboard/time",
    label: "Tidsregistrering",
    labelKey: "time",
  },
  {
    key: "c",
    href: "/dashboard/clients",
    label: "Kunder",
    labelKey: "clients",
  },
  {
    key: "p",
    href: "/dashboard/projects",
    label: "Projekter",
    labelKey: "projects",
  },
  {
    key: "k",
    href: "/dashboard/klippekort",
    label: "Klippekort",
    labelKey: "prepaid",
  },
  {
    key: "i",
    href: "/dashboard/invoices",
    label: "Fakturaer",
    labelKey: "invoices",
  },
  {
    key: "r",
    href: "/dashboard/reports",
    label: "Rapporter",
    labelKey: "reports",
  },
  {
    key: "s",
    href: "/dashboard/settings",
    label: "Indstillinger",
    labelKey: "settings",
  },
];

/** Genvejen til en side som "G → O", eller undefined. */
export function goToShortcutFor(href: string): string | undefined {
  const shortcut = goToShortcuts.find((s) => s.href === href);
  return shortcut ? `G → ${shortcut.key.toUpperCase()}` : undefined;
}

export const settingsNavItem: NavItem = {
  name: "Indstillinger",
  translationKey: "settings",
  href: "/dashboard/settings",
  icon: Settings,
};

export const settingsSubItems = [
  { name: "Virksomhedsprofil", href: "/dashboard/settings/company" },
  { name: "Sikkerhed", href: "/dashboard/settings/security" },
  { name: "Email", href: "/dashboard/settings/email" },
  { name: "Notifikationer", href: "/dashboard/settings/notifications" },
  { name: "Integrationer", href: "/dashboard/settings/integrations" },
  { name: "AI & Automatisering", href: "/dashboard/settings/ai" },
  { name: "Kundeportal", href: "/dashboard/settings/portal" },
  { name: "API", href: "/dashboard/settings/api" },
  { name: "Import og eksport", href: "/dashboard/settings/data" },
  { name: "Tags", href: "/dashboard/settings/tags" },
  { name: "Abonnement", href: "/dashboard/settings/subscription" },
  { name: "GDPR & Databeskyttelse", href: "/dashboard/settings/gdpr" },
  { name: "Moduler", href: "/dashboard/settings/modules" },
  { name: "Desktop App", href: "/dashboard/settings/desktop" },
];

/**
 * En enkelt indstilling på en indstillingsside. `id` er elementets DOM-id, så
 * `/dashboard/settings#afrunding` og søgningen kan hoppe direkte til den.
 */
export interface SettingsEntry {
  id: string;
  label: string;
  keywords?: string[];
}

export interface SettingsNavItem {
  label: string;
  href: string;
  description: string;
  keywords: string[];
  featureFlag?: string;
  requiresModule?: ModuleKey;
  /** Se NavItem.minRole. Bruges til sider, hvor kun ejer/admin kan gemme. */
  minRole?: "manager" | "admin";
  /** Se NavItem.freelancerOnly. */
  freelancerOnly?: boolean;
  /** Indstillinger på siden, som søgningen finder og kan hoppe direkte til. */
  settings?: SettingsEntry[];
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

/**
 * Indstillingsmenuen og -søgningen. Grupperne følger, hvem indstillingen
 * gælder for: dig selv (Konto), hele organisationen, betaling og
 * kundevendt fakturering, forbindelser til andre systemer og til sidst
 * udviklerværktøjer og data.
 */
export const settingsNavGroups: SettingsNavGroup[] = [
  {
    label: "Konto",
    items: [
      {
        label: "Profil og udseende",
        href: "/dashboard/settings",
        description: "Navn, timepris, arbejdstid, tema og sprog",
        keywords: ["profil", "konto", "personlig"],
        settings: [
          {
            id: "profilbillede",
            label: "Profilbillede",
            keywords: ["billede", "avatar", "foto"],
          },
          { id: "name", label: "Navn", keywords: ["fulde navn"] },
          {
            id: "hourlyRate",
            label: "Standard timepris",
            keywords: ["timepris", "pris", "takst", "rate", "kr"],
          },
          {
            id: "weeklyHourGoal",
            label: "Ugentligt timemål",
            keywords: ["timemål", "mål", "timer om ugen"],
          },
          {
            id: "startPage",
            label: "Startside efter login",
            keywords: ["startside", "forside", "login"],
          },
          {
            id: "arbejdstid",
            label: "Arbejdstid og dækningsgrad",
            keywords: ["arbejdstid", "dækningsgrad", "normtid", "arbejdsdage"],
          },
          {
            id: "fridage",
            label: "Helligdage og fridage",
            keywords: ["helligdage", "fridage", "ferie"],
          },
          {
            id: "afrunding",
            label: "Tidsafrunding",
            keywords: [
              "afrunding",
              "afrund",
              "rounding",
              "runde op",
              "minutter",
            ],
          },
          {
            id: "klippekort",
            label: "Skjul beløb på klippekort",
            keywords: ["klippekort", "beløb", "værdi", "skjul"],
          },
          {
            id: "godkendelse",
            label: "Godkendelse hos kunden",
            keywords: ["godkendelse", "godkend", "kundeportal", "approval"],
          },
          {
            id: "udseende",
            label: "Tema (lyst eller mørkt)",
            keywords: ["tema", "udseende", "dark mode", "mørk", "lys"],
          },
          {
            id: "sprog",
            label: "Sprog",
            keywords: ["sprog", "language", "engelsk", "dansk"],
          },
          {
            id: "opsaetningsguide",
            label: "Opsætningsguide",
            keywords: ["onboarding", "guide", "kom i gang"],
          },
          {
            id: "slet-konto",
            label: "Slet konto",
            keywords: ["slet", "luk konto", "opsig"],
          },
        ],
      },
      {
        label: "Sikkerhed & login",
        href: "/dashboard/settings/security",
        description: "Adgangskode, to-faktor, passkeys og sessioner",
        keywords: ["sikkerhed", "login"],
        settings: [
          {
            id: "to-faktor",
            label: "To-faktor-godkendelse",
            keywords: ["2fa", "totp", "authenticator", "backup-koder"],
          },
          {
            id: "adgangskode",
            label: "Adgangskode",
            keywords: ["password", "kodeord", "skift adgangskode"],
          },
          {
            id: "forbundne-konti",
            label: "Forbundne konti",
            keywords: ["google", "github", "microsoft", "oauth"],
          },
          {
            id: "passkeys",
            label: "Passkeys",
            keywords: ["passkey", "face id", "touch id", "nøgle"],
          },
          {
            id: "telefon",
            label: "Telefonnummer",
            keywords: ["sms", "mobil", "telefon"],
          },
          {
            id: "betroede-enheder",
            label: "Betroede enheder",
            keywords: ["enheder", "husk enhed"],
          },
          {
            id: "sessioner",
            label: "Aktive sessioner",
            keywords: ["session", "log ud", "logget ind"],
          },
        ],
      },
      {
        label: "Notifikationer",
        href: "/dashboard/settings/notifications",
        description: "Email, Discord, push og stille timer",
        keywords: ["notifikation", "besked", "alert", "påmindelse"],
        featureFlag: "notifications",
        settings: [
          {
            id: "email-notifikationer",
            label: "Email-notifikationer",
            keywords: ["email", "mail", "rapporter"],
          },
          {
            id: "stille-timer",
            label: "Stille timer",
            keywords: ["forstyr ikke", "nat", "pause"],
          },
          { id: "discord", label: "Discord", keywords: ["webhook", "discord"] },
          {
            id: "push",
            label: "Browser-push",
            keywords: ["push", "browser", "pwa"],
          },
          {
            id: "pwa",
            label: "App og inaktivitet (PWA)",
            keywords: ["pwa", "installér", "app", "badge", "inaktiv"],
          },
          {
            id: "ugerapporter",
            label: "Automatiske ugerapporter",
            keywords: ["ugerapport", "ugentlig", "rapport"],
          },
        ],
      },
      {
        label: "GDPR & databeskyttelse",
        href: "/dashboard/settings/gdpr",
        description: "Download dine data og databehandleraftale",
        keywords: [
          "gdpr",
          "databeskyttelse",
          "persondata",
          "privacy",
          "rettigheder",
        ],
        settings: [
          {
            id: "databehandleraftale",
            label: "Databehandleraftale",
            keywords: ["dpa", "aftale"],
          },
          {
            id: "sletning",
            label: "Sletning af data",
            keywords: ["slet", "glemt", "sletning"],
          },
        ],
      },
    ],
  },
  {
    label: "Organisation",
    items: [
      {
        label: "Virksomhedsprofil",
        href: "/dashboard/settings/company",
        description: "CVR, adresse, bank, moms og firmafridage",
        keywords: ["virksomhed", "firma", "cvr", "faktura"],
        minRole: "admin",
        settings: [
          { id: "logo", label: "Virksomhedslogo", keywords: ["logo"] },
          {
            id: "adresse",
            label: "Adresse",
            keywords: ["adresse", "postnummer", "by"],
          },
          {
            id: "bank",
            label: "Bankoplysninger",
            keywords: ["bank", "kontonummer", "reg.nr", "iban"],
          },
          { id: "moms", label: "Moms", keywords: ["moms", "vat", "momsfri"] },
          {
            id: "fridage",
            label: "Helligdage og firmafridage",
            keywords: ["helligdage", "fridage", "lukkedage"],
          },
        ],
      },
      {
        label: "Organisation & team",
        href: "/dashboard/organization",
        description: "Medlemmer, invitationer og roller",
        keywords: [
          "organisation",
          "team",
          "medlem",
          "invitér",
          "kollega",
          "rolle",
          "ejerskab",
        ],
        featureFlag: "organizations",
        freelancerOnly: true,
      },
      {
        label: "Adgangsstyring",
        href: "/dashboard/organization/permissions",
        description: "Hvad hver rolle må se og ændre",
        keywords: ["adgang", "rettigheder", "roller", "permissions"],
        featureFlag: "organizations",
        freelancerOnly: true,
        minRole: "admin",
      },
      {
        label: "Aktivitetslog",
        href: "/dashboard/organization/audit",
        description: "Hvem ændrede hvad i organisationen",
        keywords: ["log", "audit", "historik", "aktivitet"],
        featureFlag: "organizations",
        minRole: "admin",
      },
      {
        label: "Moduler",
        href: "/dashboard/settings/modules",
        description: "Slå moduler til og fra for organisationen",
        keywords: ["modul", "funktioner", "features", "slå til", "aktivér"],
        minRole: "admin",
      },
      {
        label: "Tags",
        href: "/dashboard/settings/tags",
        description: "Organisér tidsregistreringer, projekter og kunder",
        keywords: ["tag", "label", "mærke", "kategori", "farve"],
      },
      {
        label: "Enterprise-indstillinger",
        href: "/dashboard/enterprise/settings",
        description: "Arbejdstid, fravær, ferie, løn og login",
        keywords: [
          "enterprise",
          "fravær",
          "ferie",
          "løn",
          "compliance",
          "entra",
        ],
        requiresModule: "enterprise",
        minRole: "admin",
      },
    ],
  },
  {
    label: "Fakturering",
    items: [
      {
        label: "Abonnement",
        href: "/dashboard/settings/subscription",
        description: "Plan, betaling og pladser",
        keywords: [
          "abonnement",
          "plan",
          "betaling",
          "pris",
          "subscription",
          "opgrader",
        ],
        minRole: "admin",
        settings: [
          {
            id: "plan",
            label: "Nuværende plan",
            keywords: ["plan", "forbrug"],
          },
          {
            id: "betaling",
            label: "Betaling og kvitteringer",
            keywords: ["kort", "betalingskort", "kvittering"],
          },
          {
            id: "pladser",
            label: "Pladser",
            keywords: ["pladser", "brugere", "seats"],
          },
          {
            id: "skift-plan",
            label: "Skift plan",
            keywords: ["opgrader", "nedgrader", "årlig", "månedlig"],
          },
          {
            id: "annuller",
            label: "Annuller abonnement",
            keywords: ["opsig", "annuller", "stop"],
          },
        ],
      },
      {
        label: "Email & skabeloner",
        href: "/dashboard/settings/email",
        description: "Mailskabeloner til fakturaer og påmindelser",
        keywords: [
          "email",
          "mail",
          "skabelon",
          "template",
          "rykker",
          "påmindelse",
          "imap",
          "indbakke",
        ],
        freelancerOnly: true,
      },
      {
        label: "Kundeportal",
        href: "/dashboard/settings/portal",
        description: "Logo, farver og domæne til kundeportalen",
        keywords: ["portal", "kundeportal", "branding"],
        featureFlag: "clientPortal",
        freelancerOnly: true,
        settings: [
          {
            id: "branding",
            label: "Portalens logo og navn",
            keywords: ["logo", "brand"],
          },
          {
            id: "farver",
            label: "Portalens farver",
            keywords: ["farver", "farve"],
          },
          {
            id: "skrifttyper",
            label: "Portalens skrifttyper",
            keywords: ["skrift", "font"],
          },
          {
            id: "domaene",
            label: "Eget domæne til portalen",
            keywords: ["domæne", "dns", "subdomæne"],
          },
        ],
      },
    ],
  },
  {
    label: "Integrationer",
    items: [
      {
        label: "Integrationer",
        href: "/dashboard/settings/integrations",
        description: "Regnskab, kalender og browserudvidelse",
        keywords: ["integration", "forbind", "regnskab", "bogføring"],
        settings: [
          {
            id: "regnskab",
            label: "Standard-regnskabssystem",
            keywords: ["regnskab", "bogføring", "billy"],
          },
          { id: "dinero", label: "Dinero", keywords: ["dinero"] },
          {
            id: "economic",
            label: "e-conomic",
            keywords: ["economic", "e-conomic"],
          },
          {
            id: "google-kalender",
            label: "Google Kalender",
            keywords: ["google", "kalender", "calendar"],
          },
          {
            id: "browserudvidelse",
            label: "Browserudvidelse",
            keywords: ["chrome", "firefox", "extension", "udvidelse"],
          },
          {
            id: "alunta",
            label: "Alunta-klippekort",
            keywords: ["alunta", "webhook"],
          },
        ],
      },
      {
        label: "AI & automatisering",
        href: "/dashboard/settings/ai",
        description: "Email til opgave og AI-tolkning",
        keywords: ["ai", "automatisering", "kunstig intelligens", "parsing"],
        featureFlag: "ai",
        settings: [
          {
            id: "ai-udbyder",
            label: "AI-udbyder",
            keywords: ["openai", "anthropic", "nøgle", "provider"],
          },
          {
            id: "email-til-opgave",
            label: "Email til opgave",
            keywords: ["email-to-task", "videresend", "opgave"],
          },
        ],
      },
      {
        label: "Desktop-app",
        href: "/dashboard/settings/desktop",
        description: "Download, tilsluttede enheder og licens",
        keywords: ["desktop", "app", "mac", "windows", "download"],
        settings: [
          {
            id: "enheder",
            label: "Tilsluttede enheder",
            keywords: ["enhed", "device", "computer"],
          },
          {
            id: "licens",
            label: "Desktop-licens",
            keywords: ["licens", "køb", "refundering"],
          },
        ],
      },
    ],
  },
  {
    label: "Avanceret",
    items: [
      {
        label: "API",
        href: "/dashboard/settings/api",
        description: "API-nøgler og dokumentation",
        keywords: [
          "api",
          "nøgle",
          "key",
          "rest",
          "udvikler",
          "developer",
          "token",
        ],
        requiresModule: "public_api",
      },
      {
        label: "Import og eksport",
        href: "/dashboard/settings/data",
        description: "Importér fra CSV og eksportér dine data",
        keywords: ["import", "eksport", "csv", "json", "backup", "data"],
        settings: [
          {
            id: "eksport",
            label: "Eksportér data",
            keywords: ["eksport", "download", "backup"],
          },
          {
            id: "import",
            label: "Importér data",
            keywords: ["import", "csv", "upload"],
          },
        ],
      },
    ],
  },
];

const SETTINGS_GROUP_KEYS: Record<string, string> = {
  Konto: "account",
  Organisation: "organisation",
  Fakturering: "billing",
  Integrationer: "integrations",
  Avanceret: "advanced",
};

/** Oversættelse som `useTranslations("navSettings")`. */
export interface SettingsNavTranslator {
  (key: string): string;
  has(key: string): boolean;
}

/**
 * Oversætter indstillingsmenuens navne og beskrivelser (kataloget
 * `navSettings`). De danske tekster i `settingsNavGroups` er reserve for alt,
 * der ikke er oversat, og søgeordene (keywords) er uændrede.
 */
export function translateSettingsGroups(
  groups: SettingsNavGroup[],
  t: SettingsNavTranslator,
): SettingsNavGroup[] {
  const pick = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;
  return groups.map((group) => {
    const groupKey = SETTINGS_GROUP_KEYS[group.label];
    return {
      ...group,
      label: groupKey ? pick(`group.${groupKey}`, group.label) : group.label,
      items: group.items.map((item) => {
        const slug = item.href
          .replace("/dashboard/", "")
          .replace("/dashboard", "root")
          .replace(/\//g, "_");
        return {
          ...item,
          label: pick(`item.${slug}.label`, item.label),
          description: pick(`item.${slug}.description`, item.description),
          settings: item.settings?.map((entry) => ({
            ...entry,
            label: pick(`entry.${slug}.${entry.id}`, entry.label),
          })),
        };
      }),
    };
  });
}

/**
 * Gamle ankernavne, der stadig skal virke i delte links
 * (`/dashboard/settings#rounding` → `#afrunding`).
 */
export const settingsAnchorAliases: Record<string, string> = {
  rounding: "afrunding",
};

export const routeLabels: Record<string, string> = {
  dashboard: "Hjem",
  overblik: "Overblik",
  clients: "Kunder",
  projects: "Projekter",
  tasks: "Opgaver",
  time: "Tidsregistrering",
  klippekort: "Klippekort",
  invoices: "Fakturaer",
  reports: "Rapporter",
  templates: "Skabeloner",
  integrations: "Integrationer",
  organization: "Organisation",
  help: "Hjælp",
  settings: "Indstillinger",
  company: "Virksomhedsprofil",
  security: "Sikkerhed & login",
  email: "Email & skabeloner",
  "email-templates": "Mailskabeloner",
  "email-integration": "Email til opgave",
  notifications: "Notifikationer",
  portal: "Kundeportal",
  ai: "AI & automatisering",
  api: "API",
  data: "Import og eksport",
  import: "Import",
  tags: "Tags",
  subscription: "Abonnement",
  gdpr: "GDPR & databeskyttelse",
  modules: "Moduler",
  desktop: "Desktop-app",
  new: "Ny",
  edit: "Rediger",
  admin: "Admin",
  enterprise: "Enterprise",
  timesheet: "Timeseddel",
  team: "Team",
  day: "Teamoverblik",
  employees: "Medarbejdere",
  absence: "Ferie & fravær",
  flex: "Flex",
  "work-plan": "Arbejdsplan",
  "period-closing": "Periodeafslutning",
  overtime: "Afspadsering",
  compliance: "Compliance",
  holidays: "Helligdage",
  departments: "Afdelinger",
  "closure-periods": "Faste ferieuger",
  permissions: "Adgangsstyring",
  audit: "Aktivitetslog",
  login: "Login & domæner",
  payroll: "Løn og lønarter",
  logbook: "Logbog",
  spildtid: "Spildtid",
  "team-utilization": "Udnyttelsesgrad",
  profitability: "Lønsomhed",
  "team-profitability": "Team-lønsomhed",
  health: "Integrationssundhed",
  coverage: "Dækningsgrad",
};
