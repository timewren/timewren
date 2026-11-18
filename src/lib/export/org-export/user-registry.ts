/**
 * Bruger-eksporten ("Hent dine egne data", GDPR art. 15 og 20): hvad en
 * enkelt bruger selv kan hente om sig selv, uanset rolle. Samme motor som
 * organisations-eksporten, men med et helt andet scope.
 *
 * Reglen: kun rækker, der hører til brugeren selv, i den organisation
 * eksporten bestilles i (den aktive), plus brugerens egen profil. Aldrig
 * kollegers rækker og aldrig organisationens fælles data.
 *
 * Hvorfor kun den aktive organisation (og ikke alle, brugeren er medlem af):
 * hver organisation er sin egen dataansvarlige, og TimeTrack er databehandler
 * (DPA). Én fil skal derfor ikke blande to dataansvarliges data. Er man med i
 * flere organisationer, skifter man organisation og bestiller igen.
 *
 * Hver tabel i `schema.ts` skal stå i præcis én af de to lister nedenfor
 * (`USER_EXPORT_TABLES` eller `USER_EXPORT_EXCLUDED`); `user-registry.test.ts`
 * fejler, hvis en ny tabel mangler. `user_id` betyder ofte bare "oprettet af"
 * på data, organisationen deler (kunder, projekter, fakturaer ...). Sådanne
 * tabeller er udeladt, også selvom de har en `user_id`-kolonne.
 */
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import daExports from "@/i18n/messages/da/serverExports.json";
import * as s from "@/lib/db/schema";

export type UserExportScope =
  /** Brugerens egen række i `user`-tabellen, kun de kolonner i `only`. */
  | { kind: "profile" }
  /** Organisationens id og navn (til README). */
  | { kind: "organization" }
  /**
   * Tabel med organization_id: `organization_id = aktiv org` OG mindst én af
   * `columns` = brugerens id. Uden organisation: `organization_id IS NULL`.
   */
  | { kind: "own"; columns: string[] }
  /**
   * Tabel uden organization_id, men med en bruger-kolonne og en
   * forælder med organization_id: `column = brugerens id` OG forælderen
   * ligger i den aktive org.
   */
  | {
      kind: "ownVia";
      column: string;
      parent: string;
      parentColumn: AnyPgColumn;
    }
  /** Tabel keyed på members.id: kun brugerens egne medlemsrækker i org'en. */
  | { kind: "member"; column: string }
  /** Personlig tabel uden organisation: `column = brugerens id`. */
  | { kind: "global"; column: string }
  /** Børnetabel, hentet via en forælder, der selv er med i bruger-eksporten. */
  | { kind: "child"; parent: string; column: AnyPgColumn };

export interface UserExportTable {
  /** Nøglen i schema-modulet (fx "timeEntries"). */
  key: string;
  table: PgTable;
  /** Filnavn i ZIP'en uden endelse. */
  file: string;
  /** Standardnavn (dansk, fra kataloget); README bruger `userTables.<key>` på brugerens sprog. */
  label: string;
  scope: UserExportScope;
  /** JS-nøgler, der kun må komme med (allowlist). */
  only?: string[];
  /** JS-nøgler, der aldrig kommer med i bruger-eksporten. */
  omit?: string[];
  /**
   * Timepriser, beløb og kostpriser: organisationens forretningsdata, ikke
   * personens. Kun med for ejere og administratorer (og brugere uden
   * organisation). "all" = hele tabellen.
   */
  adminOnly?: string[] | "all";
}

function t(
  key: string,
  file: string,
  scope: UserExportScope,
  extra: {
    only?: string[];
    omit?: string[];
    adminOnly?: string[] | "all";
  } = {},
): UserExportTable {
  const table = (s as Record<string, unknown>)[key] as PgTable;
  const label = (daExports.userTables as Record<string, string>)[key];
  return { key, table, file, label, scope, ...extra };
}

/** Org-tabel med `userId` som ejer-kolonne: den almindelige regel. */
function own(key: string, file: string): UserExportTable {
  return t(key, file, { kind: "own", columns: ["userId"] });
}

function child(
  key: string,
  file: string,
  parent: string,
  column: AnyPgColumn,
): UserExportTable {
  return t(key, file, { kind: "child", parent, column });
}

/**
 * Kolonner i `user`-tabellen, der må komme med i profilen. Alt andet
 * (adgangsnøgler, integrationer, interne flag, fakturaopsætning,
 * annonceklik-id) er udeladt.
 */
export const USER_PROFILE_COLUMNS = [
  "id",
  "name",
  "email",
  "emailVerified",
  "phoneNumber",
  "defaultHourlyRate",
  "roundingEnabled",
  "roundingMinutes",
  "roundingMethod",
  "hidePrepaidValue",
  "weeklyHourGoal",
  "workingHoursStart",
  "workingHoursEnd",
  "workingDays",
  "workSchedule",
  "coverageReminderThreshold",
  "timezone",
  "locale",
  "theme",
  "twoFactorEnabled",
  "onboardingCompleted",
  "attrSource",
  "attrMedium",
  "attrCampaign",
  "attrReferrer",
  "attrLandingPage",
  "createdAt",
  "updatedAt",
] as const;

export const USER_EXPORT_TABLES: UserExportTable[] = [
  // Dig og organisationen
  t(
    "users",
    "profil",
    { kind: "profile" },
    { only: [...USER_PROFILE_COLUMNS], adminOnly: ["defaultHourlyRate"] },
  ),
  t("organizations", "organisation", {
    kind: "organization",
  }),
  t(
    "members",
    "medlemskab",
    { kind: "own", columns: ["userId"] },
    // Intern omkostningssats: organisationens forretningsdata.
    { adminOnly: ["costRate"] },
  ),
  own("employeeProfiles", "medarbejderprofil"),
  own("employmentPeriods", "ansaettelsesperioder"),
  own("departmentManagers", "afdelingsleder-roller"),
  own("projectAssignments", "projekt-tildelinger"),
  t(
    "memberRates",
    "dine-timepriser",
    { kind: "member", column: "memberId" },
    { adminOnly: "all" },
  ),
  t("memberClientAccess", "kundeadgang", {
    kind: "member",
    column: "memberId",
  }),
  t("orgDpaAcceptances", "dpa-accepter", {
    kind: "own",
    columns: ["acceptedBy"],
  }),
  t("orgAuditLogs", "haendelseslog-om-dig", {
    kind: "own",
    columns: ["targetUserId"],
  }),
  t(
    "activityLogs",
    "aktivitetslog",
    { kind: "own", columns: ["userId"] },
    // `changes` og `metadata` rummer før/efter-værdier. Rettes en kunde, er
    // det kundens navn, mail, telefon og adresse. Hvad du gjorde, hvornår og
    // på hvilken post (type, id, navn) er med.
    { omit: ["changes", "metadata"] },
  ),

  // Tid
  t(
    "timeEntries",
    "tidsregistreringer",
    { kind: "own", columns: ["userId"] },
    // Timepris og intern omkostningssats: organisationens forretningsdata.
    { adminOnly: ["billableRate", "costRate"] },
  ),
  child(
    "timeEntrySegments",
    "tidsregistrering-segmenter",
    "timeEntries",
    s.timeEntrySegments.timeEntryId,
  ),
  child(
    "timeEntryTags",
    "tidsregistrering-tags",
    "timeEntries",
    s.timeEntryTags.entryId,
  ),
  own("timerStates", "timere"),
  own("timerSessions", "timer-sessioner"),
  own("deviceMatchRules", "genkendelsesregler"),
  own("deviceLearnedPatterns", "laerte-moenstre"),
  own("timerEvents", "timer-haendelser"),
  own("timerTemplates", "timerskabeloner"),
  t(
    "recurringTimeTemplates",
    "faste-tidsregistreringer",
    { kind: "own", columns: ["userId"] },
    { adminOnly: ["billableRate"] },
  ),
  child(
    "recurringTemplateClients",
    "faste-tidsregistreringer-kunder",
    "recurringTimeTemplates",
    s.recurringTemplateClients.templateId,
  ),
  child(
    "generatedTimeEntries",
    "faste-tidsregistreringer-koersler",
    "recurringTimeTemplates",
    s.generatedTimeEntries.recurringTemplateId,
  ),
  own("weekClosures", "lukkede-uger"),
  own("checkIns", "check-ind"),
  own("resourcePlanEntries", "ressourceplan"),

  // Timesedler og godkendelse
  own("timesheetWeeks", "timesedler"),
  own("timesheetWeekEvents", "timesedler-godkendelseshistorik"),
  own("timesheetTemplates", "timeseddelskabeloner"),
  own("timesheetHiddenProjects", "timesedler-skjulte-projekter"),
  own("periodClosings", "periodeafslutninger"),

  // Fravær, ferie, flex og arbejdstid
  own("absenceRequests", "fravaer"),
  own("vacationBalances", "feriesaldi"),
  own("vacationLedger", "ferieposteringer"),
  own("flexEntries", "flex"),
  own("overtimeLedger", "overarbejde"),
  own("workPlanAssignments", "arbejdsplan-tildelinger"),
  own("workDayDeviations", "arbejdsdag-afvigelser"),
  own("dayOffCalendars", "fridagskalender"),

  // Opgaver
  // Opgaver, du har oprettet (user_id) eller har fået tildelt
  // (assigned_to_user_id), i den aktive organisation. Kommentarer og
  // vedhæftninger er kun dine egne.
  t("tasks", "opgaver", {
    kind: "own",
    columns: ["userId", "assignedToUserId"],
  }),
  own("taskComments", "opgavekommentarer"),
  t("taskAttachments", "opgave-vedhaeftninger", {
    kind: "ownVia",
    column: "userId",
    parent: "tasks",
    parentColumn: s.taskAttachments.taskId,
  }),

  // Kalender, mail og notifikationer
  own("calendarConnections", "kalenderforbindelser"),
  own("calendarEvents", "kalenderbegivenheder"),
  own("calendarMatchingRules", "kalender-regler"),
  own("emailIntegrations", "mail-integrationer"),
  own("emailPreferences", "mail-indstillinger"),
  own("dashboardPreferences", "dashboard-indstillinger"),
  own("onboardingProgress", "kom-godt-i-gang"),
  own("notificationChannels", "notifikationskanaler"),
  own("userNotificationPreferences", "notifikationer-pr-bruger"),
  own("notificationInbox", "notifikationer-indbakke"),
  own("notificationDeliveries", "notifikationer-sendt"),
  own("reportTemplates", "rapportskabeloner"),

  // Personligt og uden organisation. Kun tabeller, hvor rækkerne er dine egne
  // og ikke rummer tredjeparters oplysninger: mailfiltre og leveringslog har
  // ingen organisation og kan rumme kunders adresser på tværs af
  // organisationer, så de er udeladt (se USER_EXPORT_EXCLUDED).
  t("desktopDevices", "desktop-enheder", {
    kind: "global",
    column: "userId",
  }),
  t(
    "desktopLicenses",
    "desktop-licens",
    { kind: "global", column: "userId" },
    // Betalingsreferencer og interne noter hører ikke til her. Det betalte
    // beløb er adminOnly som alle andre penge-kolonner.
    {
      omit: [
        "stripeCustomerId",
        "stripeSubscriptionId",
        "stripePaymentIntentId",
        "note",
      ],
      adminOnly: ["amountPaidDkk"],
    },
  ),
  child(
    "desktopLicenseDevices",
    "desktop-licens-enheder",
    "desktopLicenses",
    s.desktopLicenseDevices.licenseId,
  ),
];

/**
 * Tabeller, der ikke er med i bruger-eksporten. Hver har en gruppe (som står i
 * README.txt i ZIP'en, så brugeren kan se, hvad der mangler og hvem man
 * spørger) og en kort intern begrundelse.
 */
export const USER_EXCLUSION_GROUPS = daExports.userExclusionGroups;

export type UserExclusionGroup = keyof typeof USER_EXCLUSION_GROUPS;

function x(
  group: UserExclusionGroup,
  note: string,
): { group: UserExclusionGroup; note: string } {
  return { group, note };
}

export const USER_EXPORT_EXCLUDED: Record<
  string,
  { group: UserExclusionGroup; note: string }
> = {
  // Delt forretningsdata: user_id betyder "oprettet af"
  clients: x(
    "shared",
    "Kunders stamdata (navne, mails, telefon) er organisationens.",
  ),
  projects: x(
    "shared",
    "Projekter er fælles; navnet kommer med som reference.",
  ),
  rateHistory: x("shared", "Prishistorik for kunder og projekter."),
  scheduledRateChanges: x(
    "shared",
    "Planlagte prisændringer for kunder og projekter.",
  ),
  prepaidPackages: x("shared", "Klippekort tilhører kunden og organisationen."),
  prepaidUsage: x(
    "shared",
    "Forbrug på klippekort (barn af udeladt forælder).",
  ),
  prepaidTemplates: x("shared", "Delte klippekortskabeloner."),
  prepaidRenewalRequests: x("shared", "Kundens anmodninger om nyt klippekort."),
  invoices: x("shared", "Fakturaer er organisationens og kundens."),
  invoiceLines: x("shared", "Fakturalinjer (barn af udeladt forælder)."),
  invoiceTemplates: x("shared", "Delte fakturaskabeloner."),
  recurringInvoices: x("shared", "Faste fakturaer til kunder."),
  recurringInvoiceRuns: x(
    "shared",
    "Kørsler af faste fakturaer (barn af udeladt forælder).",
  ),
  companyProfiles: x("shared", "Firmaoplysninger tilhører organisationen."),
  portalBranding: x("shared", "Kundeportalens udseende er organisationens."),
  clientPortalAccess: x(
    "thirdParty",
    "Kundernes adgange til portalen (kundernes mails).",
  ),
  portalActivityLogs: x("thirdParty", "Kundernes aktivitet i portalen."),
  tags: x("shared", "Delte tags; navnet kommer med som reference."),
  clientTags: x("shared", "Tags på kunder (barn af udeladt forælder)."),
  projectTags: x("shared", "Tags på projekter (barn af udeladt forælder)."),
  emailTemplates: x("shared", "Mailskabeloner, organisationen deler."),
  aluntaKlippekortTokens: x(
    "shared",
    "Forbindelse til kundens abonnementssystem.",
  ),
  aluntaPlanMappings: x("shared", "Kobling af kunder til abonnementsplaner."),
  outgoingWebhooks: x("shared", "Organisationens udgående webhooks."),
  webhookDeliveries: x(
    "shared",
    "Leveringer af webhooks (barn af udeladt forælder).",
  ),
  integrationSyncLogs: x(
    "shared",
    "Log over synkronisering med regnskabssystem.",
  ),
  sentEmails: x(
    "thirdParty",
    "Mails sendt til kunder, med deres adresser og indhold.",
  ),
  timeApprovalRequests: x(
    "thirdParty",
    "Anmodninger til kunder om at godkende tid.",
  ),
  reportSchedules: x(
    "thirdParty",
    "Planlagte rapporter med modtagernes mailadresser.",
  ),
  reportShares: x(
    "thirdParty",
    "Delte rapporter med modtagere uden for organisationen.",
  ),
  emailFilterRules: x(
    "thirdParty",
    "Mailfiltre uden organisation, med afsenderadresser fra din mail.",
  ),
  emailDeliveryLogs: x(
    "thirdParty",
    "Leveringslog uden organisation. Ved fakturamails til kunder er user_id afsenderen og `to` kundens adresse.",
  ),
  imports: x(
    "thirdParty",
    "Importer kan rumme kunders data fra den importerede fil.",
  ),
  aiProcessingLogs: x(
    "thirdParty",
    "Input og output kan rumme indholdet af mails fra andre.",
  ),
  emailThreads: x(
    "thirdParty",
    "Mails fra og til tredjeparter; ligger i din egen mailkonto.",
  ),
  taskStatuses: x("config", "Organisationens opgavestatusser."),
  activityTypes: x(
    "config",
    "Organisationens aktivitetstyper; navnet kommer med som reference.",
  ),
  projectActivityTypes: x("config", "Aktivitetstyper pr. projekt."),
  projectBudgetAlerts: x("shared", "Budgetadvarsler på projekter."),

  // Organisationens opsætning
  departments: x("config", "Afdelinger; navnet kommer med som reference."),
  holidays: x("config", "Helligdage."),
  absenceTypes: x("config", "Fraværstyper; navnet kommer med som reference."),
  orgClosurePeriods: x("config", "Lukkeperioder."),
  payrollWageTypes: x("config", "Lønarter."),
  payrollMappingRules: x("config", "Regler for løneksport."),
  workPlans: x("config", "Arbejdsplaner; navnet kommer med som reference."),
  workPlanVersions: x("config", "Versioner af arbejdsplaner."),
  rolePermissions: x("config", "Rettigheder pr. rolle."),
  organizationModules: x("config", "Moduler slået til."),
  orgVerifiedDomains: x("config", "Verificerede domæner."),
  orgNotificationSettings: x(
    "config",
    "Organisationens notifikationsindstillinger.",
  ),
  orgPeriodLocks: x("config", "Låste perioder."),
  invitations: x(
    "thirdParty",
    "Invitationer rummer den inviteredes mailadresse.",
  ),

  // Login og enheder
  accounts: x("login", "Login-forbindelser og adgangskode-hash."),
  sessions: x("login", "Login-sessioner (token, IP)."),
  verifications: x("login", "Engangskoder."),
  passkeys: x("login", "Passkeys."),
  twoFactors: x("login", "Hemmeligheder til totrinsbekræftelse."),
  trustedDevices: x("login", "Betroede enheder."),
  apiKeys: x("login", "API-nøgler."),
  extensionTokens: x("login", "Nøgler til browserudvidelsen."),
  oauthClients: x("login", "Registrerede AI-apps (OAuth-klienter)."),
  oauthResources: x("login", "Teknisk opsætning af OAuth-ressourcer."),
  oauthClientResources: x(
    "login",
    "Teknisk kobling mellem AI-apps og ressourcer.",
  ),
  oauthRefreshTokens: x("login", "Fornyelsesnøgler til forbundne AI-apps."),
  oauthAccessTokens: x("login", "Adgangsnøgler til forbundne AI-apps."),
  oauthConsents: x("login", "Samtykker til forbundne AI-apps."),
  oauthClientAssertions: x("login", "Engangsmærker til OAuth-klientlogin."),
  mobilePushTokens: x("login", "Push-adresser til mobilappen."),
  pushSubscriptions: x("login", "Push-abonnementer i browseren."),
  dineroOAuthPending: x(
    "login",
    "Midlertidige nøgler under forbindelse til Dinero.",
  ),
  clientPortalSessions: x("login", "Kundeportalens login-sessioner."),
  desktopSyncTombstones: x("login", "Teknisk synkroniseringsdata."),
  desktopSyncLog: x("login", "Teknisk synkroniseringslog."),
  deviceAuthCodes: x("login", "Engangskoder til login i desktop-appen."),
  deviceImportMap: x(
    "login",
    "Teknisk kobling mellem desktop-appens lokale id'er og TimeTrack.",
  ),
  deviceIdempotencyKeys: x(
    "login",
    "Tekniske nøgler, der forhindrer dubletter fra desktop-appens offline-kø.",
  ),
  emailSyncQueue: x("login", "Teknisk kø til mailsynkronisering."),
  emailClassificationCache: x("login", "Teknisk mellemlager."),
  dataExportRequests: x("login", "Selve eksport-anmodningerne."),

  // TimeTracks egne data
  subscriptions: x("timetrack", "Abonnementet hos TimeTrack."),
  testAluntaSubscriptions: x(
    "timetrack",
    "Interne referencer til testabonnementer.",
  ),
  paymentMethods: x("timetrack", "Betalingsmetode til abonnementet."),
  supportTickets: x("timetrack", "Henvendelser til support."),
  supportMessages: x("timetrack", "Beskeder i henvendelser til support."),
  supportInboxes: x("timetrack", "TimeTracks supportindbakker."),
  supportReplyTemplates: x("timetrack", "TimeTracks svarskabeloner."),
  feedbackSubmissions: x("timetrack", "Feedback sendt til TimeTrack."),
  helpFeedback: x("timetrack", "Vurderinger af hjælpetekster."),
  productEvents: x("timetrack", "TimeTracks produktstatistik."),
  stabilityFindings: x("timetrack", "TimeTracks driftsovervågning."),
  churnPlaybookRuns: x("timetrack", "TimeTracks opfølgningsmails."),
  adminUserNotes: x("timetrack", "TimeTracks interne supportnoter."),
  adminActivityLogs: x("timetrack", "TimeTracks interne administrationslog."),
  adminSettings: x("timetrack", "TimeTracks globale indstillinger."),
  featureFlags: x("timetrack", "TimeTracks funktionsflag."),
  changelogs: x("timetrack", "Nyheder til alle brugere."),
  roadmapItems: x("timetrack", "Den offentlige køreplan."),
  bannedDomains: x("timetrack", "Spamfilter."),
  bannedEmailDomains: x("timetrack", "Spamfilter."),
  contactMessages: x("timetrack", "Beskeder fra kontaktformularen."),
  betaSignups: x("timetrack", "Tilmeldinger til beta."),
  marketingLeads: x("timetrack", "TimeTracks markedsføringskontakter."),
  desktopTrials: x("timetrack", "Prøveperioder på desktop-appen."),
  desktopWaitlist: x("timetrack", "Venteliste til desktop-appen."),
  desktopAnalytics: x("timetrack", "Statistik for desktop-appen."),
  cronJobLogs: x("timetrack", "Driftslog."),
  emailEvents: x("timetrack", "Leveringshændelser fra mailudbyderen."),
  emailForwardingRules: x("timetrack", "TimeTracks mailvideresendelse."),
  emailForwardingLogs: x("timetrack", "TimeTracks mailvideresendelse."),
  stripeWebhookEvents: x(
    "timetrack",
    "Betalingshændelser for desktop-licenser.",
  ),
  storeBillingEvents: x(
    "timetrack",
    "Tekniske hændelser fra App Store og Google Play om køb i appen.",
  ),
  webhookEvents: x(
    "timetrack",
    "Tekniske hændelser fra betalings- og mailudbydere.",
  ),
};

/**
 * Opslagstabeller: kun id og navn på de kunder, projekter, opgaver osv., som
 * brugerens EGNE rækker peger på, så filerne kan læses uden resten af
 * organisationens stamdata. Hentes efter de egentlige tabeller og begrænses
 * til de id'er, rækkerne peger på, og til den aktive organisation.
 */
export interface UserReferenceTable {
  key: string;
  table: PgTable;
  file: string;
  label: string;
  /** JS-nøgler, der hentes (altid inklusive id). */
  columns: string[];
  /** Nøgler i brugerens rækker, der peger på denne tabel. */
  refKeys: string[];
}

function ref(
  key: string,
  file: string,
  columns: string[],
  refKeys: string[],
): UserReferenceTable {
  const label = (daExports.userRefTables as Record<string, string>)[key];
  return {
    key,
    table: (s as Record<string, unknown>)[key] as PgTable,
    file,
    label,
    columns,
    refKeys,
  };
}

/**
 * Rækkefølgen betyder noget: projekter hentes før kunder, fordi et projekts
 * kunde-id lægges til kunde-opslaget.
 */
export const USER_REFERENCE_TABLES: UserReferenceTable[] = [
  ref(
    "tasks",
    "reference-opgaver",
    ["id", "title"],
    ["taskId", "linkedTaskId"],
  ),
  ref(
    "projects",
    "reference-projekter",
    ["id", "name", "clientId"],
    ["projectId", "linkedProjectId", "defaultProjectId"],
  ),
  ref("clients", "reference-kunder", ["id", "name"], ["clientId"]),
  ref(
    "activityTypes",
    "reference-aktivitetstyper",
    ["id", "name"],
    ["activityTypeId"],
  ),
  ref(
    "absenceTypes",
    "reference-fravaerstyper",
    ["id", "name"],
    ["absenceTypeId"],
  ),
  ref("departments", "reference-afdelinger", ["id", "name"], ["departmentId"]),
  ref("workPlans", "reference-arbejdsplaner", ["id", "name"], ["workPlanId"]),
  ref("tags", "reference-tags", ["id", "name"], ["tagId"]),
];
