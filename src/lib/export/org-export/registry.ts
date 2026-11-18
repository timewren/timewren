/**
 * Hvilke tabeller den fulde organisations-eksport tager med, og hvordan de
 * scopes. Hver tabel i `src/lib/db/schema.ts` skal stå i præcis én af de to
 * lister nedenfor; `registry.test.ts` fejler, hvis en ny tabel mangler.
 *
 * Scoping (multi-tenant, skudsikkert):
 * - "org": rækker med `organization_id = orgId`. Uden org (solo-bruger uden
 *   organisation) bruges `user_id = brugerens id`. De to blandes aldrig.
 * - "parent": børnetabeller uden egen org-kolonne. Rækkerne hentes via en
 *   underforespørgsel på forældertabellens org-scopede id'er.
 * - Per-bruger-tabeller uden org-kolonne tages ALDRIG med via "brugerne i
 *   orgen", for en bruger kan være medlem af flere organisationer, og så
 *   ville en anden orgs data komme med.
 */
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import daExports from "@/i18n/messages/da/serverExports.json";
import * as s from "@/lib/db/schema";

export type OrgExportScope =
  | { kind: "org" }
  | { kind: "parent"; parent: string; column: AnyPgColumn }
  | { kind: "organization" }
  | { kind: "orgUsers" };

export interface OrgExportTable {
  /** Nøglen i schema-modulet (fx "timeEntries"). */
  key: string;
  table: PgTable;
  /** Filnavn i ZIP'en uden endelse. */
  file: string;
  /** Standardnavn (dansk, fra kataloget); README bruger `orgTables.<key>` på brugerens sprog. */
  label: string;
  scope: OrgExportScope;
}

const org = { kind: "org" } as const;

function t(
  key: string,
  table: PgTable,
  file: string,
  scope: OrgExportScope = org,
): OrgExportTable {
  const label = (daExports.orgTables as Record<string, string>)[key];
  return { key, table, file, label, scope };
}

function child(
  key: string,
  table: PgTable,
  file: string,
  parent: string,
  column: AnyPgColumn,
): OrgExportTable {
  return t(key, table, file, { kind: "parent", parent, column });
}

export const ORG_EXPORT_TABLES: OrgExportTable[] = [
  // Organisationen og folk
  t("organizations", s.organizations, "organisation", { kind: "organization" }),
  t("users", s.users, "brugere", {
    kind: "orgUsers",
  }),
  t("members", s.members, "medlemmer"),
  t("invitations", s.invitations, "invitationer"),
  t("departments", s.departments, "afdelinger"),
  t("departmentManagers", s.departmentManagers, "afdelingsledere"),
  t("employeeProfiles", s.employeeProfiles, "medarbejderprofiler"),
  t("employmentPeriods", s.employmentPeriods, "ansaettelsesperioder"),
  t("rolePermissions", s.rolePermissions, "rolle-rettigheder"),
  t("organizationModules", s.organizationModules, "moduler"),
  t("orgVerifiedDomains", s.orgVerifiedDomains, "verificerede-domaener"),
  t("orgDpaAcceptances", s.orgDpaAcceptances, "dpa-accepter"),
  t("orgNotificationSettings", s.orgNotificationSettings, "org-notifikationer"),
  t("companyProfiles", s.companyProfiles, "firmaoplysninger"),

  // Kunder, projekter og opgaver
  t("clients", s.clients, "kunder"),
  t("projects", s.projects, "projekter"),
  t("projectAssignments", s.projectAssignments, "projekt-tildelinger"),
  child(
    "projectActivityTypes",
    s.projectActivityTypes,
    "projekt-aktivitetstyper",
    "projects",
    s.projectActivityTypes.projectId,
  ),
  child(
    "projectBudgetAlerts",
    s.projectBudgetAlerts,
    "projekt-budgetadvarsler",
    "projects",
    s.projectBudgetAlerts.projectId,
  ),
  t("activityTypes", s.activityTypes, "aktivitetstyper"),
  t("tags", s.tags, "tags"),
  child(
    "clientTags",
    s.clientTags,
    "kunde-tags",
    "clients",
    s.clientTags.clientId,
  ),
  child(
    "projectTags",
    s.projectTags,
    "projekt-tags",
    "projects",
    s.projectTags.projectId,
  ),
  t("memberClientAccess", s.memberClientAccess, "kundeadgang-pr-medlem"),
  t("tasks", s.tasks, "opgaver"),
  t("taskStatuses", s.taskStatuses, "opgavestatusser"),
  t("taskComments", s.taskComments, "opgavekommentarer"),
  child(
    "taskAttachments",
    s.taskAttachments,
    "opgave-vedhaeftninger",
    "tasks",
    s.taskAttachments.taskId,
  ),
  child(
    "emailThreads",
    s.emailThreads,
    "opgave-mails",
    "tasks",
    s.emailThreads.taskId,
  ),

  // Tid
  t("timeEntries", s.timeEntries, "tidsregistreringer"),
  child(
    "timeEntrySegments",
    s.timeEntrySegments,
    "tidsregistrering-segmenter",
    "timeEntries",
    s.timeEntrySegments.timeEntryId,
  ),
  child(
    "timeEntryTags",
    s.timeEntryTags,
    "tidsregistrering-tags",
    "timeEntries",
    s.timeEntryTags.entryId,
  ),
  t("timerStates", s.timerStates, "timere"),
  t("timerSessions", s.timerSessions, "timer-sessioner"),
  t("timerEvents", s.timerEvents, "timer-haendelser"),
  t("timerTemplates", s.timerTemplates, "timerskabeloner"),
  t(
    "recurringTimeTemplates",
    s.recurringTimeTemplates,
    "faste-tidsregistreringer",
  ),
  child(
    "recurringTemplateClients",
    s.recurringTemplateClients,
    "faste-tidsregistreringer-kunder",
    "recurringTimeTemplates",
    s.recurringTemplateClients.templateId,
  ),
  child(
    "generatedTimeEntries",
    s.generatedTimeEntries,
    "faste-tidsregistreringer-koersler",
    "recurringTimeTemplates",
    s.generatedTimeEntries.recurringTemplateId,
  ),
  t("weekClosures", s.weekClosures, "lukkede-uger"),
  t("checkIns", s.checkIns, "check-ind"),
  t("resourcePlanEntries", s.resourcePlanEntries, "ressourceplan"),

  // Timesedler, godkendelse og hændelseslog
  t("timesheetWeeks", s.timesheetWeeks, "timesedler"),
  t(
    "timesheetWeekEvents",
    s.timesheetWeekEvents,
    "timesedler-godkendelseshistorik",
  ),
  t("timesheetTemplates", s.timesheetTemplates, "timeseddelskabeloner"),
  t(
    "timesheetHiddenProjects",
    s.timesheetHiddenProjects,
    "timesedler-skjulte-projekter",
  ),
  t("timeApprovalRequests", s.timeApprovalRequests, "tidsgodkendelser"),
  t("periodClosings", s.periodClosings, "periodeafslutninger"),
  t("orgPeriodLocks", s.orgPeriodLocks, "periodelaase"),
  t("orgAuditLogs", s.orgAuditLogs, "haendelseslog"),
  t("activityLogs", s.activityLogs, "aktivitetslog"),

  // Fravær, ferie, flex og arbejdstid
  t("absenceTypes", s.absenceTypes, "fravaerstyper"),
  t("absenceRequests", s.absenceRequests, "fravaer"),
  t("orgClosurePeriods", s.orgClosurePeriods, "lukkeperioder"),
  t("holidays", s.holidays, "helligdage"),
  t("dayOffCalendars", s.dayOffCalendars, "fridagskalendere"),
  t("vacationBalances", s.vacationBalances, "feriesaldi"),
  t("vacationLedger", s.vacationLedger, "ferieposteringer"),
  t("flexEntries", s.flexEntries, "flex"),
  t("overtimeLedger", s.overtimeLedger, "overarbejde"),
  t("workPlans", s.workPlans, "arbejdsplaner"),
  t("workPlanVersions", s.workPlanVersions, "arbejdsplan-versioner"),
  t("workPlanAssignments", s.workPlanAssignments, "arbejdsplan-tildelinger"),
  t("workDayDeviations", s.workDayDeviations, "arbejdsdag-afvigelser"),
  t("payrollWageTypes", s.payrollWageTypes, "loenarter"),
  t("payrollMappingRules", s.payrollMappingRules, "loen-regler"),

  // Klippekort, priser og fakturaer
  t("prepaidPackages", s.prepaidPackages, "klippekort"),
  child(
    "prepaidUsage",
    s.prepaidUsage,
    "klippekort-forbrug",
    "prepaidPackages",
    s.prepaidUsage.prepaidPackageId,
  ),
  t("prepaidTemplates", s.prepaidTemplates, "klippekort-skabeloner"),
  t(
    "prepaidRenewalRequests",
    s.prepaidRenewalRequests,
    "klippekort-fornyelser",
  ),
  t("aluntaKlippekortTokens", s.aluntaKlippekortTokens, "alunta-forbindelser"),
  t("aluntaPlanMappings", s.aluntaPlanMappings, "alunta-planer"),
  t("rateHistory", s.rateHistory, "timeprishistorik"),
  t("scheduledRateChanges", s.scheduledRateChanges, "planlagte-timepriser"),
  t("memberRates", s.memberRates, "timepriser-pr-medlem"),
  t("invoices", s.invoices, "fakturaer"),
  child(
    "invoiceLines",
    s.invoiceLines,
    "fakturalinjer",
    "invoices",
    s.invoiceLines.invoiceId,
  ),
  t("invoiceTemplates", s.invoiceTemplates, "fakturaskabeloner"),
  t("recurringInvoices", s.recurringInvoices, "faste-fakturaer"),
  child(
    "recurringInvoiceRuns",
    s.recurringInvoiceRuns,
    "faste-fakturaer-koersler",
    "recurringInvoices",
    s.recurringInvoiceRuns.recurringInvoiceId,
  ),

  // Kundeportal
  t("clientPortalAccess", s.clientPortalAccess, "kundeportal-adgange"),
  child(
    "portalActivityLogs",
    s.portalActivityLogs,
    "kundeportal-aktivitet",
    "clientPortalAccess",
    s.portalActivityLogs.portalAccessId,
  ),
  t("portalBranding", s.portalBranding, "kundeportal-udseende"),

  // Rapporter, mails, notifikationer og integrationer
  t("reportTemplates", s.reportTemplates, "rapportskabeloner"),
  t("reportSchedules", s.reportSchedules, "planlagte-rapporter"),
  t("reportShares", s.reportShares, "delte-rapporter"),
  t("sentEmails", s.sentEmails, "sendte-mails"),
  t("emailTemplates", s.emailTemplates, "mailskabeloner"),
  t("emailPreferences", s.emailPreferences, "mail-indstillinger"),
  t("emailIntegrations", s.emailIntegrations, "mail-integrationer"),
  t("notificationChannels", s.notificationChannels, "notifikationskanaler"),
  t("notificationDeliveries", s.notificationDeliveries, "notifikationer-sendt"),
  t("notificationInbox", s.notificationInbox, "notifikationer-indbakke"),
  t(
    "userNotificationPreferences",
    s.userNotificationPreferences,
    "notifikationer-pr-bruger",
  ),
  t("calendarConnections", s.calendarConnections, "kalenderforbindelser"),
  t("calendarEvents", s.calendarEvents, "kalenderbegivenheder"),
  t("calendarMatchingRules", s.calendarMatchingRules, "kalender-regler"),
  t("outgoingWebhooks", s.outgoingWebhooks, "webhooks"),
  child(
    "webhookDeliveries",
    s.webhookDeliveries,
    "webhook-leveringer",
    "outgoingWebhooks",
    s.webhookDeliveries.webhookId,
  ),
  t("integrationSyncLogs", s.integrationSyncLogs, "integrationslog"),
  t("imports", s.imports, "importer"),
  t("aiProcessingLogs", s.aiProcessingLogs, "ai-log"),
  t("dashboardPreferences", s.dashboardPreferences, "dashboard-indstillinger"),
  t("onboardingProgress", s.onboardingProgress, "kom-godt-i-gang"),
];

/**
 * Tabeller, der bevidst ikke er med, og hvorfor. Begrundelsen står også i
 * README.txt i ZIP'en, så kunden kan se, hvad der mangler.
 */
export const ORG_EXPORT_EXCLUDED: Record<string, string> =
  daExports.orgExcluded;

/**
 * Kolonner, der aldrig kommer med i eksporten: adgangsnøgler, hemmeligheder,
 * hashes og webhook-adresser (som virker som adgangsnøgler). Navnene er
 * databasens kolonnenavne.
 */
export const REDACTED_COLUMNS = new Set<string>([
  // Platformens interne klassifikation
  "is_test_account",
  // generelle
  "token",
  "secret",
  "password",
  "credentials",
  "token_hash",
  "token_encrypted",
  "key_hash",
  "access_token",
  "refresh_token",
  "id_token",
  "sync_token",
  "webhook_token_hash",
  "access_token_hash",
  "access_token_encrypted",
  "password_hash",
  "email_verification_token_hash",
  "session_token_hash",
  "download_token_hash",
  "download_token_encrypted",
  "encrypted_access_token",
  "encrypted_refresh_token",
  "imap_password",
  "discord_webhook_url",
  "slack_webhook_url",
  "slack_bot_token",
  "teams_webhook_url",
  "verification_token",
  "domain_verification_token",
  "p256dh_key",
  "auth_key",
  "device_token",
  "license_key",
  // brugerens egne integrationsnøgler (users-tabellen)
  "billy_api_key",
  "dinero_api_key",
  "dinero_refresh_token",
  "economic_app_secret_token",
  "economic_agreement_grant_token",
  "timeops_api_key",
  "ai_api_key",
]);

/**
 * Kolonnenavne, der ligner hemmeligheder, men ikke er det. Bruges af testen,
 * der fanger nye hemmelige kolonner.
 */
export const SAFE_LOOKALIKE_COLUMNS = new Set<string>([
  "payroll_code",
  "postal_code",
  "code",
  "promo_code",
  "token_count",
  "token_id",
  "token_expiry",
  "token_expires_at",
  "key_prefix",
  "module_key",
  "password_changed",
  "password_reset_expires_at",
  "subject_domain_hash",
  "id_mapping",
  "alunta_mapping_id",
]);

/** For `users` tages kun disse kolonner med. */
export const USER_EXPORT_COLUMNS = [
  "id",
  "name",
  "email",
  "createdAt",
] as const;
