import { type TRPC_ERROR_CODE_KEY, TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { toIntlLocale } from "@/i18n/format-locale";
import { activeLocale, st, tr } from "@/i18n/server-text";
import { loadPrepaidSuggestions } from "@/lib/adoption/nudge-data";
import { PREPAID_LOW_BALANCE_THRESHOLD } from "@/lib/config";
import type { db as DbType } from "@/lib/db";
import {
  clients,
  prepaidPackages,
  prepaidRenewalRequests,
  prepaidTemplates,
  prepaidUsage,
  projects,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { sendLowBalanceAlert } from "@/lib/email/prepaid";
import { assertEntriesEditable } from "@/lib/enterprise/bulk-edit-guard";
import { getEffectivePeriodLock } from "@/lib/org/period-lock";
import { getClientPortalUrl } from "@/lib/portal/client-url";
import { isPrepaidBalanceLow } from "@/lib/prepaid/balance";
import {
  MAX_PREPAID_ASSIGN_SELECTION,
  planBulkAssign,
} from "@/lib/prepaid/bulk-assign";
import { canTakePrepaidHours } from "@/lib/prepaid/can-take-hours";
import {
  duplicatedPrepaidExpiry,
  isPrepaidExpired,
  prepaidDaysUntilExpiry,
} from "@/lib/prepaid/expiry";
import {
  normalizePrepaidDeductionHours,
  remainingAfterTotalChange,
  roundPrepaidHours,
} from "@/lib/prepaid/hours";
import { renewPackageInTx } from "@/lib/prepaid/renew-package";
import { computeNextRenewal } from "@/lib/prepaid/renewal";
import { resolveHidePrepaidValue } from "@/lib/prepaid/usage-view";
import { syncPrepaidLinkedRecurringInvoice } from "@/lib/recurring-invoices/prepaid-link";
import { trackEvent } from "@/lib/telemetry/track";
import {
  assertEntryNotBilled,
  assertNoEntriesBilled,
} from "@/lib/time/billed-lock";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { appCodeError } from "../app-code";
import {
  moduleReadProcedure,
  moduleWriteProcedure,
  protectedProcedure,
  router,
  subscribedModuleReadProcedure,
  subscribedProcedure,
} from "../trpc";
import { assertClientAccess, getAccessibleClientIds } from "./clientAccess";

export interface DeductHoursOptions {
  packageId: string;
  hours: number;
  timeEntryId?: string;
  description?: string;
  /**
   * Skip the isActive check. ONLY for edit-reconcile where the entry's usage
   * was just reversed and the net effect frees hours (newHours <= oldHours) —
   * a decrease must not be blocked by a package that expired in the meantime.
   */
  allowInactive?: boolean;
  /**
   * Postens egen (effektive) kunde — obligatorisk (CodeRabbit, PR #858):
   * et udeladt eller `null` felt sprang tidligere tjekket helt over, så et
   * klippekort kunne trækkes for en post uden kunde eller med en forkert
   * kunde. Tjekkes kun når trækket er knyttet til en post (`timeEntryId`);
   * kaldere der trækker direkte på pakken uden en post (`manualDeduct`)
   * sender eksplicit `null` og er ikke underlagt tjekket.
   */
  clientId: string | null;
}

export interface DeductResult {
  remainingHours: number;
  totalHours: number;
  clientId: string;
  packageName: string;
  lowBalanceAlertSentAt: Date | null;
  usageId: string | null;
  /** Faktisk trukket (clip-afrundet) — bruges til restsaldo-toast (#72) */
  hoursDeducted: number;
  /** Timer trukket UD OVER saldoen (allow-politik, #93) */
  overdraftedHours?: number;
  /** invoice-politik (#93): intet blev trukket — posten forbliver fakturerbar */
  overflowedToInvoice?: boolean;
}

// Lock balances in ID order while allowing foreign-key checks on the card.
export async function lockPrepaidPackages(
  tx: Pick<Parameters<Parameters<typeof DbType.transaction>[0]>[0], "select">,
  packageIds: string[],
  scope?: { userId: string; orgId: string | null },
) {
  await tx
    .select({ id: prepaidPackages.id })
    .from(prepaidPackages)
    .where(
      and(
        inArray(prepaidPackages.id, packageIds),
        scope
          ? scope.orgId
            ? eq(prepaidPackages.organizationId, scope.orgId)
            : eq(prepaidPackages.userId, scope.userId)
          : undefined,
      ),
    )
    .orderBy(prepaidPackages.id)
    .for("no key update");
}

/**
 * Et træk, kortet ikke kan tage. Fejlen bærer den sprogneutrale kode
 * PREPAID_DEDUCTION_FAILED, så udvidelsen kan gemme tiden uden kort på alle
 * sprog i stedet for at matche på den oversatte tekst (#1320).
 */
export function prepaidDeductionError(opts: {
  code: TRPC_ERROR_CODE_KEY;
  message: string;
}): TRPCError {
  return appCodeError(opts.code, "PREPAID_DEDUCTION_FAILED", opts.message);
}

/**
 * Core deduction logic shared between deductHours, manualDeduct, and recurring cron.
 * Handles transaction, validation, and updating the package.
 */
export async function deductHoursCore(
  tx: Parameters<Parameters<typeof import("@/lib/db").db.transaction>[0]>[0],
  userId: string,
  orgId: string | null,
  options: DeductHoursOptions,
): Promise<DeductResult> {
  // Money guard: NaN sniger sig ellers forbi baade saldo-tjekket (NaN-
  // sammenligning er false) og Math.max-gulvet, og skriver "NaN" i saldoen.
  if (!Number.isFinite(options.hours) || options.hours <= 0) {
    throw prepaidDeductionError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "prepaid.invalidHours"),
    });
  }

  // Verify package belongs to user/org with row-level lock
  const ownershipFilter = orgId
    ? eq(prepaidPackages.organizationId, orgId)
    : eq(prepaidPackages.userId, userId);

  const [pkg] = await tx
    .select()
    .from(prepaidPackages)
    .where(and(eq(prepaidPackages.id, options.packageId), ownershipFilter))
    .for("no key update");

  if (!pkg) {
    throw prepaidDeductionError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "common.prepaidNotFound"),
    });
  }

  if (options.timeEntryId && options.clientId !== pkg.clientId) {
    throw prepaidDeductionError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "prepaid.otherClient"),
    });
  }

  if (!options.allowInactive) {
    if (!pkg.isActive) {
      throw prepaidDeductionError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "prepaid.inactive"),
      });
    }
    // Udløb håndhæves også her (#206): cronen deaktiverer først dagligt,
    // så en udløbet pakke må ikke acceptere træk i vinduet indtil da.
    // Kortet gælder hele udløbsdagen i dansk tid (#736).
    if (isPrepaidExpired(pkg.expiryDate)) {
      throw prepaidDeductionError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "prepaid.expired"),
      });
    }
  }

  // Per-medlem klientadgang (#206): læsestien filtrerer via
  // getAccessibleClientIds — skrivestien skal håndhæve det samme, ellers
  // kan et scoped medlem trække fra en klients pakke via kendt packageId.
  await assertClientAccess(
    tx as unknown as Parameters<typeof assertClientAccess>[0],
    userId,
    orgId,
    pkg.clientId,
  );

  const remainingHours = roundPrepaidHours(
    parseFloat(pkg.remainingHours || "0"),
  );
  const usedHours = roundPrepaidHours(parseFloat(pkg.usedHours || "0"));
  const totalHours = roundPrepaidHours(parseFloat(pkg.totalHours || "0"));

  const hoursToDeduct = normalizePrepaidDeductionHours(
    options.hours,
    pkg.clipSizeMinutes,
  );
  if (hoursToDeduct <= 0) {
    throw prepaidDeductionError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "prepaid.invalidHours"),
    });
  }

  // Overtræks-politik (#93): eksplicit svar på "kortet er tomt midt i
  // en post" i stedet for implicit afvisning.
  const policy = pkg.overdraftPolicy || "block";
  let overdrafted = 0;

  if (remainingHours < hoursToDeduct) {
    if (policy === "block" || (policy === "invoice" && !options.timeEntryId)) {
      throw prepaidDeductionError({
        code: "BAD_REQUEST",
        message: pkg.clipSizeMinutes
          ? await tr("serverErrors", "prepaid.insufficientHoursClip", {
              available: remainingHours.toFixed(2),
              required: hoursToDeduct.toFixed(2),
              minutes: pkg.clipSizeMinutes,
            })
          : await tr("serverErrors", "prepaid.insufficientHours", {
              available: remainingHours.toFixed(2),
            }),
      });
    }

    if (policy === "invoice") {
      // Harvest-mønsteret: posten dækkes IKKE af kortet — den forbliver
      // fakturerbar, evt. til den aftalte overtræks-sats. Intet skrives
      // på pakken.
      if (options.timeEntryId) {
        await tx
          .update(timeEntries)
          .set({
            isPrepaid: false,
            prepaidPackageId: null,
            isBillable: true,
            ...(pkg.overdraftRate ? { billableRate: pkg.overdraftRate } : {}),
          })
          .where(eq(timeEntries.id, options.timeEntryId));
      }
      return {
        remainingHours,
        totalHours,
        clientId: pkg.clientId,
        packageName: pkg.name,
        lowBalanceAlertSentAt: pkg.lowBalanceAlertSentAt,
        usageId: null,
        hoursDeducted: 0,
        overflowedToInvoice: true,
      };
    }

    // allow: træk hele posten — resten akkumuleres som overtræk (gæld).
    // remaining forbliver >= 0 (DB-invarianten fra #206 holdes).
    overdrafted = hoursToDeduct - remainingHours;
  }

  const hoursDeductedFromBalance = roundPrepaidHours(
    Math.min(remainingHours, hoursToDeduct),
  );
  const newUsedHours = roundPrepaidHours(
    Math.min(totalHours, usedHours + hoursDeductedFromBalance),
  );
  const newRemainingHours = roundPrepaidHours(
    Math.max(0, totalHours - newUsedHours),
  );
  const valueUsed = hoursToDeduct * parseFloat(pkg.hourlyRate || "0");

  // Update package hours
  await tx
    .update(prepaidPackages)
    .set({
      usedHours: newUsedHours.toString(),
      remainingHours: newRemainingHours.toString(),
      ...(overdrafted > 0
        ? {
            overdraftHours: sql`${prepaidPackages.overdraftHours} + ${overdrafted}`,
          }
        : {}),
    })
    .where(eq(prepaidPackages.id, options.packageId));

  // Record usage (with clip-rounded hours)
  const [usage] = await tx
    .insert(prepaidUsage)
    .values({
      prepaidPackageId: options.packageId,
      timeEntryId: options.timeEntryId || null,
      hoursUsed: hoursToDeduct.toString(),
      valueUsed: valueUsed.toString(),
      // Overtræks-andelen gemmes pr. række (#93) så reversal kan
      // attribuere eksakt — ellers er reversal ordens-afhængig.
      overdraftHours: overdrafted > 0 ? overdrafted.toString() : "0",
      description: options.description,
    })
    .returning();

  // Update time entry to mark as prepaid (if timeEntryId provided)
  if (options.timeEntryId) {
    await tx
      .update(timeEntries)
      .set({
        prepaidPackageId: options.packageId,
        isPrepaid: true,
      })
      .where(eq(timeEntries.id, options.timeEntryId));
  }

  return {
    remainingHours: newRemainingHours,
    totalHours,
    clientId: pkg.clientId,
    packageName: pkg.name,
    lowBalanceAlertSentAt: pkg.lowBalanceAlertSentAt,
    usageId: usage.id,
    hoursDeducted: hoursToDeduct,
    overdraftedHours: overdrafted > 0 ? overdrafted : undefined,
  };
}

/**
 * Reverse ALL usage recorded against a time entry and restore the package
 * balance. Shared by time.update/quickUpdateHours/updateTimes/delete so the
 * reversal semantics (incl. resetting the low-balance alert so it can fire
 * again after the balance went back up) stay identical everywhere.
 * Returns the number of hours restored.
 */
export async function reversePrepaidUsage(
  tx: Parameters<Parameters<typeof import("@/lib/db").db.transaction>[0]>[0],
  timeEntryId: string,
  packageId: string,
): Promise<number> {
  // Lock the package row FIRST so concurrent reversals of the same entry
  // serialize — the usage-read must be atomic with the balance-write
  // (mirrors deductHoursCore). Without this, two overlapping edits could
  // read the same usage rows and double-restore the balance.
  await tx
    .select({ id: prepaidPackages.id })
    .from(prepaidPackages)
    .where(eq(prepaidPackages.id, packageId))
    .for("no key update");

  const usageRecords = await tx.query.prepaidUsage.findMany({
    where: eq(prepaidUsage.timeEntryId, timeEntryId),
  });
  const totalUsed = usageRecords.reduce(
    (sum, u) => sum + Number(u.hoursUsed),
    0,
  );
  // Eksakt attribution (#93, review-fund): DENNE posts overtræks-andel
  // er gemt på usage-rækkerne — at udlede den af pakkens aggregerede
  // overdraftHours er ordens-afhængigt og kan slette gæld skabt af ANDRE
  // poster (fx: A skaber 3t gæld, B skaber 2t; reversal af A ville
  // nulstille alle 5).
  const totalOverdraft = usageRecords.reduce(
    (sum, u) => sum + Number(u.overdraftHours ?? 0),
    0,
  );
  if (totalUsed > 0) {
    const restoreToBalance = Math.max(0, totalUsed - totalOverdraft);
    await tx
      .update(prepaidPackages)
      .set({
        // Kun timer der IKKE var overtræk ryger tilbage på saldoen.
        // LEAST-cap (#206): en reversal må aldrig hæve remaining over
        // total (dobbelt-reversal/drift ville ellers skabe gratis timer —
        // og bryde DB-constrainten).
        remainingHours: sql`LEAST(${prepaidPackages.totalHours}, ${prepaidPackages.remainingHours} + ${restoreToBalance})`,
        overdraftHours: sql`GREATEST(0, ${prepaidPackages.overdraftHours} - ${totalOverdraft})`,
        usedHours: sql`GREATEST(0, ${prepaidPackages.usedHours} - ${restoreToBalance})`,
        lowBalanceAlertSentAt: null,
        updatedAt: new Date(),
      })
      .where(eq(prepaidPackages.id, packageId));
  }
  await tx
    .delete(prepaidUsage)
    .where(eq(prepaidUsage.timeEntryId, timeEntryId));
  return totalUsed;
}

/**
 * Check if a low-balance alert should be sent after a deduction.
 * Shared between deductHours and manualDeduct.
 */
export async function checkAndSendLowBalanceAlert(
  db: typeof DbType,
  userId: string,
  packageId: string,
  result: DeductResult,
) {
  if (result.totalHours <= 0) return;
  const percentageRemaining = (result.remainingHours / result.totalHours) * 100;

  if (
    percentageRemaining <= PREPAID_LOW_BALANCE_THRESHOLD * 100 &&
    !result.lowBalanceAlertSentAt
  ) {
    // Webhook: prepaid.low_balance fires alongside the alert email (gated by
    // the same lowBalanceAlertSentAt flag, so at most once per threshold
    // crossing under normal operation).
    const pkgRow = await db.query.prepaidPackages.findFirst({
      where: eq(prepaidPackages.id, packageId),
      columns: { organizationId: true },
    });
    emitWebhookEvent({
      userId,
      orgId: pkgRow?.organizationId ?? null,
      eventType: "prepaid.low_balance",
      eventId: packageId,
      data: {
        packageId,
        packageName: result.packageName,
        remainingHours: result.remainingHours,
        totalHours: result.totalHours,
        percentageRemaining: Math.round(percentageRemaining),
      },
      clientId: result.clientId,
    });

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, result.clientId),
    });

    if (user && client) {
      const alertRecipient = user.prepaidAlertRecipient || "owner";
      const recipients: string[] = [];

      if (alertRecipient === "owner" || alertRecipient === "both") {
        recipients.push(user.email);
      }
      if (
        (alertRecipient === "client" || alertRecipient === "both") &&
        client.email
      ) {
        recipients.push(client.email);
      }

      // Kundemodtagere sendes til portalen (#95) — dashboardet er lukket land
      const clientPortalUrl = recipients.some((r) => r === client.email)
        ? await getClientPortalUrl(db, client.id)
        : null;

      let alertSentSuccessfully = false;
      for (const recipientEmail of recipients) {
        const isClient = recipientEmail === client.email;
        try {
          await sendLowBalanceAlert({
            to: recipientEmail,
            recipientName: isClient ? client.name : user.name,
            clientName: client.name,
            packageName: result.packageName,
            remainingHours: result.remainingHours.toFixed(2),
            totalHours: result.totalHours.toFixed(2),
            percentageRemaining: Math.round(percentageRemaining),
            portalUrl: isClient ? clientPortalUrl : null,
            recipient: isClient ? "client" : "owner",
            senderName: user.name,
            senderEmail: user.email,
          });
          alertSentSuccessfully = true;
        } catch (error) {
          console.error("Failed to send low balance alert:", error);
        }
      }

      if (alertSentSuccessfully) {
        await db
          .update(prepaidPackages)
          .set({ lowBalanceAlertSentAt: new Date() })
          .where(eq(prepaidPackages.id, packageId));
      }
    }
  }
}

const prepaidPackageInput = z.object({
  name: z.string().min(2, { error: () => st("zod.nameMin2") }),
  clientId: z.string().uuid({ error: () => st("zod.selectClient") }),
  totalHours: z.number().min(0.01, { error: () => st("zod.hoursMin") }),
  hourlyRate: z.number().min(0, { error: () => st("zod.hourlyRateMin0") }),
  purchaseDate: z.string(),
  expiryDate: z.string().optional(),
  description: z.string().optional(),
  // Clip size in minutes — null or 0 means exact hours, positive = round up
  clipSizeMinutes: z.number().int().min(1).max(480).nullable().optional(),
  // Overtræks-politik (#93)
  overdraftPolicy: z.enum(["block", "allow", "invoice"]).optional(),
  overdraftRate: z.number().min(0).nullable().optional(),
  // Auto-træk: foreslå kortet som default ved nye registreringer på kunden
  autoDeduct: z.boolean().optional(),
});

// Klippekort-læsninger, der også kræver aktivt abonnement (#1116).
const klippekortSubscribedReadProcedure =
  subscribedModuleReadProcedure("klippekort");

/**
 * Klippekort i scope, filtreret på kundeadgang. Delt af klippekortsiden
 * (`list`, kræver klippekort-adgang) og kortvalget i tidsregistreringen
 * (`listForTime`, kræver kun tids-adgang, #1116).
 */
async function listPrepaidPackages(
  db: typeof DbType,
  userId: string,
  orgId: string | null,
  input?: {
    clientId?: string;
    activeOnly?: boolean;
    includeArchived?: boolean;
  },
) {
  const conditions = [
    orgId
      ? eq(prepaidPackages.organizationId, orgId)
      : eq(prepaidPackages.userId, userId),
  ];

  if (input?.clientId) {
    conditions.push(eq(prepaidPackages.clientId, input.clientId));
  }

  if (input?.activeOnly) {
    conditions.push(eq(prepaidPackages.isActive, true));
  }

  if (!input?.includeArchived) {
    conditions.push(ne(prepaidPackages.isArchived, true));
  }

  let packages = await db.query.prepaidPackages.findMany({
    where: and(...conditions),
    orderBy: [desc(prepaidPackages.purchaseDate)],
    with: {
      client: true,
    },
  });

  // Filter by client access restrictions for org members
  if (orgId) {
    const { getAccessibleClientIds } = await import("./clientAccess");
    const accessibleIds = await getAccessibleClientIds(db, userId, orgId);
    if (accessibleIds !== null) {
      packages = packages.filter((pkg) => {
        return pkg.clientId ? accessibleIds.includes(pkg.clientId) : true;
      });
    }
  }

  // Skjul kroner pr. kort: kundens valg vinder, ellers brugerens standard.
  const viewer = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { hidePrepaidValue: true },
  });
  return packages.map((pkg) => ({
    ...pkg,
    hideValue: resolveHidePrepaidValue(
      pkg.client?.hidePrepaidValue,
      viewer?.hidePrepaidValue,
    ),
  }));
}

const assignablePackageProcedure = moduleReadProcedure("klippekort")
  .input(
    z.object({
      packageId: z.string().uuid(),
      includeOtherCards: z.boolean().default(false),
    }),
  )
  .use(async ({ ctx, input, next }) => {
    const userId = ctx.session.user.id;
    const ownershipFilter = ctx.orgId
      ? eq(prepaidPackages.organizationId, ctx.orgId)
      : eq(prepaidPackages.userId, userId);

    const pkg = await ctx.db.query.prepaidPackages.findFirst({
      where: and(eq(prepaidPackages.id, input.packageId), ownershipFilter),
      columns: { id: true, clientId: true },
    });
    if (!pkg) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "common.prepaidNotFound"),
      });
    }
    await assertClientAccess(ctx.db, userId, ctx.orgId, pkg.clientId);

    const lockedBefore = ctx.orgId
      ? await getEffectivePeriodLock(ctx.db, ctx.orgId)
      : null;
    return next({
      ctx: {
        assignablePackage: pkg,
        assignableOwnership: ownershipFilter,
        lockedBefore,
      },
    });
  });

function assignableEntriesQuery(
  ctx: {
    db: typeof DbType;
    orgId: string | null;
    session: { user: { id: string } };
    assignablePackage: { id: string; clientId: string };
    assignableOwnership: ReturnType<typeof eq>;
    lockedBefore: Date | null;
  },
  filters: {
    includeOtherCards: boolean;
    projectId?: string;
    timeEntryIds?: string[];
    from?: string;
    to?: string;
  },
) {
  const { db, orgId, assignablePackage: pkg, assignableOwnership } = ctx;
  const unlinked = and(
    sql`COALESCE(${timeEntries.isPrepaid}, false) = false`,
    isNull(timeEntries.prepaidPackageId),
  );
  return db
    .select({
      id: timeEntries.id,
      date: timeEntries.date,
      description: timeEntries.description,
      hours: timeEntries.hours,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      prepaidPackageId: prepaidPackages.id,
      prepaidPackageName: prepaidPackages.name,
      prepaidHoursRestored: sql<number>`GREATEST(0, COALESCE((
        SELECT SUM(${prepaidUsage.hoursUsed} - COALESCE(${prepaidUsage.overdraftHours}, 0))
        FROM ${prepaidUsage}
        WHERE ${prepaidUsage.timeEntryId} = ${timeEntries.id}
          AND ${prepaidUsage.prepaidPackageId} = ${prepaidPackages.id}
      ), 0))`
        .mapWith(Number)
        .as("prepaid_hours_restored"),
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(
      prepaidPackages,
      and(
        eq(timeEntries.prepaidPackageId, prepaidPackages.id),
        filters.timeEntryIds ? undefined : ne(prepaidPackages.id, pkg.id),
        eq(prepaidPackages.clientId, pkg.clientId),
        assignableOwnership,
      ),
    )
    .where(
      and(
        orgId
          ? eq(timeEntries.organizationId, orgId)
          : eq(timeEntries.userId, ctx.session.user.id),
        filters.timeEntryIds
          ? inArray(timeEntries.id, filters.timeEntryIds)
          : undefined,
        filters.includeOtherCards
          ? or(unlinked, isNotNull(prepaidPackages.id))
          : unlinked,
        // Match the billed lock enforced by bulkAssignEntries.
        sql`COALESCE(${timeEntries.isBilled}, false) = false`,
        isNull(timeEntries.invoiceId),
        ctx.lockedBefore ? gte(timeEntries.date, ctx.lockedBefore) : undefined,
        sql`COALESCE(${timeEntries.clientId}, ${projects.clientId}) = ${pkg.clientId}`,
        filters.projectId
          ? eq(timeEntries.projectId, filters.projectId)
          : undefined,
        filters.from
          ? gte(timeEntries.date, new Date(filters.from))
          : undefined,
        filters.to
          ? lt(timeEntries.date, sql`${filters.to}::date + interval '1 day'`)
          : undefined,
      ),
    );
}

export const prepaidRouter = router({
  // Klippekort-discovery (#90): kunder uden aktivt klippekort med fast,
  // mindre månedlig tid — med et forudfyldt forslag (timer/pris ud fra
  // historikken). Afviste kunder er filtreret fra.
  suggestions: moduleWriteProcedure("klippekort")
    .input(
      z
        .object({
          clientId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(10).default(1),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return loadPrepaidSuggestions(
        ctx.db,
        { userId: ctx.session.user.id, orgId: ctx.orgId },
        { clientId: input?.clientId, limit: input?.limit ?? 1 },
      );
    }),

  // Get active prepaid packages for a specific client (for timer save modal)
  getActiveForClient: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        /**
         * Behold ALTID denne pakke i listen, også hvis den er tom eller
         * udløbet. Redigering af en post der allerede er trukket på et
         * opbrugt kort skal kunne vise (og beholde) sit eget kort.
         */
        includePackageId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const scopeFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const packages = await ctx.db.query.prepaidPackages.findMany({
        where: and(
          scopeFilter,
          eq(prepaidPackages.clientId, input.clientId),
          // isActive-filteret slækkes kun for den eksplicit medtagne pakke
          input.includePackageId
            ? sql`(${prepaidPackages.isActive} = true OR ${prepaidPackages.id} = ${input.includePackageId})`
            : eq(prepaidPackages.isActive, true),
        ),
        orderBy: [desc(prepaidPackages.purchaseDate)],
      });

      // Filter out packages with no remaining hours or expired
      const now = new Date();
      return packages
        .filter((pkg) => {
          if (pkg.id === input.includePackageId) return true;
          // Et tomt kort med overtræk tilladt kan stadig vælges (#1319)
          if (!canTakePrepaidHours(pkg)) return false;
          if (isPrepaidExpired(pkg.expiryDate, now)) return false;
          return true;
        })
        .map((pkg) => ({
          id: pkg.id,
          name: pkg.name,
          remainingHours: parseFloat(pkg.remainingHours || "0"),
          hourlyRate: parseFloat(pkg.hourlyRate || "0"),
          expiryDate: pkg.expiryDate,
          // Tie-break i auto-valget: ældste kort først (A1 P2-6)
          purchaseDate: pkg.purchaseDate,
          clipSizeMinutes: pkg.clipSizeMinutes,
          autoDeduct: pkg.autoDeduct,
          overdraftPolicy: pkg.overdraftPolicy,
        }));
    }),

  // Hurtig-kontakt på kortet: skal nye registreringer på kunden foreslå
  // dette kort? Spejler setRenewal (kolonne-only update, ingen saldo-rør).
  setAutoDeduct: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        packageId: z.string().uuid(),
        autoDeduct: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);

      const pkg = await ctx.db.query.prepaidPackages.findFirst({
        where: and(eq(prepaidPackages.id, input.packageId), ownershipFilter),
        columns: { id: true, clientId: true },
      });
      if (!pkg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.prepaidNotFound"),
        });
      }
      await assertClientAccess(ctx.db, userId, ctx.orgId, pkg.clientId);

      await ctx.db
        .update(prepaidPackages)
        .set({ autoDeduct: input.autoDeduct, updatedAt: new Date() })
        .where(eq(prepaidPackages.id, input.packageId));

      return { autoDeduct: input.autoDeduct };
    }),

  /** Kandidater til at tilknytte eller flytte tid for kortets kunde. */
  getAssignableEntries: assignablePackageProcedure
    .input(
      z.object({
        timeEntryIds: z
          .array(z.string().uuid())
          .min(1)
          .max(MAX_PREPAID_ASSIGN_SELECTION)
          .optional(),
        limit: z.number().int().min(1).max(500).default(200),
        offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
        projectId: z.string().uuid().optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await assignableEntriesQuery(ctx, input)
        .orderBy(desc(timeEntries.date), desc(timeEntries.id))
        .limit(input.limit)
        .offset(input.offset);

      return rows.map((row) => ({ ...row, hours: Number(row.hours) }));
    }),

  getAssignableProjects: assignablePackageProcedure.query(
    async ({ ctx, input }) => {
      const entries = assignableEntriesQuery(ctx, input).as(
        "assignable_entries",
      );

      return ctx.db
        .selectDistinct({ id: projects.id, name: projects.name })
        .from(entries)
        .innerJoin(projects, eq(entries.projectId, projects.id))
        .orderBy(projects.name, projects.id);
    },
  ),

  /**
   * Aktive kort for den kunde et udvalg af tidsposter tilhører. Bruges af
   * bulk-handlingen på tidsoversigten: klienten kender ikke nødvendigvis
   * postens kunde (den kan være arvet fra projektet), og et udvalg på tværs
   * af flere kunder skal afvises FØR brugeren vælger et kort.
   */
  getPackagesForEntries: moduleReadProcedure("klippekort")
    .input(
      z.object({
        timeEntryIds: z
          .array(z.string().uuid())
          .min(1)
          .max(MAX_PREPAID_ASSIGN_SELECTION),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const rows = await ctx.db
        .select({
          clientId: sql<
            string | null
          >`COALESCE(${timeEntries.clientId}, ${projects.clientId})`,
        })
        .from(timeEntries)
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .where(
          and(
            inArray(timeEntries.id, input.timeEntryIds),
            ctx.orgId
              ? eq(timeEntries.organizationId, ctx.orgId)
              : eq(timeEntries.userId, userId),
          ),
        );

      if (rows.length !== input.timeEntryIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "prepaid.entriesNotFound"),
        });
      }
      const clientIds = new Set(rows.map((r) => r.clientId));
      const clientId = rows[0]?.clientId;
      if (!clientId || clientIds.has(null)) {
        return {
          clientId: null,
          clientName: null,
          packages: [],
        };
      }
      if (clientIds.size > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "prepaid.multipleClients"),
        });
      }

      await assertClientAccess(ctx.db, userId, ctx.orgId, clientId);

      const client = await ctx.db.query.clients.findFirst({
        where: eq(clients.id, clientId),
        columns: { name: true },
      });

      const packages = await ctx.db.query.prepaidPackages.findMany({
        where: and(
          ctx.orgId
            ? eq(prepaidPackages.organizationId, ctx.orgId)
            : eq(prepaidPackages.userId, userId),
          eq(prepaidPackages.clientId, clientId),
          eq(prepaidPackages.isActive, true),
          sql`${prepaidPackages.isArchived} is not true`,
        ),
        orderBy: [desc(prepaidPackages.purchaseDate)],
        columns: {
          id: true,
          name: true,
          remainingHours: true,
          clipSizeMinutes: true,
          overdraftPolicy: true,
          expiryDate: true,
        },
      });

      const now = new Date();
      return {
        clientId,
        clientName: client?.name ?? null,
        packages: packages
          .filter((p) => !isPrepaidExpired(p.expiryDate, now))
          .map((p) => ({
            id: p.id,
            name: p.name,
            clipSizeMinutes: p.clipSizeMinutes,
            overdraftPolicy: p.overdraftPolicy,
            remainingHours: parseFloat(p.remainingHours || "0"),
          })),
      };
    }),

  /**
   * Bulk: træk et udvalg af eksisterende tidsposter på kortet. Genbruger
   * deductHoursCore/reversePrepaidUsage, så klip-afrunding, overtræks-
   * politik og saldo-invarianter er de samme som ved en enkelt post.
   * Alt-eller-intet: løber kortet tørt undervejs, ruller hele batchen
   * tilbage med deductHoursCore's besked om den faktiske restsaldo.
   */
  bulkAssignEntries: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        packageId: z.string().uuid(),
        timeEntryIds: z
          .array(z.string().uuid())
          .min(1)
          .max(MAX_PREPAID_ASSIGN_SELECTION),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);

      const pkg = await ctx.db.query.prepaidPackages.findFirst({
        where: and(eq(prepaidPackages.id, input.packageId), ownershipFilter),
        columns: { id: true, clientId: true, name: true },
      });
      if (!pkg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.prepaidNotFound"),
        });
      }
      await assertClientAccess(ctx.db, userId, ctx.orgId, pkg.clientId);

      const selectedEntriesFilter = and(
        inArray(timeEntries.id, input.timeEntryIds),
        ctx.orgId
          ? eq(timeEntries.organizationId, ctx.orgId)
          : eq(timeEntries.userId, userId),
      );

      const assign = async (
        tx: Parameters<Parameters<typeof DbType.transaction>[0]>[0],
      ) => {
        const sources = await tx
          .select({ packageId: timeEntries.prepaidPackageId })
          .from(timeEntries)
          .where(selectedEntriesFilter);
        const packageIds = new Set([pkg.id]);
        for (const { packageId } of sources) {
          if (packageId) packageIds.add(packageId);
        }
        // Keep card locks ahead of entry locks, as in single-entry edits.
        // Opposite moves must acquire the same cards in the same order.
        await lockPrepaidPackages(tx, [...packageIds]);

        const entries = await tx
          .select({
            id: timeEntries.id,
            date: timeEntries.date,
            userId: timeEntries.userId,
            approvalStatus: timeEntries.approvalStatus,
            hours: timeEntries.hours,
            isBilled: timeEntries.isBilled,
            invoiceId: timeEntries.invoiceId,
            prepaidPackageId: timeEntries.prepaidPackageId,
            effectiveClientId: sql<
              string | null
            >`COALESCE(${timeEntries.clientId}, ${projects.clientId})`,
          })
          .from(timeEntries)
          .leftJoin(projects, eq(timeEntries.projectId, projects.id))
          .where(selectedEntriesFilter)
          // Process entries in the same order as the dialog preview.
          .orderBy(desc(timeEntries.date), desc(timeEntries.id))
          .for("update", { of: timeEntries });

        if (entries.length !== input.timeEntryIds.length) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "prepaid.entriesNotFound"),
          });
        }

        // A concurrent move may have changed the source while we waited.
        // Retry in a fresh transaction to acquire the new set in order.
        if (
          entries.some(
            (entry) =>
              entry.prepaidPackageId && !packageIds.has(entry.prepaidPackageId),
          )
        ) {
          return null;
        }

        assertNoEntriesBilled(entries, "flyttes");
        await assertEntriesEditable(tx, {
          orgId: ctx.orgId,
          actorUserId: userId,
          entries,
        });

        const { toAssign, alreadyOnPackage, foreign } = planBulkAssign(
          pkg.id,
          pkg.clientId,
          entries,
        );
        if (foreign.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "prepaid.foreignEntries", {
              count: foreign.length,
            }),
          });
        }

        let last: DeductResult | undefined;
        let overflowed = 0;
        let hoursDeducted = 0;
        for (const entry of toAssign) {
          // Flytter posten fra et andet kort: det gamle træk skal føres
          // tilbage før det nye lægges på, ellers tælles timerne to steder.
          if (entry.prepaidPackageId) {
            await reversePrepaidUsage(tx, entry.id, entry.prepaidPackageId);
          }
          const result = await deductHoursCore(tx, userId, ctx.orgId, {
            packageId: pkg.id,
            hours: Number(entry.hours),
            timeEntryId: entry.id,
            // planBulkAssign har allerede afvist fremmede kunder (`foreign`).
            clientId: entry.effectiveClientId,
          });
          // deductHoursCore markerer selv posten som prepaid (og sætter den
          // fakturerbar igen ved invoice-politikken, #93) — her tælles der
          // kun op til kvitteringen.
          if (result.overflowedToInvoice) {
            overflowed++;
          } else {
            hoursDeducted += result.hoursDeducted;
          }
          last = result;
        }
        return {
          last,
          assigned: toAssign.length - overflowed,
          alreadyOnPackage: alreadyOnPackage.length,
          overflowed,
          hoursDeducted,
        };
      };

      let assignment = await ctx.db.transaction(assign);
      for (let retry = 0; assignment === null && retry < 2; retry++) {
        assignment = await ctx.db.transaction(assign);
      }
      if (assignment === null) {
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr("klippekort", "assign.failed"),
        });
      }

      const { last, ...result } = assignment;
      if (last) {
        await checkAndSendLowBalanceAlert(ctx.db, userId, pkg.id, last);
      }

      trackEvent({
        userId,
        orgId: ctx.orgId,
        event: "prepaid.bulk_assigned",
      });

      return {
        ...result,
        remainingHours: last?.remainingHours ?? null,
        packageName: pkg.name,
      };
    }),

  // List all prepaid packages
  list: moduleReadProcedure("klippekort")
    .input(
      z
        .object({
          clientId: z.string().uuid().optional(),
          activeOnly: z.boolean().optional(),
          includeArchived: z.boolean().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      listPrepaidPackages(ctx.db, ctx.session.user.id, ctx.orgId, input),
    ),

  // Kortvalget i timeren og på "Ny tidsregistrering": kundens aktive
  // kort. Kræver kun adgang til tid, så en rolle med "none" på
  // klippekort stadig kan trække tiden på et kort (#1116). Kunderækken
  // sendes ikke med; kortvalget bruger den ikke.
  listForTime: moduleReadProcedure("time")
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const packages = await listPrepaidPackages(
        ctx.db,
        ctx.session.user.id,
        ctx.orgId,
        { clientId: input.clientId, activeOnly: true },
      );
      return packages.map(({ client: _client, ...pkg }) => pkg);
    }),

  // Get package by ID
  getById: moduleReadProcedure("klippekort")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const pkg = await ctx.db.query.prepaidPackages.findFirst({
        where: and(
          eq(prepaidPackages.id, input.id),
          ctx.orgId
            ? eq(prepaidPackages.organizationId, ctx.orgId)
            : eq(prepaidPackages.userId, userId),
        ),
        with: {
          client: true,
          usageHistory: {
            orderBy: [desc(prepaidUsage.createdAt)],
            with: {
              timeEntry: {
                with: {
                  project: true,
                },
              },
            },
          },
        },
      });

      if (!pkg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.prepaidNotFound"),
        });
      }
      // Respect per-member client access (klippekort may be client-less).
      if (pkg.clientId) {
        const { assertClientAccess } = await import("./clientAccess");
        await assertClientAccess(ctx.db, userId, ctx.orgId, pkg.clientId);
      }

      // Skjul kroner: kundens valg vinder, ellers brugerens globale standard.
      const viewer = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { hidePrepaidValue: true },
      });
      const hideValue = resolveHidePrepaidValue(
        pkg.client?.hidePrepaidValue,
        viewer?.hidePrepaidValue,
      );

      return { ...pkg, hideValue };
    }),

  // Create prepaid package
  // Genkøbs-anmodninger fra portalen (#80)
  listRenewalRequests: moduleReadProcedure("klippekort").query(
    async ({ ctx }) => {
      const userId = ctx.session.user.id;
      // Per-medlem klientadgang (review-fund) — samme værn som list/getById
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, userId, ctx.orgId)
        : null;
      if (accessibleIds !== null && accessibleIds.length === 0) {
        return [];
      }
      return ctx.db.query.prepaidRenewalRequests.findMany({
        where: and(
          ctx.orgId
            ? eq(prepaidRenewalRequests.organizationId, ctx.orgId)
            : eq(prepaidRenewalRequests.freelancerId, userId),
          eq(prepaidRenewalRequests.status, "pending"),
          accessibleIds !== null
            ? inArray(prepaidRenewalRequests.clientId, accessibleIds)
            : undefined,
        ),
        orderBy: (r, { desc: d }) => [d(r.createdAt)],
        with: {
          prepaidPackage: { columns: { id: true, name: true } },
          client: { columns: { id: true, name: true } },
        },
      });
    },
  ),

  // Godkend med ét klik: ny pakke + fakturakladde via samme delte
  // fornyelses-transaktion som #79-cronen (ingen duplikeret penge-logik)
  resolveRenewalRequest: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        requestId: z.string().uuid(),
        approve: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const request = await ctx.db.query.prepaidRenewalRequests.findFirst({
        where: and(
          eq(prepaidRenewalRequests.id, input.requestId),
          ctx.orgId
            ? eq(prepaidRenewalRequests.organizationId, ctx.orgId)
            : eq(prepaidRenewalRequests.freelancerId, userId),
          eq(prepaidRenewalRequests.status, "pending"),
        ),
      });
      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "prepaid.requestNotFound"),
        });
      }
      await assertClientAccess(ctx.db, userId, ctx.orgId, request.clientId);

      if (!input.approve) {
        await ctx.db
          .update(prepaidRenewalRequests)
          .set({ status: "declined", resolvedAt: new Date() })
          .where(eq(prepaidRenewalRequests.id, input.requestId));
        return { approved: false, invoiceId: null };
      }

      const now = new Date();
      const invoiceId = await ctx.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(prepaidPackages)
          .where(eq(prepaidPackages.id, request.prepaidPackageId))
          .for("update");
        if (!locked) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "prepaid.gone"),
          });
        }
        if (!locked.isActive) {
          // Allerede fornyet (fx af #79-cronen) — markér blot anmodningen
          await tx
            .update(prepaidRenewalRequests)
            .set({ status: "approved", resolvedAt: now })
            .where(eq(prepaidRenewalRequests.id, input.requestId));
          return null;
        }
        const renewal = await renewPackageInTx(tx, locked, now, {
          invoiceNote: await tr("serverErrors", "prepaid.renewalInvoiceNote", {
            name: locked.name,
          }),
        });
        await tx
          .update(prepaidRenewalRequests)
          .set({ status: "approved", resolvedAt: now })
          .where(eq(prepaidRenewalRequests.id, input.requestId));
        return renewal.draftInvoiceId;
      });

      trackEvent({
        userId,
        orgId: ctx.orgId,
        event: "prepaid.renewal_approved",
      });

      return { approved: true, invoiceId };
    }),

  // Periodiske klippekort (#79): slå auto-fornyelse til/fra pr. pakke
  setRenewal: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        packageId: z.string().uuid(),
        interval: z.enum(["monthly", "quarterly", "yearly"]).nullable(),
        rollover: z.enum(["none", "carry"]).default("none"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);

      const pkg = await ctx.db.query.prepaidPackages.findFirst({
        where: and(eq(prepaidPackages.id, input.packageId), ownershipFilter),
        columns: {
          id: true,
          clientId: true,
          totalHours: true,
          renewalInterval: true,
          renewalNextAt: true,
          renewalBaseHours: true,
        },
      });
      if (!pkg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.prepaidNotFound"),
        });
      }
      await assertClientAccess(ctx.db, userId, ctx.orgId, pkg.clientId);

      // Bevar næste fornyelsesdato når kun rollover ændres (review-
      // fund) — et checkbox-klik må ikke udskyde en nært forestående
      // fornyelse.
      const intervalChanged = input.interval !== pkg.renewalInterval;
      const renewalNextAt = !input.interval
        ? null
        : intervalChanged || !pkg.renewalNextAt
          ? computeNextRenewal(new Date(), input.interval)
          : pkg.renewalNextAt;

      await ctx.db
        .update(prepaidPackages)
        .set({
          renewalInterval: input.interval,
          renewalRollover: input.rollover,
          renewalNextAt,
          // Kædens grundtimer låses ved aktivering (compounding-værn)
          renewalBaseHours: input.interval
            ? (pkg.renewalBaseHours ?? pkg.totalHours)
            : null,
          updatedAt: new Date(),
        })
        .where(eq(prepaidPackages.id, input.packageId));

      // Koblet gentagen faktura (#198) følger kortets fornyelse
      await syncPrepaidLinkedRecurringInvoice(
        ctx.db,
        input.packageId,
        input.interval && renewalNextAt
          ? { interval: input.interval, nextAt: renewalNextAt }
          : null,
      );

      return { renewalNextAt };
    }),

  create: moduleWriteProcedure("klippekort")
    .input(prepaidPackageInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify client belongs to user/org
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.clientNotFound"),
        });
      }

      const totalValue = input.totalHours * input.hourlyRate;

      const [newPackage] = await ctx.db
        .insert(prepaidPackages)
        .values({
          userId,
          organizationId: ctx.orgId,
          clientId: input.clientId,
          name: input.name,
          totalHours: input.totalHours.toString(),
          usedHours: "0",
          remainingHours: input.totalHours.toString(),
          hourlyRate: input.hourlyRate.toString(),
          totalValue: totalValue.toString(),
          purchaseDate: new Date(input.purchaseDate),
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
          description: input.description || null,
          clipSizeMinutes: input.clipSizeMinutes || null,
          overdraftPolicy: input.overdraftPolicy ?? "block",
          overdraftRate:
            input.overdraftRate != null ? input.overdraftRate.toString() : null,
          autoDeduct: input.autoDeduct ?? true,
          isActive: true,
        })
        .returning();

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "prepaid.created",
        eventId: newPackage.id,
        data: { prepaidPackage: newPackage },
        clientId: newPackage.clientId,
      });

      trackEvent({
        userId,
        orgId: ctx.orgId,
        event: "prepaid.created",
        // Måling (#90): kobles til nudge.clicked på samme kunde
        metadata: { clientId: input.clientId },
      });

      return newPackage;
    }),

  // Update prepaid package
  update: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        id: z.string().uuid(),
        data: prepaidPackageInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Use transaction with FOR UPDATE to prevent race with concurrent deductions
      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const updatedPackage = await ctx.db.transaction(async (tx) => {
        const [existingPackage] = await tx
          .select()
          .from(prepaidPackages)
          .where(and(eq(prepaidPackages.id, input.id), ownershipFilter))
          .for("update");

        if (!existingPackage) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.prepaidNotFound"),
          });
        }

        // If clientId is being changed, verify the new client belongs to user —
        // otherwise subsequent joins on prepaidPackages.client would leak the
        // name of another tenant's client.
        if (input.data.clientId !== existingPackage.clientId) {
          const newClient = await tx.query.clients.findFirst({
            where: and(
              eq(clients.id, input.data.clientId),
              ctx.orgId
                ? eq(clients.organizationId, ctx.orgId)
                : eq(clients.userId, userId),
            ),
            columns: { id: true },
          });
          if (!newClient) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: await tr("serverErrors", "common.clientNotFound"),
            });
          }
        }

        // Calculate new remaining hours if total hours changed. En total
        // under det brugte afvises før skrivningen (A1 P2-7) — prod-
        // constrainten check_hours_consistency gav ellers en rå 500.
        const currentUsed = parseFloat(existingPackage.usedHours || "0");
        const newRemaining = remainingAfterTotalChange(
          input.data.totalHours,
          currentUsed,
        );
        if (newRemaining === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "prepaid.totalBelowUsed", {
              used: roundPrepaidHours(currentUsed).toLocaleString(
                toIntlLocale(activeLocale()),
              ),
            }),
          });
        }
        const totalValue = input.data.totalHours * input.data.hourlyRate;

        const [updated] = await tx
          .update(prepaidPackages)
          .set({
            name: input.data.name,
            clientId: input.data.clientId,
            totalHours: input.data.totalHours.toString(),
            remainingHours: newRemaining.toString(),
            hourlyRate: input.data.hourlyRate.toString(),
            totalValue: totalValue.toString(),
            purchaseDate: new Date(input.data.purchaseDate),
            expiryDate: input.data.expiryDate
              ? new Date(input.data.expiryDate)
              : null,
            description: input.data.description || null,
            clipSizeMinutes: input.data.clipSizeMinutes || null,
            ...(input.data.overdraftPolicy
              ? { overdraftPolicy: input.data.overdraftPolicy }
              : {}),
            ...(input.data.overdraftRate !== undefined
              ? {
                  overdraftRate:
                    input.data.overdraftRate != null
                      ? input.data.overdraftRate.toString()
                      : null,
                }
              : {}),
            ...(input.data.autoDeduct !== undefined
              ? { autoDeduct: input.data.autoDeduct }
              : {}),
          })
          .where(eq(prepaidPackages.id, input.id))
          .returning();

        return updated;
      });

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "prepaid.updated",
        eventId: updatedPackage.id,
        data: { prepaidPackage: updatedPackage },
        clientId: updatedPackage.clientId,
      });

      return updatedPackage;
    }),

  // Top-up: add hours to existing package
  topUp: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        packageId: z.string().uuid(),
        hours: z.number().min(0.01, { error: () => st("zod.hoursMin") }),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const updatedPackage = await ctx.db.transaction(async (tx) => {
        const [pkg] = await tx
          .select()
          .from(prepaidPackages)
          .where(and(eq(prepaidPackages.id, input.packageId), ownershipFilter))
          .for("update");

        if (!pkg) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.prepaidNotFound"),
          });
        }

        const newTotal = parseFloat(pkg.totalHours || "0") + input.hours;
        const newRemaining =
          parseFloat(pkg.remainingHours || "0") + input.hours;
        const newTotalValue = newTotal * parseFloat(pkg.hourlyRate || "0");

        const [updated] = await tx
          .update(prepaidPackages)
          .set({
            totalHours: newTotal.toString(),
            remainingHours: newRemaining.toString(),
            totalValue: newTotalValue.toString(),
            isActive: true, // Reactivate if was inactive
            lowBalanceAlertSentAt: null, // Reset alert so it can fire again
          })
          .where(eq(prepaidPackages.id, input.packageId))
          .returning();

        return updated;
      });

      return updatedPackage;
    }),

  // Skjul/vis kortet for kunden i portalen (uafhængigt af aktiv/arkiveret).
  // kunde A 8/9-2026: et deaktiveret kort skal kunne fjernes helt fra
  // kundens overblik — ikke kun flyttes til "Tidligere".
  setPortalVisibility: moduleWriteProcedure("klippekort")
    .input(z.object({ id: z.string().uuid(), hidden: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const [updated] = await ctx.db
        .update(prepaidPackages)
        .set({ hiddenFromPortal: input.hidden })
        .where(and(eq(prepaidPackages.id, input.id), ownershipFilter))
        .returning({
          id: prepaidPackages.id,
          hiddenFromPortal: prepaidPackages.hiddenFromPortal,
        });
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.prepaidNotFound"),
        });
      }
      return updated;
    }),

  // Toggle active status
  toggleActive: moduleWriteProcedure("klippekort")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Use transaction with FOR UPDATE to prevent race with concurrent deductions
      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const updatedPackage = await ctx.db.transaction(async (tx) => {
        const [existingPackage] = await tx
          .select()
          .from(prepaidPackages)
          .where(and(eq(prepaidPackages.id, input.id), ownershipFilter))
          .for("update");

        if (!existingPackage) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.prepaidNotFound"),
          });
        }

        const [updated] = await tx
          .update(prepaidPackages)
          .set({
            isActive: !existingPackage.isActive,
          })
          .where(eq(prepaidPackages.id, input.id))
          .returning();

        return updated;
      });

      return updatedPackage;
    }),

  // Delete prepaid package (soft delete - deactivates the package)
  delete: moduleWriteProcedure("klippekort")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const existingPackage = await ctx.db.query.prepaidPackages.findFirst({
        where: and(eq(prepaidPackages.id, input.id), ownershipFilter),
        with: {
          usageHistory: true,
        },
      });

      if (!existingPackage) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.prepaidNotFound"),
        });
      }

      if (existingPackage.usageHistory.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "prepaid.hasUsage"),
        });
      }

      // Soft delete by deactivating the package
      await ctx.db
        .update(prepaidPackages)
        .set({
          isActive: false,
        })
        .where(eq(prepaidPackages.id, input.id));
      await syncPrepaidLinkedRecurringInvoice(ctx.db, input.id, null);

      return { success: true };
    }),

  // Archive/unarchive prepaid package
  archive: moduleWriteProcedure("klippekort")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const ownershipFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const existingPackage = await ctx.db.query.prepaidPackages.findFirst({
        where: and(eq(prepaidPackages.id, input.id), ownershipFilter),
      });

      if (!existingPackage) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.prepaidNotFound"),
        });
      }

      const newArchived = !existingPackage.isArchived;

      await ctx.db
        .update(prepaidPackages)
        .set({
          isArchived: newArchived,
          isActive: newArchived ? false : existingPackage.isActive,
        })
        .where(eq(prepaidPackages.id, input.id));
      if (newArchived) {
        await syncPrepaidLinkedRecurringInvoice(ctx.db, input.id, null);
      }

      return { success: true, isArchived: newArchived };
    }),

  // Get packages with low balance for a client — samme regel som overalt
  // ellers i UI'et og lav-saldo-mailen (#881), ikke en egen fast grænse.
  getLowBalance: moduleReadProcedure("klippekort")
    .input(
      z.object({
        clientId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const conditions = [
        ctx.orgId
          ? eq(prepaidPackages.organizationId, ctx.orgId)
          : eq(prepaidPackages.userId, userId),
        eq(prepaidPackages.isActive, true),
      ];

      if (input.clientId) {
        conditions.push(eq(prepaidPackages.clientId, input.clientId));
      }

      const packages = await ctx.db.query.prepaidPackages.findMany({
        where: and(...conditions),
        with: {
          client: true,
        },
      });

      return packages.filter((pkg) =>
        isPrepaidBalanceLow(
          parseFloat(pkg.remainingHours || "0"),
          parseFloat(pkg.totalHours || "0"),
        ),
      );
    }),

  // Deduct hours from a package (called when creating time entry)
  deductHours: subscribedProcedure
    .input(
      z.object({
        packageId: z.string().uuid(),
        timeEntryId: z.string().uuid(),
        hours: z.number().min(0.01),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Posten skal være kalderens, og fakturerede poster må ikke trækkes
      // på kortet (#702) — kunden har allerede betalt for dem.
      const entry = await ctx.db.query.timeEntries.findFirst({
        where: and(
          eq(timeEntries.id, input.timeEntryId),
          ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
        ),
        columns: {
          isBilled: true,
          invoiceId: true,
          clientId: true,
          projectId: true,
        },
      });
      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "prepaid.entryNotFound"),
        });
      }
      assertEntryNotBilled(entry);

      // Postens effektive kunde (CodeRabbit, PR #858): egen klient, ellers
      // projektets — deductHoursCore afviser et klippekort fra en anden kunde.
      let entryClientId = entry.clientId;
      if (!entryClientId && entry.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.id, entry.projectId),
          columns: { clientId: true },
        });
        entryClientId = project?.clientId ?? null;
      }

      // Use transaction with shared core logic
      const result = await ctx.db.transaction(async (tx) => {
        return deductHoursCore(tx, userId, ctx.orgId, {
          packageId: input.packageId,
          hours: input.hours,
          timeEntryId: input.timeEntryId,
          clientId: entryClientId,
        });
      });

      // Check and send low balance alert if threshold reached
      await checkAndSendLowBalanceAlert(
        ctx.db,
        userId,
        input.packageId,
        result,
      );

      return { success: true, remainingHours: result.remainingHours };
    }),

  // Manual deduct hours from a package (without time entry)
  manualDeduct: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        packageId: z.string().uuid(),
        hours: z.number().min(0.01, { error: () => st("zod.hoursMin") }),
        description: z
          .string()
          .min(1, { error: () => st("zod.descriptionRequired") }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Use transaction with shared core logic
      const result = await ctx.db.transaction(async (tx) => {
        return deductHoursCore(tx, userId, ctx.orgId, {
          packageId: input.packageId,
          hours: input.hours,
          description: input.description,
          // Intet tidspost at validere mod — trækket er direkte på pakken
          // (deductHoursCores kunde-tjek kører kun når timeEntryId er sat).
          clientId: null,
        });
      });

      // Check and send low balance alert if threshold reached
      await checkAndSendLowBalanceAlert(
        ctx.db,
        userId,
        input.packageId,
        result,
      );

      return {
        success: true,
        remainingHours: result.remainingHours,
        usageId: result.usageId,
      };
    }),

  // Aggregated klippekort report data for reports page
  getReport: klippekortSubscribedReadProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Fetch all non-archived packages with client and usage history
    const packages = await ctx.db.query.prepaidPackages.findMany({
      where: and(
        ctx.orgId
          ? eq(prepaidPackages.organizationId, ctx.orgId)
          : eq(prepaidPackages.userId, userId),
        ne(prepaidPackages.isArchived, true),
      ),
      with: {
        client: true,
        usageHistory: {
          orderBy: [desc(prepaidUsage.createdAt)],
        },
      },
      orderBy: [desc(prepaidPackages.purchaseDate)],
    });

    const now = new Date();

    // --- Per-client summary ---
    const clientMap = new Map<
      string,
      {
        clientId: string;
        clientName: string;
        totalPurchased: number;
        totalUsed: number;
        totalRemaining: number;
        totalValue: number;
        usedValue: number;
        remainingValue: number;
        packageCount: number;
        activeCount: number;
      }
    >();

    let activeCount = 0;
    let exhaustedCount = 0;
    let expiringSoonCount = 0;
    let totalPackages = 0;

    for (const pkg of packages) {
      totalPackages++;
      const totalHours = parseFloat(pkg.totalHours || "0");
      const usedHours = parseFloat(pkg.usedHours || "0");
      const remainingHours = parseFloat(pkg.remainingHours || "0");
      const hourlyRate = parseFloat(pkg.hourlyRate || "0");

      if (pkg.isActive && remainingHours > 0) {
        activeCount++;
      }
      if (remainingHours <= 0) {
        exhaustedCount++;
      }
      const daysToExpiry = prepaidDaysUntilExpiry(pkg.expiryDate, now);
      if (
        pkg.isActive &&
        daysToExpiry !== null &&
        daysToExpiry >= 0 &&
        daysToExpiry <= 30 &&
        remainingHours > 0
      ) {
        expiringSoonCount++;
      }

      const existing = clientMap.get(pkg.clientId) || {
        clientId: pkg.clientId,
        clientName: pkg.client.name,
        totalPurchased: 0,
        totalUsed: 0,
        totalRemaining: 0,
        totalValue: 0,
        usedValue: 0,
        remainingValue: 0,
        packageCount: 0,
        activeCount: 0,
      };

      existing.totalPurchased += totalHours;
      existing.totalUsed += usedHours;
      existing.totalRemaining += remainingHours;
      existing.totalValue += totalHours * hourlyRate;
      existing.usedValue += usedHours * hourlyRate;
      existing.remainingValue += remainingHours * hourlyRate;
      existing.packageCount++;
      if (pkg.isActive && remainingHours > 0) {
        existing.activeCount++;
      }

      clientMap.set(pkg.clientId, existing);
    }

    const perClient = Array.from(clientMap.values()).sort(
      (a, b) => b.totalRemaining - a.totalRemaining,
    );

    // --- Monthly usage breakdown ---
    const monthlyMap = new Map<
      string,
      { month: string; hoursUsed: number; valueUsed: number; count: number }
    >();

    for (const pkg of packages) {
      for (const usage of pkg.usageHistory) {
        const date = new Date(usage.createdAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const existing = monthlyMap.get(monthKey) || {
          month: monthKey,
          hoursUsed: 0,
          valueUsed: 0,
          count: 0,
        };
        existing.hoursUsed += parseFloat(usage.hoursUsed || "0");
        existing.valueUsed += parseFloat(usage.valueUsed || "0");
        existing.count++;
        monthlyMap.set(monthKey, existing);
      }
    }

    const monthlyUsage = Array.from(monthlyMap.values()).sort((a, b) =>
      b.month.localeCompare(a.month),
    );

    // --- Status summary ---
    const statusSummary = {
      total: totalPackages,
      active: activeCount,
      exhausted: exhaustedCount,
      expiringSoon: expiringSoonCount,
    };

    return {
      perClient,
      monthlyUsage,
      statusSummary,
    };
  }),

  // Get packages expiring within 30 days
  getExpiring: moduleReadProcedure("klippekort").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();

    const packages = await ctx.db.query.prepaidPackages.findMany({
      where: and(
        ctx.orgId
          ? eq(prepaidPackages.organizationId, ctx.orgId)
          : eq(prepaidPackages.userId, userId),
        eq(prepaidPackages.isActive, true),
      ),
      with: {
        client: true,
      },
      orderBy: [desc(prepaidPackages.expiryDate)],
    });

    // Filter packages expiring within 30 days and have remaining hours
    const expiringPackages = packages.filter((pkg) => {
      const days = prepaidDaysUntilExpiry(pkg.expiryDate, now);
      if (days === null) return false;
      const remainingHours = parseFloat(pkg.remainingHours || "0");
      if (remainingHours <= 0) return false;
      return days <= 30;
    });

    // Sort by expiry date (earliest first)
    expiringPackages.sort(
      (a, b) => (a.expiryDate?.getTime() || 0) - (b.expiryDate?.getTime() || 0),
    );

    // Calculate estimated value for each package
    return expiringPackages.map((pkg) => {
      const remainingHours = parseFloat(pkg.remainingHours || "0");
      const hourlyRate = parseFloat(pkg.hourlyRate || "0");
      const estimatedValue = Math.round(remainingHours * hourlyRate);
      // Hele danske kalenderdage (#736): 0 = udløber i dag (kortet gælder
      // hele udløbsdagen), negativ = udløbet — samme regel som træk-logikken.
      const days = prepaidDaysUntilExpiry(pkg.expiryDate, now) ?? 0;
      const isExpired = days < 0;

      return {
        id: pkg.id,
        name: pkg.name,
        clientName: pkg.client.name,
        clientId: pkg.clientId,
        remainingHours: Math.round(remainingHours * 10) / 10,
        totalHours: parseFloat(pkg.totalHours || "0"),
        expiryDate: pkg.expiryDate,
        estimatedValue,
        // Always a non-negative "days until expiry" for display (0 = "udløber
        // i dag"). Consumers should prefer isExpired to decide between
        // "Udløber om N dage" and "Udløbet for N dage siden".
        daysUntilExpiry: Math.max(0, days),
        daysSinceExpiry: isExpired ? -days : 0,
        isExpired,
      };
    });
  }),

  // Duplicate a klippekort (fresh copy with reset usage)
  duplicate: moduleWriteProcedure("klippekort")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId;

      const source = await ctx.db.query.prepaidPackages.findFirst({
        where: and(
          eq(prepaidPackages.id, input.id),
          orgId
            ? eq(prepaidPackages.organizationId, orgId)
            : eq(prepaidPackages.userId, userId),
        ),
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.prepaidNotFound"),
        });
      }

      const [copy] = await ctx.db
        .insert(prepaidPackages)
        .values({
          name: `${source.name} (kopi)`,
          clientId: source.clientId,
          userId,
          organizationId: orgId ?? null,
          totalHours: source.totalHours,
          usedHours: "0",
          remainingHours: source.totalHours,
          hourlyRate: source.hourlyRate,
          totalValue: source.totalValue,
          purchaseDate: new Date(),
          expiryDate: duplicatedPrepaidExpiry(
            source.purchaseDate,
            source.expiryDate,
          ),
          isActive: true,
          isArchived: false,
          description: source.description,
          clipSizeMinutes: source.clipSizeMinutes,
          // Kopien skal arve auto-træk: ellers får en duplikeret kopi af et
          // kort med auto-træk slået FRA kolonnens default (true) tilbage.
          autoDeduct: source.autoDeduct ?? true,
        })
        .returning();

      return copy;
    }),

  // --- Klippekort Templates ---

  listTemplates: klippekortSubscribedReadProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const scopeFilter = ctx.orgId
      ? eq(prepaidTemplates.organizationId, ctx.orgId)
      : eq(prepaidTemplates.userId, userId);
    return ctx.db.query.prepaidTemplates.findMany({
      where: scopeFilter,
      orderBy: [desc(prepaidTemplates.createdAt)],
    });
  }),

  createTemplate: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        name: z.string().min(1, { error: () => st("zod.nameRequired") }),
        totalHours: z.number().min(0.01),
        hourlyRate: z.number().min(0).optional(),
        clipSizeMinutes: z.number().int().min(1).max(480).nullable().optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [template] = await ctx.db
        .insert(prepaidTemplates)
        .values({
          userId,
          organizationId: ctx.orgId ?? null,
          name: input.name,
          totalHours: input.totalHours.toString(),
          hourlyRate: input.hourlyRate ? input.hourlyRate.toString() : null,
          clipSizeMinutes: input.clipSizeMinutes || null,
          description: input.description || null,
        })
        .returning();

      return template;
    }),

  deleteTemplate: moduleWriteProcedure("klippekort")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const ownershipFilter = ctx.orgId
        ? eq(prepaidTemplates.organizationId, ctx.orgId)
        : eq(prepaidTemplates.userId, userId);

      const template = await ctx.db.query.prepaidTemplates.findFirst({
        where: and(eq(prepaidTemplates.id, input.id), ownershipFilter),
      });

      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.templateNotFound"),
        });
      }

      await ctx.db
        .delete(prepaidTemplates)
        .where(eq(prepaidTemplates.id, input.id));

      return { success: true };
    }),
});
