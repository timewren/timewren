import { TRPCError } from "@trpc/server";
import { eq, inArray, or, sql } from "drizzle-orm";
import { sharedT } from "@/i18n/shared-text";
import { alunta } from "@/lib/alunta";
import {
  type AppleTokenToRevoke,
  collectAppleTokens,
  exchangeAppleAuthorizationCode,
  revokeAppleTokens,
} from "@/lib/auth/apple";
import type { db as defaultDb } from "@/lib/db";
import { members, organizations, subscriptions } from "@/lib/db/schema";
import { DELETED_USER_LABEL } from "@/lib/org-audit";
import {
  collectUserStorageKeys,
  purgeStorageKeys,
  purgeUserUploads,
} from "@/lib/storage/user-uploads";
import {
  storeManageUrl,
  storeProviderLabel,
} from "@/lib/store-billing/products";
import { isStoreManaged } from "@/lib/store-billing/state";

type Db = typeof defaultDb;

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Hvad der sker med en række, der refererer brugeren, når kontoen slettes
 * (#918). Rækker i brugerens SOLO-orgs (hvor brugeren er eneste medlem)
 * forsvinder altid med orgen. Politikken gælder resten:
 *
 * - `delete`: personlige data og adgangsnøgler (login, tokens, enheder,
 *   præferencer, notifikationer, egne integrationer) — slettes i ALLE orgs.
 * - `keep`: organisationens data, hvor brugeren er ejer af rækken
 *   (tidsposter, fakturaer, klippekort, opgaver …). Kunden ejer dem (DPA pkt.
 *   10.4), så de bevares i andre orgs og peger på den anonymiserede bruger.
 *   Rækker uden org (gammel solo-data) slettes.
 * - `ref`: en aktørreference (godkendt af, oprettet af, tildelt …) på en
 *   række, der tilhører en anden. Rækken røres ikke.
 * - `nullify`: referencen sættes til NULL (rækker uden org slettes, når
 *   tabellen har en org-kolonne).
 *
 * Audit-/ledger-tabellerne (AUDIT_RETENTION_TABLES) håndteres for sig.
 * Ukendte (nye) FK-kolonner falder tilbage til `keep` med org-kolonne og
 * `delete` uden — men testen i account-deletion-team.integration.test.ts
 * kræver, at hver FK mod "user" står her, så valget træffes bevidst.
 */
export type UserReferenceAction = "delete" | "keep" | "ref" | "nullify";

export const USER_REFERENCE_POLICY: Record<string, UserReferenceAction> = {
  // Login og adgang
  "account.userId": "delete",
  "session.userId": "delete",
  "passkey.userId": "delete",
  "twoFactor.userId": "delete",
  // MCP OAuth (#912): brugerens tokens og samtykker forsvinder med kontoen,
  // så AI-forbindelserne tilbagekaldes. DCR-klienter ejes ikke af en bruger;
  // en evt. ejer nulstilles som FK'en selv gør (ON DELETE SET NULL).
  "oauthAccessToken.userId": "delete",
  "oauthRefreshToken.userId": "delete",
  "oauthConsent.userId": "delete",
  "oauthClient.userId": "nullify",
  "api_keys.user_id": "delete",
  "extension_tokens.user_id": "delete",
  "trusted_devices.user_id": "delete",
  "device_auth_codes.user_id": "delete",
  "device_idempotency_keys.user_id": "delete",
  "device_import_map.user_id": "delete",
  "device_learned_patterns.user_id": "delete",
  "device_match_rules.user_id": "delete",
  "desktop_device.user_id": "delete",
  "desktop_sync_log.user_id": "delete",
  "desktop_sync_tombstones.user_id": "delete",
  "mobile_push_tokens.user_id": "delete",
  "push_subscriptions.user_id": "delete",
  // Medlemskab og roller
  "members.user_id": "delete",
  "department_managers.user_id": "delete",
  "project_assignments.user_id": "delete",
  // Egne integrationer, præferencer, notifikationer og spor
  "calendar_connections.user_id": "delete",
  "calendar_events.user_id": "delete",
  "calendar_matching_rules.user_id": "delete",
  "email_integrations.user_id": "delete",
  "email_sync_queue.user_id": "delete",
  "email_threads.user_id": "delete",
  "email_classification_cache.user_id": "delete",
  "email_filter_rules.user_id": "delete",
  "email_preferences.user_id": "delete",
  "email_delivery_logs.user_id": "delete",
  "dinero_oauth_pending.user_id": "delete",
  "dashboard_preferences.user_id": "delete",
  "onboarding_progress.user_id": "delete",
  "user_notification_preferences.user_id": "delete",
  "notification_channels.user_id": "delete",
  "notification_inbox.user_id": "delete",
  "notification_deliveries.user_id": "delete",
  "timer_states.user_id": "delete",
  "timer_templates.user_id": "delete",
  "timesheet_hidden_projects.user_id": "delete",
  "timesheet_templates.user_id": "delete",
  "report_schedules.user_id": "delete",
  "product_events.user_id": "delete",
  "ai_processing_logs.user_id": "delete",
  "data_export_requests.user_id": "delete",
  "help_feedback.user_id": "delete",
  "churn_playbook_runs.user_id": "delete",
  "admin_user_notes.user_id": "delete",
  "portal_activity_logs.freelancer_id": "delete",
  // Organisationens data: bevares i andre orgs
  "time_entries.user_id": "keep",
  // Bevares (tidsposter peger på dem), men deaktiveres i buildDeletionSql
  "recurring_time_templates.user_id": "keep",
  "timer_sessions.user_id": "keep",
  "timer_events.user_id": "keep",
  "invoices.user_id": "keep",
  "invoice_templates.user_id": "keep",
  "recurring_invoices.user_id": "keep",
  "prepaid_packages.user_id": "keep",
  "prepaid_templates.user_id": "keep",
  "prepaid_renewal_requests.freelancer_id": "keep",
  "clients.user_id": "keep",
  "client_portal_access.freelancer_id": "keep",
  "portal_branding.user_id": "keep",
  "projects.user_id": "keep",
  "rate_history.user_id": "keep",
  "scheduled_rate_changes.user_id": "keep",
  "tasks.user_id": "keep",
  "task_comments.user_id": "keep",
  "task_statuses.user_id": "keep",
  "task_attachments.user_id": "keep",
  "tags.user_id": "keep",
  "activity_logs.user_id": "keep",
  "absence_requests.user_id": "keep",
  "check_ins.user_id": "keep",
  "employee_profiles.user_id": "keep",
  "employment_periods.user_id": "keep",
  "flex_entries.user_id": "keep",
  "vacation_balances.user_id": "keep",
  "period_closings.user_id": "keep",
  "week_closures.user_id": "keep",
  "timesheet_weeks.user_id": "keep",
  "time_approval_requests.user_id": "keep",
  "work_day_deviations.user_id": "keep",
  "work_plan_assignments.user_id": "keep",
  "resource_plan_entries.user_id": "keep",
  "day_off_calendars.user_id": "keep",
  "org_period_locks.locked_by_user_id": "keep",
  "invitations.inviter_id": "keep",
  "company_profiles.user_id": "keep",
  "email_templates.user_id": "keep",
  "sent_emails.user_id": "keep",
  "imports.user_id": "keep",
  "integration_sync_logs.user_id": "keep",
  "outgoing_webhooks.user_id": "keep",
  "payment_methods.user_id": "keep",
  "report_shares.user_id": "keep",
  "report_templates.user_id": "keep",
  "subscriptions.user_id": "keep",
  "alunta_klippekort_tokens.user_id": "keep",
  "alunta_plan_mappings.user_id": "keep",
  // Aktørreferencer på andres rækker
  "absence_requests.approved_by": "ref",
  "absence_requests.registered_by": "ref",
  "day_off_calendars.updated_by": "ref",
  "employment_periods.created_by": "ref",
  "member_client_access.granted_by": "ref",
  "org_closure_periods.created_by": "ref",
  "org_dpa_acceptances.accepted_by": "ref",
  "org_verified_domains.created_by": "ref",
  "organization_modules.updated_by": "ref",
  "period_closings.approved_by": "ref",
  "period_closings.unlocked_by": "ref",
  "resource_plan_entries.updated_by": "ref",
  "tasks.assigned_to_user_id": "ref",
  "timesheet_weeks.decided_by": "ref",
  "work_day_deviations.created_by": "ref",
  "work_day_deviations.updated_by": "ref",
  "work_plan_assignments.created_by": "ref",
  "work_plan_versions.created_by": "ref",
  "work_plans.created_by": "ref",
  // Platform-admin-spor (ingen org)
  "admin_activity_logs.admin_user_id": "ref",
  "admin_user_notes.author_id": "ref",
  "banned_domains.banned_by": "ref",
  "support_reply_templates.created_by": "ref",
  "admin_activity_logs.target_user_id": "nullify",
  "admin_settings.updated_by": "nullify",
  "banned_email_domains.banned_by": "nullify",
  "feature_flags.updated_by": "nullify",
  "email_forwarding_rules.created_by": "nullify",
  "desktop_license.user_id": "nullify",
  "support_tickets.user_id": "nullify",
  "support_tickets.assigned_to": "nullify",
  "feedback_submissions.user_id": "nullify",
};

/** Pladsholder-mail på en anonymiseret bruger: unik og ikke-routbar (RFC 2606). */
export function deletedUserEmail(userId: string): string {
  return `slettet-${userId}@deleted.timetrack.invalid`;
}

export type AccountDeletionBlockReason = "owner_must_transfer";

export interface AccountDeletionPlan {
  /** Orgs hvor brugeren er eneste medlem: slettes helt. */
  soloOrgIds: string[];
  /** Orgs med andre medlemmer: brugeren forlader dem, data bevares. */
  sharedOrgIds: string[];
  /** Sat når sletningen ikke må gennemføres endnu. */
  blocked: {
    reason: AccountDeletionBlockReason;
    orgs: Array<{ id: string; name: string }>;
  } | null;
}

export const OWNER_MUST_TRANSFER_MESSAGE =
  "Du er ejer af et team med andre medlemmer. Overdrag ejerskabet til et andet medlem under Organisation, før du sletter din konto.";

/**
 * Hvilke orgs slettes, hvilke forlades, og er sletningen blokeret? Ejer man
 * en org med andre medlemmer (og er eneste ejer), skal ejerskabet overdrages
 * først (#918) — ellers står teamet uden ejer.
 */
export async function planAccountDeletion(
  db: Db,
  userId: string,
): Promise<AccountDeletionPlan> {
  const myMemberships = await db.query.members.findMany({
    where: eq(members.userId, userId),
  });
  const orgIds = [...new Set(myMemberships.map((m) => m.organizationId))];
  for (const orgId of orgIds) {
    if (!ID_PATTERN.test(orgId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Ugyldigt org-id" });
    }
  }
  if (orgIds.length === 0) {
    return { soloOrgIds: [], sharedOrgIds: [], blocked: null };
  }

  const allMembers = await db.query.members.findMany({
    where: inArray(members.organizationId, orgIds),
  });
  const soloOrgIds: string[] = [];
  const sharedOrgIds: string[] = [];
  const mustTransfer: string[] = [];
  for (const orgId of orgIds) {
    const inOrg = allMembers.filter((m) => m.organizationId === orgId);
    const others = inOrg.filter((m) => m.userId !== userId);
    if (others.length === 0) {
      soloOrgIds.push(orgId);
      continue;
    }
    sharedOrgIds.push(orgId);
    const iAmOwner = inOrg.some(
      (m) => m.userId === userId && m.role === "owner",
    );
    if (iAmOwner && !others.some((m) => m.role === "owner")) {
      mustTransfer.push(orgId);
    }
  }

  let blocked: AccountDeletionPlan["blocked"] = null;
  if (mustTransfer.length > 0) {
    const orgs = await db.query.organizations.findMany({
      where: inArray(organizations.id, mustTransfer),
      columns: { id: true, name: true },
    });
    blocked = { reason: "owner_must_transfer", orgs };
  }
  return { soloOrgIds, sharedOrgIds, blocked };
}

/**
 * Audit-/hændelses-/ledger-tabeller med 5 års retention (#479, #499).
 * Rækkerne slettes ALDRIG med brugeren: aktør-/medarbejderreferencen NULLes
 * og label-snapshottet anonymiseres. Tabellerne undtages fra den dynamiske
 * FK-sletning nedenfor — tilføj nye append-only logtabeller her.
 */
export const AUDIT_RETENTION_TABLES = [
  "org_audit_logs",
  "timesheet_week_events",
  "vacation_ledger",
  "overtime_ledger",
] as const;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timede ud efter ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

/** Abonnementsrækker der slettes med kontoen: brugerens egen og dens solo-orgs. */
function accountSubscriptionsWhere(userId: string, orgIds: string[]) {
  return orgIds.length > 0
    ? or(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.organizationId, orgIds),
      )
    : eq(subscriptions.userId, userId);
}

/**
 * Har kontoen et aktivt abonnement købt i App Store/Google Play? Så skal
 * sletteflowet bede om bekræftelse (se deleteUserAccountCompletely).
 */
export async function findActiveStoreSubscription(
  db: Db,
  userId: string,
): Promise<{ storeProvider: string; manageUrl: string } | null> {
  // Et teams abonnement består, når et medlem sletter sig (#918)
  const { soloOrgIds } = await planAccountDeletion(db, userId);
  const sub = (
    await db.query.subscriptions.findMany({
      where: accountSubscriptionsWhere(userId, soloOrgIds),
    })
  ).find(isStoreManaged);
  if (!sub?.storeProvider) return null;
  return {
    storeProvider: sub.storeProvider,
    manageUrl: storeManageUrl(sub.storeProvider, sub.storeProductId),
  };
}

/**
 * Konto-sletning (GDPR-erasure) — fælles for selvbetjening
 * (`user.deleteAccount`) og platform-admin (`deleteAllUserData`).
 *
 * Baggrund (support-sag 2026-08-17): den gamle implementering kørte
 * `DELETE FROM "user"` direkte og antog cascade — men mange tabeller
 * refererer "user" og "organizations" UDEN cascade, så sletningen fejlede, og
 * et aktivt Alunta-abonnement blev aldrig annulleret. #918: et teammedlem
 * kunne slet ikke slette sin konto, og admin-vejen slettede medlemmets
 * tidsposter i arbejdsgiverens org.
 *
 * Strategi:
 * 1. Plan (planAccountDeletion): orgs hvor brugeren er eneste medlem
 *    (solo) slettes helt; orgs med andre medlemmer (team) forlades. Er
 *    brugeren eneste ejer af et team, afvises sletningen med
 *    `owner_must_transfer`. Planen gentages INDE i transaktionen (med lås på
 *    org-rækkerne), så et samtidigt invite-accept eller ejerskifte ikke kan
 *    smutte ind mellem tjek og sletning (fejl-lukket).
 * 2. Ét PL/pgSQL-blok i én transaktion (buildDeletionSql): solo-orgs slettes
 *    FK-drevet; audit-/ledger-rækker anonymiseres; hver FK mod "user"
 *    behandles efter USER_REFERENCE_POLICY. Peger der derefter stadig rækker
 *    på brugeren (teamets tidsposter, fakturaer …), bliver user-rækken
 *    stående ANONYMISERET (navn, mail, telefon, billede, nøgler og øvrige
 *    felter scrubbes, `banned`) — ellers slettes den. Konvergerer sletningen
 *    ikke, kastes en fejl og ALT rulles tilbage.
 * 3. EFTER commit (best effort, fejl logges som MANUEL OPFØLGNING): Alunta-
 *    abonnementer i solo-orgs annulleres, Apple-tokens tilbagekaldes (#919;
 *    læst og dekrypteret FØR sletningen, og for native iOS-login ombyttet fra
 *    appens `appleAuthorizationCode` FØR sletningen), og filer i S3 slettes. Ved
 *    anonymisering slettes kun profilbilleder — logoer o.l. kan bruges af
 *    teamet, og opgavefiler i teamets orgs bevares.
 */
export async function deleteUserAccountCompletely(
  db: Db,
  userId: string,
  opts: {
    storeSubscriptionAcknowledged?: boolean;
    /**
     * Frisk authorization code fra Apple (native iOS-login), hentet af appen
     * lige før sletningen. Native login gemmer intet token i `account`, så
     * koden er eneste vej til at tilbagekalde Apple-login (5.1.1(v)).
     */
    appleAuthorizationCode?: string;
  } = {},
): Promise<{ outcome: "deleted" | "anonymized" }> {
  if (!ID_PATTERN.test(userId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: sharedT("sharedLabels", "accountDeletion.invalidUserId"),
    });
  }

  // 1. Tidlig guard (pæn fejlbesked før vi rører noget). Gentages i blokken.
  const plan = await planAccountDeletion(db, userId);
  if (plan.blocked) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: sharedT("sharedLabels", "ownerMustTransfer"),
    });
  }
  const { soloOrgIds, sharedOrgIds } = plan;

  const accountSubs = await db.query.subscriptions.findMany({
    where: accountSubscriptionsWhere(userId, soloOrgIds),
  });

  // Et butiksabonnement stopper ikke med kontoen og kan kun opsiges af
  // brugeren i butikken. Sletningen blokeres ikke, men brugeren skal
  // eksplicit bekræfte at have forstået det (også ved kald uden om web-UI'et).
  const storeSub = accountSubs.find(isStoreManaged);
  if (storeSub && !opts.storeSubscriptionAcknowledged) {
    const store = storeProviderLabel(storeSub.storeProvider);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: sharedT("sharedLabels", "accountDeletion.storeSubscription", {
        store,
      }),
    });
  }

  // Læses FØR sletning (rækkerne forsvinder), annulleres EFTER (pkt. 3).
  // Kun solo-orgs: et teams abonnement består.
  const subsToCancel =
    soloOrgIds.length > 0
      ? accountSubs.filter(
          (s) =>
            !!s.organizationId &&
            soloOrgIds.includes(s.organizationId) &&
            s.aluntaSubscriptionId &&
            s.status !== "canceled" &&
            s.status !== "cancelled" &&
            // Købt i appen: Alunta-linket er et gammelt abonnement, og
            // butiksabonnementet kan kun opsiges af brugeren i butikken.
            !isStoreManaged(s),
        )
      : [];

  // Apple-tokens læses og dekrypteres FØR sletningen (account-rækkerne
  // forsvinder) og tilbagekaldes EFTER (#919). Appens authorization code
  // byttes til et token her, efter de tidlige guards (en blokeret sletning
  // bruger ikke den engangskode); fejler det, fortsætter sletningen.
  const appleTokens: AppleTokenToRevoke[] = [];
  let nativeTokenObtained = false;
  if (opts.appleAuthorizationCode) {
    try {
      const native = await exchangeAppleAuthorizationCode(
        opts.appleAuthorizationCode,
        userId,
      );
      if (native) {
        appleTokens.push(native);
        nativeTokenObtained = true;
      }
    } catch (err) {
      console.error(
        `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple authorization code for bruger ${userId} kunne ikke ombyttes:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  try {
    appleTokens.push(
      ...(await collectAppleTokens(db, userId, { nativeTokenObtained })),
    );
  } catch (err) {
    console.error(
      `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple-login for bruger ${userId} kunne ikke læses før sletning:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Nøgler til filer i S3 læses FØR sletning (rækkerne forsvinder), slettes
  // EFTER (pkt. 3). Fejler opslaget, fortsætter sletningen — kontoen skal væk
  // — og fejlen logges til manuel opfølgning.
  let storageKeys: string[] = [];
  try {
    storageKeys = await collectUserStorageKeys(db, userId, soloOrgIds);
  } catch (err) {
    console.error(
      `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: S3-filer for bruger ${userId} kunne ikke indsamles før sletning:`,
      err,
    );
  }

  // 2. Transaktionel sletning/anonymisering
  await db.execute(sql.raw(buildDeletionSql(userId, soloOrgIds, sharedOrgIds)));
  const remaining = await db.execute(
    sql`SELECT 1 FROM "user" WHERE id = ${userId}`,
  );
  const outcome =
    Array.isArray(remaining) && remaining.length > 0 ? "anonymized" : "deleted";
  console.info(
    `[Account Deletion] Bruger ${userId} ${outcome === "deleted" ? "slettet" : "anonymiseret"} (${soloOrgIds.length} solo-orgs slettet, ${sharedOrgIds.length} teams forladt)`,
  );

  // 3. Annullér Alunta-abonnementer EFTER vellykket sletning. Fejler et kald,
  // er kontoen allerede væk — så id'et SKAL logges til manuel opfølgning.
  for (const sub of subsToCancel) {
    const id = sub.aluntaSubscriptionId as string;
    try {
      await withTimeout(
        alunta.subscriptions.cancel(id),
        15_000,
        "Alunta-cancel",
      );
      console.info(`[Account Deletion] Alunta-abonnement ${id} annulleret`);
    } catch (err) {
      console.error(
        `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Alunta-abonnement ${id} kunne IKKE annulleres efter kontosletning:`,
        err,
      );
    }
  }

  // Apple: best effort, logger selv MANUEL OPFØLGNING og kaster ikke
  await revokeAppleTokens(appleTokens, userId);

  // Slet brugerens filer fra S3 (alle versioner) EFTER vellykket
  // sletning — en rollback må aldrig efterlade en levende konto uden filer.
  // Fejl logges til manuel opfølgning; kontoen er væk.
  try {
    const removed = await withTimeout(
      outcome === "deleted"
        ? purgeUserUploads(userId)
        : purgeUserUploads(userId, ["profile"]),
      30_000,
      "S3-oprydning",
    );
    console.info(
      `[Account Deletion] ${removed} S3-versioner af uploads slettet for bruger ${userId}`,
    );
  } catch (err) {
    console.error(
      `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: uploads for bruger ${userId} blev ikke slettet fra S3:`,
      err,
    );
  }
  try {
    const removed = await withTimeout(
      purgeStorageKeys(storageKeys),
      120_000,
      "S3-oprydning af filer",
    );
    console.info(
      `[Account Deletion] ${removed} S3-versioner (${storageKeys.length} filer) slettet for bruger ${userId}`,
    );
  } catch (err) {
    console.error(
      `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: filer for bruger ${userId} blev ikke (alle) slettet fra S3:`,
      err,
    );
  }

  return { outcome };
}

/**
 * PL/pgSQL-blokken der udfører selve sletningen/anonymiseringen. Id'erne
 * SKAL være regex-validerede ([A-Za-z0-9_-]+) — de indsættes som quotede
 * literaler. Eksporteret så SQL'en kan testes isoleret (unit + integration).
 */
export function buildDeletionSql(
  userId: string,
  soloOrgIds: string[],
  sharedOrgIds: string[] = [],
): string {
  const allIds = [userId, ...soloOrgIds, ...sharedOrgIds];
  if (allIds.some((id) => !ID_PATTERN.test(id))) {
    throw new Error("Ugyldigt id til sletnings-SQL");
  }
  const arrayLiteral = (ids: string[]) =>
    ids.length > 0
      ? `ARRAY[${ids.map((id) => `'${id}'`).join(",")}]::text[]`
      : "ARRAY[]::text[]";
  // Fast låserækkefølge, så to samtidige sletninger ikke deadlocker
  const lockOrder = [...new Set([...soloOrgIds, ...sharedOrgIds])].sort();
  const retentionTables = AUDIT_RETENTION_TABLES.map(
    (t) => `'${t}'::regclass`,
  ).join(", ");
  const policyRows = Object.entries(USER_REFERENCE_POLICY)
    .map(([key, action]) => {
      const [tbl, col] = key.split(".");
      return `('${tbl}', '${col}', '${action}')`;
    })
    .join(",\n        ");
  const deletedEmail = deletedUserEmail(userId);

  return `
DO $deletion$
DECLARE
  v_user text := '${userId}';
  v_orgs text[] := ${arrayLiteral(soloOrgIds)};
  v_shared text[] := ${arrayLiteral(sharedOrgIds)};
  v_lock_order text[] := ${arrayLiteral(lockOrder)};
  v_org text;
  r record;
  n bigint;
  pass int;
  progress boolean;
  blocked int;
  remaining boolean := false;
  v_set text;
  v_action text;
BEGIN
  -- Afgrænset køretid; en anden session med lås må ikke hænge sletningen
  PERFORM set_config('statement_timeout', '120000', true);
  PERFORM set_config('lock_timeout', '10000', true);

  -- TOCTOU-guard: lås org-rækkerne og verificér planen igen (fejl-lukket)
  FOREACH v_org IN ARRAY v_lock_order LOOP
    PERFORM 1 FROM organizations WHERE id = v_org FOR UPDATE;
  END LOOP;
  -- Medlemsrækkerne låses også: et samtidigt ejerskifte (transferOwnership)
  -- ændrer kun members.role og rammer ikke org-låsen
  PERFORM 1 FROM members
   WHERE organization_id = ANY(v_lock_order)
   ORDER BY organization_id, id
     FOR UPDATE;
  FOREACH v_org IN ARRAY v_orgs LOOP
    IF EXISTS (
      SELECT 1 FROM members
       WHERE organization_id = v_org AND user_id <> v_user
    ) THEN
      RAISE EXCEPTION 'Org % fik andre medlemmer under sletningen — afbrudt', v_org;
    END IF;
  END LOOP;
  FOREACH v_org IN ARRAY v_shared LOOP
    IF NOT EXISTS (
      SELECT 1 FROM members
       WHERE organization_id = v_org AND user_id <> v_user
    ) THEN
      RAISE EXCEPTION 'Team % mistede sine øvrige medlemmer under sletningen — afbrudt', v_org;
    END IF;
    IF EXISTS (
      SELECT 1 FROM members
       WHERE organization_id = v_org AND user_id = v_user AND role = 'owner'
    ) AND NOT EXISTS (
      SELECT 1 FROM members
       WHERE organization_id = v_org AND user_id <> v_user AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Brugeren er eneste ejer af team % — ejerskabet skal overdrages først', v_org;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM members
     WHERE user_id = v_user
       AND NOT (organization_id = ANY(v_orgs) OR organization_id = ANY(v_shared))
  ) THEN
    RAISE EXCEPTION 'Brugeren fik nye medlemskaber under sletningen — afbrudt';
  END IF;

  -- Børn uden egen org-kolonne: koblinger til slettede skabeloner/poster
  DELETE FROM generated_time_entries
   WHERE recurring_template_id IN (
           SELECT id FROM recurring_time_templates
            WHERE organization_id = ANY(v_orgs)
               OR (user_id = v_user AND organization_id IS NULL))
      OR time_entry_id IN (
           SELECT id FROM time_entries
            WHERE organization_id = ANY(v_orgs)
               OR (user_id = v_user AND organization_id IS NULL));

  -- Multi-pass: alt der FK-refererer organizations via single-kolonne-FK mod PK
  FOREACH v_org IN ARRAY v_orgs LOOP
    FOR pass IN 1..10 LOOP
      progress := false;
      blocked := 0;
      FOR r IN
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute pk ON pk.attrelid = c.confrelid AND pk.attnum = c.confkey[1]
        WHERE c.confrelid = 'organizations'::regclass AND c.contype = 'f'
          AND array_length(c.conkey, 1) = 1
          AND pk.attname = 'id'
          AND c.conrelid <> 'organizations'::regclass
      LOOP
        BEGIN
          EXECUTE format('DELETE FROM %s WHERE %I = $1', r.tbl, r.col) USING v_org;
          GET DIAGNOSTICS n = ROW_COUNT;
          IF n > 0 THEN progress := true; END IF;
        EXCEPTION WHEN foreign_key_violation THEN
          blocked := blocked + 1;
        END;
      END LOOP;
      EXIT WHEN NOT progress AND blocked = 0;
    END LOOP;
    IF blocked > 0 THEN
      RAISE EXCEPTION 'Org-sletning konvergerede ikke (org %, % blokerede tabeller)', v_org, blocked;
    END IF;
    DELETE FROM organizations WHERE id = v_org;
  END LOOP;

  -- Audit-/hændelsesspor (#479): 5 års retention — rækkerne består i de
  -- orgs der overlever; aktør/medarbejder NULLes og labelen anonymiseres.
  UPDATE org_audit_logs
     SET actor_id = NULL, actor_label = '${DELETED_USER_LABEL}'
   WHERE actor_id = v_user;
  UPDATE org_audit_logs
     SET target_email = '${DELETED_USER_LABEL}'
   WHERE target_user_id = v_user AND target_email IS NOT NULL;
  UPDATE org_audit_logs
     SET metadata = jsonb_set(metadata, '{name}', to_jsonb('${DELETED_USER_LABEL}'::text))
   WHERE target_user_id = v_user AND metadata ? 'name';
  UPDATE timesheet_week_events
     SET user_id = NULL, user_label = '${DELETED_USER_LABEL}'
   WHERE user_id = v_user;
  UPDATE timesheet_week_events
     SET actor_id = NULL, actor_label = '${DELETED_USER_LABEL}'
   WHERE actor_id = v_user;
  -- Ledger-posteringer (#499): optjening/afvikling er også 5-års-data
  UPDATE vacation_ledger
     SET user_id = NULL, user_label = '${DELETED_USER_LABEL}'
   WHERE user_id = v_user;
  UPDATE overtime_ledger
     SET user_id = NULL, user_label = '${DELETED_USER_LABEL}'
   WHERE user_id = v_user;

  -- Teamets hændelseslog: medlemmet forlod teamet ved kontosletning
  FOREACH v_org IN ARRAY v_shared LOOP
    INSERT INTO org_audit_logs
      (organization_id, actor_id, actor_label, action, target_user_id, target_email, metadata)
    VALUES
      (v_org, NULL, '${DELETED_USER_LABEL}', 'member_removed', v_user,
       '${DELETED_USER_LABEL}', jsonb_build_object('name', '${DELETED_USER_LABEL}', 'reason', 'account_deleted'));
  END LOOP;

  -- Faste tidsposter i teams bevares (teamets poster peger på dem), men
  -- må ikke blive ved med at generere tid for en slettet bruger
  UPDATE recurring_time_templates SET is_active = false
   WHERE user_id = v_user AND NOT (organization_id = ANY(v_orgs));

  -- Stabilitetsfund (ingen FK): tekniske spor om brugeren
  IF to_regclass('stability_findings') IS NOT NULL THEN
    EXECUTE 'DELETE FROM stability_findings WHERE user_id = $1' USING v_user;
  END IF;

  -- Multi-pass: hver single-kolonne-FK mod "user".id efter
  -- USER_REFERENCE_POLICY (ukendte: keep med org-kolonne, ellers delete).
  -- Audit-/ledger-tabellerne (AUDIT_RETENTION_TABLES) er undtaget — se ovenfor.
  FOR pass IN 1..10 LOOP
    progress := false;
    blocked := 0;
    FOR r IN
      WITH policy(tbl, col, action) AS (VALUES
        ${policyRows}
      )
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col,
             a.attnotnull AS col_not_null,
             EXISTS (
               SELECT 1 FROM pg_attribute o
                WHERE o.attrelid = c.conrelid AND o.attname = 'organization_id'
                  AND o.attnum > 0 AND NOT o.attisdropped
             ) AS has_org_col,
             p.action
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pk ON pk.attrelid = c.confrelid AND pk.attnum = c.confkey[1]
      LEFT JOIN policy p ON p.tbl = cl.relname AND p.col = a.attname
      WHERE c.confrelid = '"user"'::regclass AND c.contype = 'f'
        AND array_length(c.conkey, 1) = 1
        AND pk.attname = 'id'
        AND c.conrelid <> '"user"'::regclass
        AND c.conrelid NOT IN (${retentionTables})
    LOOP
      BEGIN
        v_action := COALESCE(r.action, CASE WHEN r.has_org_col THEN 'keep' ELSE 'delete' END);
        IF v_action = 'delete' THEN
          EXECUTE format('DELETE FROM %s WHERE %I = $1', r.tbl, r.col) USING v_user;
          GET DIAGNOSTICS n = ROW_COUNT;
          IF n > 0 THEN progress := true; END IF;
        ELSIF r.has_org_col THEN
          -- Solo-orgs er væk; rækker uden org er brugerens egen gamle data
          EXECUTE format(
            'DELETE FROM %s WHERE %I = $1 AND (organization_id = ANY($2)%s)',
            r.tbl, r.col,
            CASE WHEN v_action = 'ref' THEN '' ELSE ' OR organization_id IS NULL' END)
            USING v_user, v_orgs;
          GET DIAGNOSTICS n = ROW_COUNT;
          IF n > 0 THEN progress := true; END IF;
        END IF;
        IF v_action = 'nullify' AND NOT r.col_not_null THEN
          EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col)
            USING v_user;
          GET DIAGNOSTICS n = ROW_COUNT;
          IF n > 0 THEN progress := true; END IF;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        blocked := blocked + 1;
      END;
    END LOOP;
    EXIT WHEN NOT progress AND blocked = 0;
  END LOOP;
  IF blocked > 0 THEN
    RAISE EXCEPTION 'User-sletning konvergerede ikke (% blokerede tabeller)', blocked;
  END IF;

  -- Peger noget stadig på brugeren (teamets data, admin-spor)? Så bliver
  -- rækken stående anonymiseret; ellers slettes den.
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute pk ON pk.attrelid = c.confrelid AND pk.attnum = c.confkey[1]
    WHERE c.confrelid = '"user"'::regclass AND c.contype = 'f'
      AND array_length(c.conkey, 1) = 1
      AND pk.attname = 'id'
      AND c.conrelid <> '"user"'::regclass
      AND c.conrelid NOT IN (${retentionTables})
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', r.tbl, r.col)
      INTO remaining USING v_user;
    EXIT WHEN remaining;
  END LOOP;

  IF NOT remaining THEN
    DELETE FROM "user" WHERE id = v_user;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
      RAISE EXCEPTION 'Forventede at slette præcis 1 user-række, fik %', n;
    END IF;
    RETURN;
  END IF;

  -- Anonymisering: identitet og login scrubbes, alle øvrige nullable felter
  -- (API-nøgler, integrationstokens, præferencer …) NULLes — også kolonner
  -- tilføjet senere. NOT NULL-felter uden særregel lades urørt.
  SELECT string_agg(
           CASE column_name
             WHEN 'name' THEN format('%I = %L', column_name, '${DELETED_USER_LABEL}')
             WHEN 'email' THEN format('%I = %L', column_name, '${deletedEmail}')
             WHEN 'emailVerified' THEN format('%I = false', column_name)
             WHEN 'banned' THEN format('%I = true', column_name)
             WHEN 'ban_reason' THEN format('%I = %L', column_name, 'Konto slettet')
             WHEN 'updatedAt' THEN format('%I = now()', column_name)
             ELSE format('%I = NULL', column_name)
           END, ', ')
    INTO v_set
    FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'user'
     AND column_name NOT IN ('id', 'createdAt')
     AND (is_nullable = 'YES'
          OR column_name IN ('name', 'email', 'emailVerified', 'updatedAt'));
  EXECUTE format('UPDATE "user" SET %s WHERE id = $1', v_set) USING v_user;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Forventede at anonymisere præcis 1 user-række, fik %', n;
  END IF;
END $deletion$;
`;
}
