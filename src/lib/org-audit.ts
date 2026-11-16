import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { orgAuditLogs, users } from "@/lib/db/schema";

/**
 * Organisationens hændelseslog (org_audit_logs).
 *
 * RETENTION (#466): Loggen er append-only og SLETTES ALDRIG automatisk.
 * Tidsregistreringsloven kræver 5 års opbevaring af registreringer og et
 * uforanderligt spor på rettelser; for en offentlig arbejdsgiver med
 * persondata om sygdom er "hvem/hvornår/hvad" desuden dokumentationskrav.
 * Der findes derfor intet `expiresAt`-felt og ingen oprydnings-cron for
 * tabellen — kun sletning af hele organisationen (FK cascade) fjerner rækker.
 * Tilføj ALDRIG et cleanup-job der rører org_audit_logs uden at undtage
 * alle enterprise-actions og respektere 5-års-grænsen.
 *
 * RETENTION VS. GDPR (#479): actor_id (og timesheet_week_events.user_id)
 * er ON DELETE SET NULL, og `actor_label` bærer et tekst-snapshot af
 * aktørens navn/e-mail på hændelsestidspunktet. Hård brugersletning
 * (deleteUserAccountCompletely) sletter IKKE rækkerne — den NULLer
 * referencen og anonymiserer labelen til DELETED_USER_LABEL.
 *
 * ANONYMISERINGSPOLITIK ved brugersletning:
 *  - actor_id / user_id  -> NULL, *_label -> "Slettet bruger"
 *  - target_email        -> "Slettet bruger" hvor target_user_id = brugeren
 *  - target_user_id      -> BEVARES (opakt id uden FK; binder hændelser om
 *                           samme person sammen, ingen PII i sig selv)
 *  - metadata            -> IKKE anonymiseret: må kun indeholde før/efter-
 *                           diffs af fagdata (timer, datoer, roller, id'er).
 *                           Skriv ALDRIG navn/e-mail/CPR/fritekst om personer
 *                           i metadata — brug target_email/targetUserId.
 */

/** Label der erstatter navn/e-mail når brugeren er slettet (#479). */
export const DELETED_USER_LABEL = "Slettet bruger";

/**
 * Tekst-snapshot af en bruger til audit-rækker: "Navn (e-mail)", eller det
 * der findes. Spejler backfill-udtrykket i drizzle/0104_audit_retention.sql.
 */
export function formatUserLabel(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string | null {
  if (!user) return null;
  const name = user.name?.trim() || null;
  const email = user.email?.trim() || null;
  if (name && email) return `${name} (${email})`;
  return name ?? email;
}

/** Slår navn/e-mail op på en bruger og formaterer som label; null hvis ukendt. */
export async function resolveUserLabel(
  db: Pick<PostgresJsDatabase<typeof schema>, "select">,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return formatUserLabel(row);
}

export type OrgAuditAction =
  | "member_invited"
  | "member_removed"
  | "member_role_changed"
  | "invitation_cancelled"
  | "invitation_accepted"
  | "org_updated"
  | "module_toggled"
  // Dataændringer (#145): enterprise-compliance — "hvem ændrede denne
  // tidspost?" Metadata bærer let før/efter-diff (kun ændrede felter).
  | "time_entry_updated"
  | "time_entry_deleted"
  | "time_entries_bulk_deleted"
  | "member_rate_changed"
  | "member_cost_rate_changed"
  | "invoice_status_changed"
  | "credit_note_created"
  | "client_archived"
  | "period_lock_changed"
  // Fravær (#460, #466) — persondata om sygdom. `absence_registered` er den
  // gamle label for "oprettet på vegne af" (bevaret for eksisterende rækker);
  // nye kald bruger absence_request_created med metadata.onBehalf.
  | "absence_registered"
  | "absence_request_created"
  | "absence_request_approved"
  | "absence_request_rejected"
  | "absence_request_cancelled"
  | "absence_request_updated"
  | "absence_reported_well"
  | "vacation_balance_adjusted"
  // Ferie-årsskifte (#461): rest overført/udbetalt/fortabt af cron
  | "vacation_year_rolled_over"
  // Medarbejderprofil (#466)
  | "employee_profile_created"
  | "employee_profile_updated"
  | "employee_profile_deactivated"
  | "employee_profile_reactivated"
  // Ansættelseshistorik (#465): perioder, fratrædelse, genansættelse
  | "employment_period_created"
  | "employment_period_updated"
  | "employment_ended"
  | "department_managers_updated"
  // Org-indstillinger (#466)
  | "closure_period_created"
  | "closure_period_deleted"
  | "activity_type_created"
  | "activity_type_updated"
  | "activity_type_archived"
  | "work_settings_updated"
  // Lønmapping (E5, #463)
  | "payroll_settings_updated"
  | "wage_type_created"
  | "wage_type_updated"
  | "payroll_rule_created"
  | "payroll_rule_updated"
  | "employee_payroll_ids_updated"
  | "payroll_exported"
  // Timeseddel-godkendelse som hændelser (#466) — spejler timesheet_week_events
  | "timesheet_week_submitted"
  | "timesheet_week_approved"
  | "timesheet_week_rejected"
  | "timesheet_week_reopened"
  // Login & domæner + DPA (E12, #470)
  | "member_auto_joined"
  | "sso_settings_updated"
  | "domain_added"
  | "domain_verified"
  | "domain_removed"
  | "dpa_accepted"
  // Fast arbejdsplan (#510): planer/tildelinger og afvigelser (hvem/hvornår,
  // arbejdstidsloven § 4 b). Metadata: kun tider/timer/datoer — aldrig noten.
  | "work_plan_created"
  | "work_plan_updated"
  | "work_plan_archived"
  | "work_plan_assigned"
  | "work_day_deviation_set"
  | "work_day_deviation_cleared"
  | "compliance_forecast_sent"
  // Normperiode og flex (#507) + periodeafslutning (#518): opgørelse dannet,
  // genberegnet, godkendt (låst), kvitteret og låst op (med årsag)
  | "flex_norm_settings_updated"
  | "period_closing_settings_updated"
  | "period_closing_generated"
  | "period_closing_refreshed"
  | "period_closing_approved"
  | "period_closing_acknowledged"
  | "period_closing_unlocked"
  // Platform-admin logger ind som en bruger — synligt for org-admin (#466)
  | "admin_impersonation_started"
  // AI-apps forbundet via OAuth til MCP-endpointet (#912)
  | "mcp_app_connected"
  | "mcp_app_revoked";

export const AUDIT_ACTION_LABELS: Record<OrgAuditAction, string> = {
  member_invited: "Medlem inviteret",
  member_removed: "Medlem fjernet",
  member_role_changed: "Rolle ændret",
  invitation_cancelled: "Invitation annulleret",
  invitation_accepted: "Invitation accepteret",
  org_updated: "Indstillinger ændret",
  module_toggled: "Modul ændret",
  time_entry_updated: "Tidspost redigeret",
  time_entry_deleted: "Tidspost slettet",
  time_entries_bulk_deleted: "Tidsposter masseslettet",
  member_rate_changed: "Sats ændret",
  member_cost_rate_changed: "Kostpris ændret",
  invoice_status_changed: "Faktura-status ændret",
  credit_note_created: "Kreditnota oprettet",
  client_archived: "Kunde arkiveret",
  period_lock_changed: "Periodelås ændret",
  absence_registered: "Fravær registreret for medarbejder",
  absence_request_created: "Fravær oprettet",
  absence_request_approved: "Fravær godkendt",
  absence_request_rejected: "Fravær afvist",
  absence_request_cancelled: "Fravær annulleret",
  absence_request_updated: "Fravær redigeret",
  absence_reported_well: "Raskmelding",
  vacation_balance_adjusted: "Feriesaldo justeret",
  vacation_year_rolled_over: "Ferieår afsluttet",
  employee_profile_created: "Medarbejderprofil oprettet",
  employee_profile_updated: "Medarbejderprofil ændret",
  employee_profile_deactivated: "Medarbejder deaktiveret",
  employee_profile_reactivated: "Medarbejder genaktiveret",
  employment_period_created: "Ansættelsesperiode oprettet",
  employment_period_updated: "Ansættelsesperiode ændret",
  employment_ended: "Ansættelse afsluttet",
  department_managers_updated: "Afdelingsledere ændret",
  closure_period_created: "Lukkeperiode oprettet",
  closure_period_deleted: "Lukkeperiode slettet",
  activity_type_created: "Aktivitetstype oprettet",
  activity_type_updated: "Aktivitetstype ændret",
  activity_type_archived: "Aktivitetstype arkiveret",
  work_settings_updated: "Arbejdstid ændret",
  payroll_settings_updated: "Lønindstillinger ændret",
  wage_type_created: "Lønart oprettet",
  wage_type_updated: "Lønart ændret",
  payroll_rule_created: "Lønmapping-regel oprettet",
  payroll_rule_updated: "Lønmapping-regel ændret",
  employee_payroll_ids_updated: "Medarbejdernummer ændret",
  payroll_exported: "Løneksport hentet",
  timesheet_week_submitted: "Timeseddel indsendt",
  timesheet_week_approved: "Timeseddel godkendt",
  timesheet_week_rejected: "Timeseddel afvist",
  timesheet_week_reopened: "Timeseddel genåbnet",
  member_auto_joined: "Medlem tilføjet automatisk via domæne",
  sso_settings_updated: "Login-indstillinger ændret",
  domain_added: "Domæne tilføjet",
  domain_verified: "Domæne verificeret",
  domain_removed: "Domæne fjernet",
  dpa_accepted: "Databehandleraftale accepteret",
  mcp_app_connected: "AI-app forbundet",
  mcp_app_revoked: "AI-app afbrudt",
  work_plan_created: "Arbejdsplan oprettet",
  work_plan_updated: "Arbejdsplan ændret",
  work_plan_archived: "Arbejdsplan arkiveret",
  work_plan_assigned: "Arbejdsplan tildelt",
  work_day_deviation_set: "Afvigelse fra arbejdsplan registreret",
  work_day_deviation_cleared: "Afvigelse fra arbejdsplan fjernet",
  compliance_forecast_sent: "Varsel om arbejdsplan sendt",
  flex_norm_settings_updated: "Normperiode og flex ændret",
  period_closing_settings_updated: "Periodeafslutning ændret",
  period_closing_generated: "Periodeopgørelse dannet",
  period_closing_refreshed: "Periodeopgørelse genberegnet",
  period_closing_approved: "Periodeopgørelse godkendt og låst",
  period_closing_acknowledged: "Periodeopgørelse kvitteret",
  period_closing_unlocked: "Periode låst op",
  admin_impersonation_started: "Support loggede ind som bruger",
};

/** Kategorier til filtrering i aktivitetsloggen (#466). */
export type OrgAuditCategory =
  | "members"
  | "settings"
  | "time"
  | "billing"
  | "absence"
  | "employees"
  | "timesheets"
  | "security";

export const AUDIT_CATEGORY_LABELS: Record<OrgAuditCategory, string> = {
  members: "Medlemmer og roller",
  settings: "Indstillinger",
  time: "Tidsregistreringer",
  billing: "Fakturering",
  absence: "Fravær og saldi",
  employees: "Medarbejderprofiler",
  timesheets: "Timesedler",
  security: "Sikkerhed og support",
};

export const AUDIT_ACTION_CATEGORY: Record<OrgAuditAction, OrgAuditCategory> = {
  member_invited: "members",
  member_removed: "members",
  member_role_changed: "members",
  invitation_cancelled: "members",
  invitation_accepted: "members",
  org_updated: "settings",
  module_toggled: "settings",
  time_entry_updated: "time",
  time_entry_deleted: "time",
  time_entries_bulk_deleted: "time",
  member_rate_changed: "billing",
  member_cost_rate_changed: "billing",
  invoice_status_changed: "billing",
  credit_note_created: "billing",
  client_archived: "billing",
  period_lock_changed: "time",
  absence_registered: "absence",
  absence_request_created: "absence",
  absence_request_approved: "absence",
  absence_request_rejected: "absence",
  absence_request_cancelled: "absence",
  absence_request_updated: "absence",
  absence_reported_well: "absence",
  vacation_balance_adjusted: "absence",
  vacation_year_rolled_over: "absence",
  employee_profile_created: "employees",
  employee_profile_updated: "employees",
  employee_profile_deactivated: "employees",
  employee_profile_reactivated: "employees",
  employment_period_created: "employees",
  employment_period_updated: "employees",
  employment_ended: "employees",
  department_managers_updated: "employees",
  closure_period_created: "settings",
  closure_period_deleted: "settings",
  activity_type_created: "settings",
  activity_type_updated: "settings",
  activity_type_archived: "settings",
  work_settings_updated: "settings",
  payroll_settings_updated: "settings",
  wage_type_created: "settings",
  wage_type_updated: "settings",
  payroll_rule_created: "settings",
  payroll_rule_updated: "settings",
  employee_payroll_ids_updated: "employees",
  payroll_exported: "employees",
  timesheet_week_submitted: "timesheets",
  timesheet_week_approved: "timesheets",
  timesheet_week_rejected: "timesheets",
  timesheet_week_reopened: "timesheets",
  member_auto_joined: "members",
  sso_settings_updated: "security",
  domain_added: "security",
  domain_verified: "security",
  domain_removed: "security",
  dpa_accepted: "settings",
  work_plan_created: "settings",
  work_plan_updated: "settings",
  work_plan_archived: "settings",
  work_plan_assigned: "employees",
  work_day_deviation_set: "time",
  work_day_deviation_cleared: "time",
  compliance_forecast_sent: "time",
  flex_norm_settings_updated: "settings",
  period_closing_settings_updated: "settings",
  period_closing_generated: "timesheets",
  period_closing_refreshed: "timesheets",
  period_closing_approved: "timesheets",
  period_closing_acknowledged: "timesheets",
  period_closing_unlocked: "timesheets",
  admin_impersonation_started: "security",
  mcp_app_connected: "security",
  mcp_app_revoked: "security",
};

/** Alle actions i en kategori — til SQL-filter (`IN (...)`). */
export function actionsInCategory(category: OrgAuditCategory): string[] {
  return (Object.keys(AUDIT_ACTION_CATEGORY) as OrgAuditAction[]).filter(
    (a) => AUDIT_ACTION_CATEGORY[a] === category,
  );
}

/** Let før/efter-diff: kun felter der faktisk ændrede sig */
export function auditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    const norm = (v: unknown) =>
      v instanceof Date ? v.toISOString() : (v ?? null);
    if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) {
      diff[key] = { from: norm(a), to: norm(b) };
    }
  }
  return diff;
}

/**
 * Plukker `keys` fra en række, så et diff kun omfatter felter brugeren
 * faktisk kan ændre (ikke updatedAt, id, organizationId …).
 */
export function pickAuditFields<T extends Record<string, unknown>>(
  row: T | null | undefined,
  keys: readonly (keyof T & string)[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const key of keys) out[key] = row[key];
  return out;
}

/**
 * Både db-klienten og en transaktion (`tx`) accepteres — enterprise-actions
 * skal skrives i SAMME transaktion som mutationen, så loggen aldrig
 * kan vise en ændring der blev rullet tilbage (eller omvendt).
 */
export type AuditDb = Pick<
  PostgresJsDatabase<typeof schema>,
  "insert" | "select"
>;

export async function logOrgAudit(
  db: AuditDb,
  orgId: string,
  actorId: string,
  action: OrgAuditAction,
  extra?: {
    targetEmail?: string;
    targetUserId?: string;
    metadata?: Record<string, unknown>;
    /** Snapshot af aktørens navn/e-mail; slås op hvis ikke angivet (#479) */
    actorLabel?: string | null;
  },
): Promise<void> {
  try {
    const actorLabel =
      extra?.actorLabel !== undefined
        ? extra.actorLabel
        : await resolveUserLabel(db, actorId);
    await db.insert(orgAuditLogs).values({
      organizationId: orgId,
      actorId,
      actorLabel,
      action,
      targetEmail: extra?.targetEmail,
      targetUserId: extra?.targetUserId,
      metadata: extra?.metadata,
    });
  } catch (error) {
    // Uden for en transaktion: log og gå videre (mutationen er sket).
    // Inde i en transaktion: Postgres har allerede markeret tx'en som
    // fejlet, så commit afvises — mutationen rulles tilbage sammen med loggen.
    console.error("[org-audit] Failed to log:", error);
  }
}
