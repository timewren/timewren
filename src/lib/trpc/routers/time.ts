import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { toIntlLocale } from "@/i18n/format-locale";
import { activeLocale, st, tr } from "@/i18n/server-text";
import { resolveApprovalWorkflow } from "@/lib/approval/resolve";
import { CLIENT_HEADER, parseClientHeader } from "@/lib/client-version";
import type * as schema from "@/lib/db/schema";
import {
  clients,
  clientTags,
  emailPreferences,
  generatedTimeEntries,
  invoices,
  memberRates,
  members,
  prepaidPackages,
  projects,
  projectTags,
  tasks,
  timeEntries,
  timeEntrySegments,
  timeEntryTags,
  users,
  weekClosures,
} from "@/lib/db/schema";
import { recordDeletionTombstones } from "@/lib/desktop-sync-tombstones";
import { sendFirstTimeEntryEmail } from "@/lib/email/engagement";
import { assertEntryCompliant } from "@/lib/enterprise/compliance-guard";
import { assertEntryEditable } from "@/lib/enterprise/edit-guard";
import {
  loadUnbilledByClient,
  loadUnbilledSummary,
} from "@/lib/invoicing/unbilled";
import { recordsFilter } from "@/lib/my-records/filter";
import { recordsInput } from "@/lib/my-records/records";
import { auditDiff, logOrgAudit } from "@/lib/org-audit";
import { canViewAllOrgTime } from "@/lib/permissions/server";
import {
  applySegmentHours,
  lookupProjectClientId,
  type PrepaidPatch,
  reconcilePrepaidAfterEdit,
  refundPrepaidForDeletion,
  sortForPackageLock,
} from "@/lib/prepaid/entry-sync";
import { resolvePrepaidReconcile } from "@/lib/prepaid/reconcile";
import {
  emptyScheduledChangeIndex,
  indexScheduledChanges,
  resolveRateAtDate,
  type ScheduledChangeIndex,
  toRateDateKey,
} from "@/lib/rates/scheduled";
import {
  loadScheduledChangesForScope,
  loadScheduledChangesForTargets,
} from "@/lib/rates/scheduled-db";
import { trackEvent } from "@/lib/telemetry/track";
import {
  assertBilledPatchAllowed,
  assertEntryNotBilled,
  assertNoEntriesBilled,
  isBilledLocked,
  isManualUnbill,
} from "@/lib/time/billed-lock";
import {
  entryBelongsToClient,
  sumClientEntries,
} from "@/lib/time/client-scope";
import {
  addDaysToDateStr,
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
  copenhagenTodayAnchor,
  entryDateFromStr,
  isDateStr,
  toCopenhagenDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";
import { dateUpperBound, startOfNextDay } from "@/lib/time/date-bounds";
import { resolveDefaultBillable } from "@/lib/time/default-billable";
import {
  entryDateStrFromInput,
  entryDateStrInput,
  hoursKey,
} from "@/lib/time/entry-date-input";
import { PREVIEW_RATE_MIN_HOURS } from "@/lib/time/preview-rate";
import {
  mergeIntoSameSessionEntry,
  type SameSessionMergeResult,
} from "@/lib/time/same-session-merge";
import { planSegmentAppend } from "@/lib/time/segment-append";
import { segmentShiftMs } from "@/lib/time/segment-shift";
import { weekClosureKey, weekClosureStreak } from "@/lib/time/week-closure";
import { logTimerEvent, timerEventOrigin } from "@/lib/timer/events";
import {
  findLegacySavedEntry,
  findOwnSession,
  findStoppingSessionForLegacySave,
  SessionAlreadySavedError,
  saveSessionEntry,
  withLegacyStopTarget,
} from "@/lib/timer/sessions";
import { resolveRoundingConfig, roundHours } from "@/lib/utils/rounding";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { badRequest, Errors, forbidden, notFound } from "../errors";
import { protectedProcedure, router, subscribedProcedure } from "../trpc";
import {
  checkAndSendLowBalanceAlert,
  deductHoursCore,
  reversePrepaidUsage,
} from "./prepaid";

// Schema for CSV import entries
const csvImportEntrySchema = z.object({
  // Bevidst en rå streng og ikke `entryDateStrInput`: importen rapporterer pr.
  // række (`results.errors`), så én ugyldig dato må ikke afvise hele filen.
  // Rækken læses i løkken med `entryDateStrFromInput`.
  date: z.string().max(30),
  hours: z.number().min(0.01),
  description: z.string().min(1).max(500),
  projectName: z.string().max(255).optional(),
  clientName: z.string().max(255).optional(),
});

const timeEntryBase = z.object({
  projectId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  description: z
    .string()
    .min(1, { error: () => st("zod.descriptionRequired") })
    .max(500),
  notes: z.string().max(5000).optional(), // Detailed notes/description for longer explanations
  hours: z.number().min(0.01, { error: () => st("zod.hoursMin") }),
  // Normaliseres til den danske dato ("yyyy-MM-dd") uanset om klienten sender
  // en dato, et ISO-tidspunkt eller dansk vægur; gemmes som UTC-midnat.
  date: entryDateStrInput,
  // Optional time range tracking - when work actually happened
  startTime: z.string().datetime({ offset: true }).optional(), // ISO 8601 med Z eller offset
  endTime: z.string().datetime({ offset: true }).optional(), // ISO 8601 med Z eller offset
  // Billable status - defaults to true if not specified
  isBillable: z.boolean().optional(),
  // Billed status - whether this entry has been invoiced
  isBilled: z.boolean().optional(),
  // Link to task for time blocking feature
  taskId: z.string().uuid().optional(),
  // Explicit billable rate override (decimal as string). When omitted, the
  // rate is derived from the rate hierarchy (member/project/client/user).
  billableRate: z.string().optional(),
  // Posten kommer fra et timer-stop (E11, #469): allerede registreret tid
  // må aldrig gå tabt — compliance-block nedgraderes til advarsel
  fromTimer: z.boolean().optional(),
});

const timeEntryRefines = <
  T extends z.ZodType<{ startTime?: string | null; endTime?: string | null }>,
>(
  schema: T,
) =>
  schema.refine(
    (data) => {
      if (data.startTime && data.endTime) {
        return new Date(data.endTime) > new Date(data.startTime);
      }
      return true;
    },
    {
      error: () => st("zod.endAfterStart"),
      path: ["endTime"],
    },
  );

const createTimeEntryInput = timeEntryRefines(
  timeEntryBase.extend({
    // Prepaid/klippekort: atomic deduction in same transaction. `null` (eller
    // `noPrepaid: true`) = brugeren har valgt intet klippekort; udeladt = som
    // før (desktop 0.2.24).
    prepaidPackageId: z.string().uuid().nullable().optional(),
    noPrepaid: z.boolean().optional(),
    prepaidHoursOverride: z.number().min(0.01).optional(),
    // Klient-genereret idempotensnøgle (offline-kø, #703). Samme nøgle på hvert
    // genforsøg; et gentaget kald returnerer den eksisterende post.
    clientEntryId: z.string().uuid().optional(),
    // Server-udstedt timer-session (fase 1): én session ⇒ højst én post
    // (unikt indeks). Et gentaget kald returnerer den eksisterende post.
    timerSessionId: z.string().uuid().optional(),
  }),
);

/**
 * Brugerens post med denne idempotensnøgle. Scopet på userId: nøglen er
 * globalt unik i indekset, men en anden brugers post må aldrig returneres.
 */
async function findEntryByClientEntryId(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  clientEntryId: string,
) {
  return db.query.timeEntries.findFirst({
    where: and(
      eq(timeEntries.clientEntryId, clientEntryId),
      eq(timeEntries.userId, userId),
    ),
  });
}

/**
 * Brugerens post for en timer-session: posten med `timer_session_id`, eller
 * den post sessionen er gemt i (fx forlænget ved "Fortsæt" eller lagt sammen).
 */
export async function findEntryForTimerSession(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  timerSessionId: string,
) {
  const direct = await db.query.timeEntries.findFirst({
    where: and(
      eq(timeEntries.timerSessionId, timerSessionId),
      eq(timeEntries.userId, userId),
    ),
  });
  if (direct) return direct;
  const session = await findOwnSession(db, userId, timerSessionId);
  if (!session?.savedEntryId) return undefined;
  return db.query.timeEntries.findFirst({
    where: and(
      eq(timeEntries.id, session.savedEntryId),
      eq(timeEntries.userId, userId),
    ),
  });
}

/** Svar på en gentaget oprettelse: samme form som en ny, ingen sideeffekter. */
export function asDeduplicatedCreate<T extends object>(entry: T) {
  return {
    ...entry,
    prepaidDeduction: null as {
      packageName: string;
      remainingHours: number;
      totalHours: number;
      hoursDeducted: number;
    } | null,
    complianceWarnings: [] as string[],
    deduplicated: true,
  };
}

const updateTimeEntryInput = timeEntryRefines(
  timeEntryBase.extend({
    // Klippekort ved redigering (#204): undefined = uændret (dog detach ved
    // klient-skift), null = fjern trækket, uuid = flyt trækket til denne
    // pakke (fuld reconcile: reversér gammel, deduktér ny).
    prepaidPackageId: z.string().uuid().nullable().optional(),
    // "Fortsæt" (fase 1): sessionen der forlænger posten. Et gentaget gem af
    // samme session forlænger ikke igen.
    timerSessionId: z.string().uuid().optional(),
    // Udeladt = uændret, null = fjern tidspunktet fra posten (desktop).
    startTime: z.string().datetime({ offset: true }).nullable().optional(),
    endTime: z.string().datetime({ offset: true }).nullable().optional(),
  }),
);

/**
 * Calculate billable rate based on rate hierarchy:
 * 1. Member-project rate (highest priority, org context only)
 * 2. Member-client rate (org context only)
 * 3. Member-org rate (org context only)
 * 4. Project rate
 * 5. Client rate
 * 6. Global user rate (fallback)
 *
 * @returns The billable rate as a string, or null if no rate is found
 */
/**
 * Intern kostpris (#142): org-default cost rate for medlemmet (memberRates-
 * rækken uden projekt/klient-scope). Snapshot'es på tidsposten ved
 * oprettelse — rapporten falder tilbage til aktuel sats når null.
 */
export async function getCostRateForMember(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  orgId: string | null | undefined,
): Promise<string | null> {
  if (!orgId) return null;
  const membership = await db.query.members.findFirst({
    where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
    columns: { costRate: true },
  });
  return membership?.costRate ?? null;
}

export async function getRateForTimeEntry(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  projectId: string | null | undefined,
  clientId: string | null | undefined,
  orgId?: string | null,
  // Postens dato. Med dato bruges planlagte/anvendte satsændringer for
  // klient- og projektniveauet (se lib/rates/scheduled.ts); uden dato bruges
  // de nuværende satser som hidtil.
  date?: string | Date | null,
): Promise<string | null> {
  // 0. Check member-specific rate (highest priority in org context)
  if (orgId) {
    const membership = await db.query.members.findFirst({
      where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
      columns: { id: true },
    });

    if (membership) {
      // Single query: fetch all rates for this member, then resolve priority in JS
      const allRates = await db.query.memberRates.findMany({
        where: and(
          eq(memberRates.organizationId, orgId),
          eq(memberRates.memberId, membership.id),
        ),
        columns: { projectId: true, clientId: true, hourlyRate: true },
      });

      // Priority: project-specific > client-specific > org-default
      if (projectId) {
        const projectRate = allRates.find((r) => r.projectId === projectId);
        if (projectRate) return projectRate.hourlyRate;
      }
      if (clientId) {
        const clientRate = allRates.find(
          (r) => r.clientId === clientId && !r.projectId,
        );
        if (clientRate) return clientRate.hourlyRate;
      }
      const orgRate = allRates.find((r) => !r.projectId && !r.clientId);
      if (orgRate) return orgRate.hourlyRate;
    }
  }

  const dateKey = toRateDateKey(date);

  // Try to get project rate first
  const project = projectId
    ? await db.query.projects.findFirst({
        where: and(
          eq(projects.id, projectId),
          orgId
            ? eq(projects.organizationId, orgId)
            : eq(projects.userId, userId),
        ),
        with: {
          client: true,
        },
      })
    : undefined;

  // Planlagte ændringer hentes kun når posten har en dato — én query for
  // projektet og begge mulige klienter (projektets og den direkte).
  const scheduled = dateKey
    ? indexScheduledChanges(
        await loadScheduledChangesForTargets(db, {
          projectIds: project ? [project.id] : [],
          clientIds: [project?.client?.id, clientId].filter(
            (id): id is string => !!id,
          ),
        }),
      )
    : emptyScheduledChangeIndex();

  if (project) {
    // 1. Project hourly rate (highest priority)
    const projectRate = resolveRateAtDate(
      scheduled.byProject.get(project.id) ?? [],
      project.hourlyRate,
      dateKey,
    );
    if (projectRate) {
      return projectRate;
    }

    // 2. Client rate from project's client (medium priority)
    if (project.client) {
      const projectClientRate = resolveRateAtDate(
        scheduled.byClient.get(project.client.id) ?? [],
        project.client.defaultHourlyRate,
        dateKey,
      );
      if (projectClientRate) {
        return projectClientRate;
      }
    }
  }

  // If no project or no project rate, try client rate directly
  if (clientId) {
    const client = await db.query.clients.findFirst({
      where: and(
        eq(clients.id, clientId),
        orgId ? eq(clients.organizationId, orgId) : eq(clients.userId, userId),
      ),
    });

    if (client) {
      const directClientRate = resolveRateAtDate(
        scheduled.byClient.get(client.id) ?? [],
        client.defaultHourlyRate,
        dateKey,
      );
      if (directClientRate) {
        return directClientRate;
      }
    }
  }

  // 3. Fall back to global user rate
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  return user?.defaultHourlyRate || null;
}

/**
 * Batch rate lookup using pre-loaded data (avoids N+1 queries)
 * Use this when processing multiple time entries
 */
export interface MemberRateEntry {
  projectId: string | null;
  clientId: string | null;
  hourlyRate: string;
}

export interface RateLookupCache {
  projects: Map<string, { hourlyRate: string | null; clientId: string | null }>;
  clients: Map<string, string | null>; // clientId -> defaultHourlyRate
  userDefaultRate: string | null;
  memberRates: MemberRateEntry[]; // member-specific rates (org context only)
  // Planlagte/anvendte satsændringer pr. klient og projekt. Valgfri, så
  // håndbyggede caches (tests) ikke skal kende til dem.
  scheduled?: ScheduledChangeIndex;
}

export function getRateFromCache(
  cache: RateLookupCache,
  projectId: string | null | undefined,
  clientId: string | null | undefined,
  // Postens dato — aktiverer dato-bevidst opslag på klient/projekt-niveau
  date?: string | Date | null,
): string | null {
  // 0. Check member-specific rates (highest priority in org context)
  if (cache.memberRates.length > 0) {
    // Member-project rate
    if (projectId) {
      const memberProjectRate = cache.memberRates.find(
        (r) => r.projectId === projectId,
      );
      if (memberProjectRate) {
        return memberProjectRate.hourlyRate;
      }
    }

    // Member-client rate (no project scope)
    if (clientId) {
      const memberClientRate = cache.memberRates.find(
        (r) => r.clientId === clientId && r.projectId === null,
      );
      if (memberClientRate) {
        return memberClientRate.hourlyRate;
      }
    }

    // Member-org rate (no project or client scope)
    const memberOrgRate = cache.memberRates.find(
      (r) => r.projectId === null && r.clientId === null,
    );
    if (memberOrgRate) {
      return memberOrgRate.hourlyRate;
    }
  }

  const dateKey = cache.scheduled ? toRateDateKey(date) : undefined;
  const clientRateAt = (id: string): string | null =>
    resolveRateAtDate(
      (dateKey && cache.scheduled?.byClient.get(id)) || [],
      cache.clients.get(id) ?? null,
      dateKey,
    );

  // 1. Try project rate
  if (projectId) {
    const project = cache.projects.get(projectId);
    if (project) {
      const projectRate = resolveRateAtDate(
        (dateKey && cache.scheduled?.byProject.get(projectId)) || [],
        project.hourlyRate,
        dateKey,
      );
      if (projectRate) {
        return projectRate;
      }
    }
    // Try client rate from project's client
    if (project?.clientId && cache.clients.has(project.clientId)) {
      const clientRate = clientRateAt(project.clientId);
      if (clientRate) {
        return clientRate;
      }
    }
  }

  // 2. Try direct client rate
  if (clientId && cache.clients.has(clientId)) {
    const clientRate = clientRateAt(clientId);
    if (clientRate) {
      return clientRate;
    }
  }

  // 3. Fall back to user default rate
  return cache.userDefaultRate;
}

/**
 * Build rate lookup cache from database
 */
export async function buildRateLookupCache(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  orgId?: string | null,
): Promise<RateLookupCache> {
  const [userProjects, userClients, user, scheduledChanges] = await Promise.all(
    [
      db.query.projects.findMany({
        where: orgId
          ? eq(projects.organizationId, orgId)
          : eq(projects.userId, userId),
        columns: { id: true, hourlyRate: true, clientId: true },
      }),
      db.query.clients.findMany({
        where: orgId
          ? eq(clients.organizationId, orgId)
          : eq(clients.userId, userId),
        columns: { id: true, defaultHourlyRate: true },
      }),
      db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { defaultHourlyRate: true },
      }),
      // Alle planlagte ændringer i scope i én query (ikke én pr. post)
      loadScheduledChangesForScope(db, userId, orgId),
    ],
  );

  // Load member-specific rates if in org context
  let memberRateEntries: MemberRateEntry[] = [];
  if (orgId) {
    const membership = await db.query.members.findFirst({
      where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
      columns: { id: true },
    });

    if (membership) {
      const rates = await db.query.memberRates.findMany({
        where: and(
          eq(memberRates.organizationId, orgId),
          eq(memberRates.memberId, membership.id),
        ),
        columns: { projectId: true, clientId: true, hourlyRate: true },
      });

      memberRateEntries = rates.map((r) => ({
        projectId: r.projectId,
        clientId: r.clientId,
        hourlyRate: r.hourlyRate,
      }));
    }
  }

  const projectMap = new Map<
    string,
    { hourlyRate: string | null; clientId: string | null }
  >();
  for (const p of userProjects) {
    projectMap.set(p.id, { hourlyRate: p.hourlyRate, clientId: p.clientId });
  }

  const clientMap = new Map<string, string | null>();
  for (const c of userClients) {
    clientMap.set(c.id, c.defaultHourlyRate);
  }

  return {
    projects: projectMap,
    clients: clientMap,
    userDefaultRate: user?.defaultHourlyRate || null,
    memberRates: memberRateEntries,
    scheduled: indexScheduledChanges(scheduledChanges),
  };
}

/**
 * Ownership filter for accessing individual time entries (read detail + every
 * mutation). Mirrors the list query's visibility rule: only the org owner may
 * see or modify other members' entries; everyone else (admins included) is
 * restricted to their own. Without this, any team member could read, edit or
 * delete a colleague's billable hours even though the listing only shows them
 * their own. Solo users (no org) are scoped to their own entries.
 */
async function resolveTimeOwnershipFilter(
  db: typeof import("@/lib/db").db,
  orgId: string | null,
  userId: string,
) {
  if (!orgId) return eq(timeEntries.userId, userId);
  const membership = await db.query.members.findFirst({
    where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
    columns: { role: true },
  });
  if (membership?.role === "owner") {
    return eq(timeEntries.organizationId, orgId);
  }
  return and(
    eq(timeEntries.organizationId, orgId),
    eq(timeEntries.userId, userId),
  );
}

/**
 * Startstatus for en ny tidspost ud fra godkendelsesflowet (klient → bruger):
 * "pending" ved godkendelse pr. post, ellers "not_required". Bruges af create
 * og af kopierne (duplicate, copyWeek, #1107), så en kopi ikke omgår flowet.
 */
async function resolveInitialApprovalStatus(
  db: typeof import("@/lib/db").db,
  userId: string,
  clientId: string | null | undefined,
  projectId: string | null | undefined,
): Promise<"pending" | "not_required"> {
  const approvalUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { approvalWorkflow: true },
  });

  let approvalClient: { approvalWorkflow: string | null } = {
    approvalWorkflow: null,
  };
  if (clientId) {
    const c = await db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      columns: { approvalWorkflow: true },
    });
    if (c) approvalClient = c;
  } else if (projectId) {
    const p = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { clientId: true },
      with: { client: { columns: { approvalWorkflow: true } } },
    });
    if (p?.client) approvalClient = p.client;
  }

  const approvalMode = resolveApprovalWorkflow(
    approvalUser ?? { approvalWorkflow: null },
    approvalClient,
  );
  return approvalMode === "per_entry" ? "pending" : "not_required";
}

/**
 * Fælles redigeringsguard (#467) for bulk-operationer: ét kald pr. ejer, så
 * ugestatus og rullende lås vurderes for den rigtige bruger.
 */
async function assertEntriesEditable(
  db: Parameters<typeof assertEntryEditable>[0],
  input: {
    orgId: string | null | undefined;
    actorUserId: string;
    entries: ReadonlyArray<{
      userId: string;
      date: Date;
      approvalStatus: string | null;
    }>;
    periodOnly?: boolean;
  },
): Promise<void> {
  if (!input.orgId) return;
  const byOwner = new Map<string, (typeof input.entries)[number][]>();
  for (const e of input.entries) {
    const list = byOwner.get(e.userId) ?? [];
    list.push(e);
    byOwner.set(e.userId, list);
  }
  for (const [ownerId, rows] of byOwner) {
    await assertEntryEditable(db, {
      orgId: input.orgId,
      userId: ownerId,
      actorUserId: input.actorUserId,
      dates: rows.map((r) => r.date),
      entries: rows,
      periodOnly: input.periodOnly,
    });
  }
}

export const timeRouter = router({
  myRecords: protectedProcedure
    .input(recordsInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) throw new TRPCError({ code: "FORBIDDEN" });
      const limit = 250;
      const entries = await ctx.db.query.timeEntries.findMany({
        where: recordsFilter(ctx.session.user.id, ctx.orgId, input),
        columns: { id: true, date: true, description: true, hours: true },
        orderBy: [desc(timeEntries.date), desc(timeEntries.id)],
        limit: limit + 1,
        offset: input.offset,
      });
      return {
        entries: entries.slice(0, limit),
        nextOffset: entries.length > limit ? input.offset + limit : null,
      };
    }),

  // Preview rate for a time entry (before saving)
  previewRate: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid().optional().nullable(),
        clientId: z.string().uuid().optional().nullable(),
        hours: z.number().min(PREVIEW_RATE_MIN_HOURS),
        // Postens dato (YYYY-MM-DD) — planlagte satsændringer følger datoen
        date: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const rate = await getRateForTimeEntry(
        ctx.db,
        userId,
        input.projectId,
        input.clientId,
        ctx.orgId,
        input.date,
      );

      const hourlyRate = rate ? parseFloat(rate) : 0;
      const totalValue = hourlyRate * input.hours;

      // Get rate source information
      let rateSource: "project" | "client" | "global" | null = null;
      let rateSourceName: string | null = null;

      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
          with: { client: true },
        });
        if (project?.hourlyRate) {
          rateSource = "project";
          rateSourceName = project.name;
        } else if (project?.client?.defaultHourlyRate) {
          rateSource = "client";
          rateSourceName = project.client.name;
        }
      }

      if (!rateSource && input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });
        if (client?.defaultHourlyRate) {
          rateSource = "client";
          rateSourceName = client.name;
        }
      }

      if (!rateSource && rate) {
        rateSource = "global";
        rateSourceName = await tr("serverErrors", "time.defaultRateName");
      }

      return {
        hourlyRate,
        totalValue: Math.round(totalValue * 100) / 100,
        rateSource,
        rateSourceName,
      };
    }),

  // Get all time entries (with optional pagination)
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().uuid().optional(),
          clientId: z.string().uuid().optional(),
          // Kundens poster inkl. poster på kundens projekter (kundesiden).
          // `clientId` matcher kun direkte sat kunde og bevares for API'et.
          forClientId: z.string().uuid().optional(),
          taskId: z.string().uuid().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          isBilled: z.boolean().optional(),
          isBillable: z.boolean().optional(),
          memberId: z.string().optional(),
          // Begræns til kun egne poster, selv for owner/admin der ellers ser
          // hele teamet (Tidsregistrering-siden defaulter til "kun mine").
          onlyOwn: z.boolean().optional(),
          // Pagination options
          limit: z.number().min(1).max(1000).optional(),
          cursor: z.string().uuid().optional(), // Last entry ID for cursor-based pagination
          // Side-baseret paginering til REST-laget, som udstiller page/limit
          // og derfor ikke kan bruge cursoren. Uden offset kunne en klient
          // aldrig nå ud over den første side.
          offset: z.number().min(0).optional(),
          // Antal rækker der matcher filteret, uafhængigt af limit. Kræver en
          // ekstra count-query, så den er opt-in.
          includeTotal: z.boolean().optional(),
          // Timer og omsætning summeret i SQL over alle poster for
          // forClientId (kundesiden), uafhængigt af limit og cursor (#1115).
          includeClientTotals: z.boolean().optional(),
          // Sorteringen skal ske i databasen når der pagineres der — ellers
          // sorteres kun den aktuelle side, og rækker havner på forkert side.
          sortBy: z.enum(["date", "createdAt", "hours"]).optional(),
          sortOrder: z.enum(["asc", "desc"]).optional(),
        })
        .refine((data) => !(data.cursor && data.offset !== undefined), {
          error: () => st("zod.cursorOrOffset"),
          path: ["offset"],
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // In an organization, owners/admins (and members granted "viewTeamTime")
      // see every member's time entries; everyone else sees only their own.
      const restrictToOwnEntries = ctx.orgId
        ? !(await canViewAllOrgTime(ctx.db, ctx.orgId, userId))
        : false;

      const conditions = [
        ctx.orgId
          ? eq(timeEntries.organizationId, ctx.orgId)
          : eq(timeEntries.userId, userId),
      ];
      if (restrictToOwnEntries || input?.onlyOwn) {
        conditions.push(eq(timeEntries.userId, userId));
      }

      if (input?.projectId) {
        conditions.push(eq(timeEntries.projectId, input.projectId));
      }

      if (input?.clientId) {
        conditions.push(eq(timeEntries.clientId, input.clientId));
      }

      if (input?.forClientId) {
        conditions.push(entryBelongsToClient(input.forClientId));
      }

      if (input?.taskId) {
        conditions.push(eq(timeEntries.taskId, input.taskId));
      }

      if (input?.startDate) {
        conditions.push(gte(timeEntries.date, new Date(input.startDate)));
      }

      if (input?.endDate) {
        // Hele slutdagen med — også poster med klokkeslæt efter midnat.
        conditions.push(dateUpperBound(timeEntries.date, input.endDate));
      }

      if (input?.isBilled !== undefined) {
        conditions.push(eq(timeEntries.isBilled, input.isBilled));
      }

      if (input?.isBillable !== undefined) {
        conditions.push(eq(timeEntries.isBillable, input.isBillable));
      }

      // memberId ignoreres når onlyOwn er sat (ellers to modstridende
      // userId-betingelser → altid tomt resultat).
      if (input?.memberId && !input?.onlyOwn) {
        conditions.push(eq(timeEntries.userId, input.memberId));
      }

      // Default limit for pagination. Previously this was unbounded, which
      // let the handler load every time entry the user had ever created
      // into memory with nested project/client/tags joins — a denial-of-
      // service primitive against our own server for long-lived accounts.
      // 1000 is large enough to cover typical solo-freelancer dashboards
      // (several years of entries per client) while still protecting us.
      // Callers that want more must paginate via nextCursor.
      // 100, ikke 1000 (#186): UI'et paginerer med PAGE_SIZE 25 — den høje
      // default ramte kun direkte kald, hvor 1000 rækker × 6 joins ×
      // superjson-Dates var ren overhead.
      const DEFAULT_LIMIT = 100;
      const limit = input?.limit ?? DEFAULT_LIMIT;

      // If cursor is provided, get entries after that entry
      let cursorCondition: SQL | undefined;
      if (input?.cursor) {
        const cursorEntry = await ctx.db.query.timeEntries.findFirst({
          where: and(
            eq(timeEntries.id, input.cursor),
            ctx.orgId
              ? eq(timeEntries.organizationId, ctx.orgId)
              : eq(timeEntries.userId, userId),
          ),
        });
        if (cursorEntry) {
          // Rækkerne strengt efter cursoren i sorteringen (date, createdAt,
          // id — alle faldende). Den tidligere betingelse `date <= cursor`
          // tog alle rækker fra cursorens dato med igen, så poster på samme
          // dag gik igen på næste side (#573). Sammenligningen sker i SQL, så
          // createdAt ikke mister mikrosekunderne på vej gennem en JS-Date.
          cursorCondition = sql`(${timeEntries.date}, ${timeEntries.createdAt}, ${timeEntries.id}) < (select c.date, c.created_at, c.id from time_entries c where c.id = ${cursorEntry.id})`;
          conditions.push(cursorCondition);
        }
      }

      // Client-access restriction for org members (member_client_access).
      // Pushed into the SQL WHERE — filtering after pagination would break
      // hasMore/nextCursor and silently drop entries from a page. Entries with
      // no resolved client (internal time) are always visible.
      if (ctx.orgId) {
        const { getAccessibleClientIds } = await import("./clientAccess");
        const accessibleIds = await getAccessibleClientIds(
          ctx.db,
          userId,
          ctx.orgId,
        );
        if (accessibleIds !== null) {
          const resolvedClient = sql`COALESCE(${timeEntries.clientId}, (SELECT p.client_id FROM projects p WHERE p.id = ${timeEntries.projectId}))`;
          if (accessibleIds.length === 0) {
            conditions.push(sql`${resolvedClient} IS NULL`);
          } else {
            conditions.push(
              sql`(${resolvedClient} IS NULL OR ${resolvedClient} IN (${sql.join(
                accessibleIds.map((id) => sql`${id}`),
                sql`, `,
              )}))`,
            );
          }
        }
      }

      // Sortering i databasen, så side 2 indeholder de rigtige rækker.
      // Sorteres der først efter hentning, gælder rækkefølgen kun den side
      // man tilfældigvis fik fat i.
      const direction = input?.sortOrder === "asc" ? asc : desc;
      const sortColumn =
        input?.sortBy === "hours"
          ? timeEntries.hours
          : input?.sortBy === "createdAt"
            ? timeEntries.createdAt
            : timeEntries.date;
      // id som sidste nøgle, så rækkefølgen er entydig — både cursoren og
      // offset-paginering forudsætter det.
      const orderBy = input?.sortBy
        ? [
            direction(sortColumn),
            desc(timeEntries.createdAt),
            desc(timeEntries.id),
          ]
        : [
            desc(timeEntries.date),
            desc(timeEntries.createdAt),
            desc(timeEntries.id),
          ];

      // Antallet skal tælles med de samme betingelser som rækkerne, ellers
      // passer totalen ikke til det klienten kan bladre igennem. Optælling,
      // rækker og brugerens afrunding er uafhængige og hentes samtidig.
      const totalQuery = input?.includeTotal
        ? ctx.db
            .select({ value: count() })
            .from(timeEntries)
            .where(and(...conditions))
            .then(([row]) => row?.value ?? 0)
        : Promise.resolve(undefined);

      const clientTotalsQuery =
        input?.includeClientTotals && input.forClientId
          ? sumClientEntries(
              ctx.db,
              input.forClientId,
              and(...conditions.filter((c) => c !== cursorCondition)),
            )
          : Promise.resolve(undefined);

      // Load user rounding settings and add roundedHours to each entry
      const userRowQuery = ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: {
          roundingEnabled: true,
          roundingMinutes: true,
          roundingMethod: true,
        },
      });

      const entriesQuery = ctx.db.query.timeEntries.findMany({
        where: and(...conditions),
        orderBy,
        limit: limit + 1, // Fetch one extra to check if there are more
        ...(input?.offset !== undefined && { offset: input.offset }),
        with: {
          project: {
            with: {
              client: true,
            },
          },
          client: true,
          prepaidPackage: true,
          tags: {
            with: {
              tag: true,
            },
          },
          task: {
            columns: {
              id: true,
              title: true,
            },
          },
          user: {
            columns: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      });

      const [total, entries, userRow, clientTotals] = await Promise.all([
        totalQuery,
        entriesQuery,
        userRowQuery,
        clientTotalsQuery,
      ]);

      // Check if there are more entries
      let hasMore = false;
      let nextCursor: string | undefined;

      if (limit && entries.length > limit) {
        hasMore = true;
        entries.pop(); // Remove the extra entry
        nextCursor = entries[entries.length - 1]?.id;
      }

      const userRounding = userRow ?? {
        roundingEnabled: null,
        roundingMinutes: null,
        roundingMethod: null,
      };
      const nullRounding = {
        roundingEnabled: null,
        roundingMinutes: null,
        roundingMethod: null,
      };

      const entriesWithRounding = entries.map((entry) => {
        const clientRounding =
          entry.client ?? entry.project?.client ?? nullRounding;
        const projectRounding = entry.project ?? nullRounding;
        const config = resolveRoundingConfig(
          userRounding,
          clientRounding,
          projectRounding,
        );
        const hours = Number.parseFloat(entry.hours);
        return {
          ...entry,
          roundedHours: roundHours(hours, config).toFixed(2),
          tags: (entry.tags ?? []).map((et) => ({
            id: et.tag.id,
            name: et.tag.name,
            color: et.tag.color,
            inherited: et.inherited,
          })),
        };
      });

      return {
        entries: entriesWithRounding,
        hasMore,
        nextCursor,
        ...(total !== undefined && { total }),
        ...(clientTotals !== undefined && { clientTotals }),
      };
    }),

  // Get recent unique tasks (for quick resume)
  getRecent: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(10).default(5),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const limit = input?.limit ?? 5;

      // Get recent time entries (exclude billed — can't add segments to those).
      // Always the caller's own entries: this feeds the "resume work" feature,
      // so it must never surface a colleague's tasks.
      const entries = await ctx.db.query.timeEntries.findMany({
        where: and(
          eq(timeEntries.userId, userId),
          eq(timeEntries.isBilled, false),
        ),
        orderBy: [desc(timeEntries.createdAt)],
        limit: 50,
        columns: {
          id: true,
          projectId: true,
          clientId: true,
          taskId: true,
          description: true,
          hours: true,
          createdAt: true,
        },
        with: {
          project: {
            columns: { name: true, clientId: true },
            with: {
              client: { columns: { name: true } },
            },
          },
          client: { columns: { name: true } },
        },
      });

      // Find unique combinations of project/client + description
      const uniqueTasks: Array<{
        entryId: string;
        projectId: string | null;
        clientId: string | null;
        taskId: string | null;
        description: string;
        projectName: string | null;
        clientName: string | null;
        hours: string;
        lastUsed: Date;
      }> = [];

      const seen = new Set<string>();

      for (const entry of entries) {
        // Create unique key based on project/client + description
        const key = `${entry.projectId || ""}-${entry.clientId || ""}-${entry.description}`;

        if (!seen.has(key) && uniqueTasks.length < limit) {
          seen.add(key);

          const clientName =
            entry.project?.client?.name || entry.client?.name || null;

          uniqueTasks.push({
            entryId: entry.id,
            projectId: entry.projectId,
            clientId: entry.clientId || entry.project?.clientId || null,
            taskId: entry.taskId,
            description: entry.description || "",
            projectName: entry.project?.name || null,
            clientName,
            hours: String(entry.hours),
            lastUsed: entry.createdAt,
          });
        }
      }

      return uniqueTasks;
    }),

  // Get time entry by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Read: owners/admins (and members granted viewTeamTime) may open any
      // org entry; everyone else only their own.
      const canViewAll =
        ctx.orgId !== null &&
        (await canViewAllOrgTime(ctx.db, ctx.orgId, userId));
      const ownershipFilter =
        ctx.orgId && canViewAll
          ? eq(timeEntries.organizationId, ctx.orgId)
          : ctx.orgId
            ? and(
                eq(timeEntries.organizationId, ctx.orgId),
                eq(timeEntries.userId, userId),
              )
            : eq(timeEntries.userId, userId);
      const entry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
        with: {
          project: {
            with: {
              client: true,
            },
          },
          client: true,
          prepaidPackage: true,
          tags: {
            with: { tag: true },
          },
        },
      });

      if (!entry) {
        throw Errors.timeEntryNotFound();
      }

      return {
        ...entry,
        tags: (entry.tags ?? []).map((et) => ({
          id: et.tag.id,
          name: et.tag.name,
          color: et.tag.color,
          inherited: et.inherited,
        })),
      };
    }),

  // Create time entry (with optional atomic prepaid deduction)
  create: subscribedProcedure
    .input(createTimeEntryInput)
    .mutation(async ({ ctx, input: rawInput }) => {
      const userId = ctx.session.user.id;
      // "Intet klippekort": serveren vælger ikke et kort til posten. Lægges en
      // timer-gemning sammen med en allerede gemt post fra samme session,
      // følger kortet den gemte post (mergeIntoSameSessionEntry), som i dag.
      const { noPrepaid, prepaidPackageId, ...rawRest } = rawInput;
      if (noPrepaid && prepaidPackageId) {
        throw badRequest(
          await tr("serverErrors", "time.chooseOnePrepaidOrNone"),
        );
      }
      const noCard = noPrepaid === true || prepaidPackageId === null;
      const requested = {
        ...rawRest,
        prepaidPackageId: noCard ? undefined : (prepaidPackageId ?? undefined),
        prepaidHoursOverride: noCard ? undefined : rawRest.prepaidHoursOverride,
      };
      // Ældre app (build ≤ 5) gemmer sit eget stop uden timerSessionId og med
      // sin lokale (måske forældede) kunde: gem i stedet den session, der er
      // ved at blive stoppet, med sessionens projekt/kunde (#783, #785).
      const legacyStop =
        !requested.timerSessionId &&
        requested.fromTimer === true &&
        requested.startTime &&
        parseClientHeader(ctx.headers?.get(CLIENT_HEADER))?.kind === "mobile"
          ? await findStoppingSessionForLegacySave(
              ctx.db,
              userId,
              new Date(requested.startTime),
            )
          : undefined;
      // Sessionen har selv ingen kunde: projektets kunde afgør matchet i
      // withLegacyStopTarget (CodeRabbit, PR #858) — ellers bypasses tjekket.
      const legacyProjectClientId =
        legacyStop && legacyStop.clientId === null
          ? await lookupProjectClientId(ctx.db, legacyStop.projectId)
          : null;
      const input = legacyStop
        ? withLegacyStopTarget(requested, {
            ...legacyStop,
            projectClientId: legacyProjectClientId,
          })
        : requested;

      // Idempotens (#703): en afspilning af en oprettelse, hvis svar gik tabt,
      // returnerer den post der allerede findes — før validering og låse, så
      // en periodelås der er sat siden ikke gør en gemt post til en fejl.
      if (input.clientEntryId) {
        const existing = await findEntryByClientEntryId(
          ctx.db,
          userId,
          input.clientEntryId,
        );
        if (existing) return asDeduplicatedCreate(existing);
      }
      // Samme for en timer-session der allerede er gemt. Et fremmed/ukendt
      // sessionId ignoreres (posten gemmes som fra en ældre klient).
      const ownSession = input.timerSessionId
        ? await findOwnSession(ctx.db, userId, input.timerSessionId)
        : undefined;
      const timerSessionId = ownSession?.id ?? undefined;
      if (timerSessionId) {
        const existing = await findEntryForTimerSession(
          ctx.db,
          userId,
          timerSessionId,
        );
        if (existing) return asDeduplicatedCreate(existing);
      }
      if (ownSession) {
        // Gemt af en ældre klient uden id (fx efter at cron'en parkerede et
        // forladt stop): et sent gem fra gem-dialogen må ikke gemme sessionen
        // igen (fundet af modellen, web + extension 2.5.x).
        const legacy = await findLegacySavedEntry(ctx.db, userId, ownSession, {
          hours: input.hours,
        });
        if (legacy) return asDeduplicatedCreate(legacy);
      }

      // Verify project or client belongs to user/org
      let projectName: string | undefined;
      let projectClientId: string | null = null;
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
        });

        if (!project) {
          throw Errors.projectNotFound();
        }
        projectName = project.name;
        projectClientId = project.clientId ?? null;
      }

      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });

        if (!client) {
          throw Errors.clientNotFound();
        }
      }

      // Verify task belongs to user if provided
      let linkedTask: typeof tasks.$inferSelect | undefined;
      if (input.taskId) {
        linkedTask = await ctx.db.query.tasks.findFirst({
          where: and(
            eq(tasks.id, input.taskId),
            ctx.orgId
              ? eq(tasks.organizationId, ctx.orgId)
              : eq(tasks.userId, userId),
          ),
        });

        if (!linkedTask) {
          throw new Error(await tr("serverErrors", "time.taskNotFound"));
        }
      }

      // Check if this is the user's first time entry (before creating)
      const existingEntries = await ctx.db.query.timeEntries.findMany({
        where: ctx.orgId
          ? eq(timeEntries.organizationId, ctx.orgId)
          : eq(timeEntries.userId, userId),
        limit: 1,
      });
      const isFirstTimeEntry = existingEntries.length === 0;

      // Calculate billable rate using rate hierarchy — efter postens dato,
      // så tid registreret bagud får den sats der gjaldt på dagen
      const billableRate = await getRateForTimeEntry(
        ctx.db,
        userId,
        input.projectId,
        input.clientId,
        ctx.orgId,
        input.date,
      );
      const costRate = await getCostRateForMember(ctx.db, userId, ctx.orgId);

      // Fælles redigeringsguard (#467): periodelås, ugestatus, rullende lås
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        dates: [input.date],
      });
      // Arbejdstidsregler (E11, #469): block afviser, warn returneres til UI
      const complianceWarnings = await assertEntryCompliant(ctx.db, {
        orgId: ctx.orgId,
        userId,
        candidate: {
          date: input.date,
          hours: input.hours,
          startTime: input.startTime,
          endTime: input.endTime,
        },
        neverBlock: input.fromTimer === true,
      });

      // Resolve approval workflow — determine initial approval status
      const initialApprovalStatus = await resolveInitialApprovalStatus(
        ctx.db,
        userId,
        input.clientId,
        input.projectId,
      );

      // Intern klient (#541): uden eksplicit isBillable arves klientens default
      const isBillable = await resolveDefaultBillable(
        ctx.db,
        input,
        input.isBillable,
      );

      // Use transaction for atomic entry creation + prepaid deduction
      let prepaidDeduction: {
        packageName: string;
        remainingHours: number;
        totalHours: number;
        hoursDeducted: number;
      } | null = null;
      // Én session = én post (kunde A 1/10): en timer-gemning af en session
      // der allerede er gemt (samme start ±2 s) forlænger den eksisterende
      // post i stedet for at indsætte en dublet. Kun for timer-gemninger med
      // starttid — manuelle poster med samme start er bevidste.
      const sessionStart =
        input.fromTimer === true && input.startTime
          ? new Date(input.startTime)
          : null;
      let mergedSession: SameSessionMergeResult | null = null;
      const createTx = ctx.db.transaction(async (tx) => {
        if (sessionStart) {
          mergedSession = await mergeIntoSameSessionEntry(tx, {
            userId,
            orgId: ctx.orgId,
            startTime: sessionStart,
            endTime: input.endTime ? new Date(input.endTime) : null,
            hours: input.hours,
            prepaidPackageId: input.prepaidPackageId ?? null,
            prepaidHoursOverride: input.prepaidPackageId
              ? input.prepaidHoursOverride
              : undefined,
            incomingProjectId: input.projectId ?? null,
            incomingClientIdRaw: input.clientId ?? null,
            incomingClientId: input.clientId ?? projectClientId,
            assertEditable: (existing) =>
              assertEntryEditable(tx, {
                orgId: ctx.orgId,
                userId: existing.userId,
                actorUserId: userId,
                dates: [existing.date],
                entries: [existing],
              }),
          });
          if (mergedSession) {
            if (
              timerSessionId &&
              !(await saveSessionEntry(tx, {
                userId,
                organizationId: ctx.orgId,
                sessionId: timerSessionId,
                entryId: mergedSession.entry.id,
                // Legacy-stoppet er claimet FØR denne transaktion: en
                // cancelStop der genoptager imellem må afvise gemningen
                // (CodeRabbit, PR #858) — se markSessionSaved.
                requireStatus: legacyStop ? "stopping" : undefined,
              }))
            ) {
              // Et samtidigt gem af samme session vandt — rul forlængelsen
              // tilbage og returnér vinderens post (review P2-3)
              throw new SessionAlreadySavedError();
            }
            return mergedSession.entry;
          }
        }

        const [entry] = await tx
          .insert(timeEntries)
          .values({
            userId,
            organizationId: ctx.orgId,
            projectId: input.projectId || null,
            clientId: input.clientId || null,
            description: input.description,
            notes: input.notes || null,
            date: entryDateFromStr(input.date),
            hours: input.hours.toString(),
            startTime: input.startTime ? new Date(input.startTime) : null,
            endTime: input.endTime ? new Date(input.endTime) : null,
            billableRate: input.billableRate ?? billableRate,
            costRate,
            isBillable,
            isPrepaid: !!input.prepaidPackageId,
            prepaidPackageId: input.prepaidPackageId || null,
            taskId: input.taskId || null,
            source: "manual",
            approvalStatus: initialApprovalStatus,
            clientEntryId: input.clientEntryId ?? null,
            timerSessionId: timerSessionId ?? null,
          })
          // De unikke indeks (clientEntryId, timer_session_id) er dommeren ved
          // to samtidige afspilninger: den der taber, får ingen række og
          // returnerer vinderens post nedenfor.
          .onConflictDoNothing()
          .returning();

        if (!entry) return null;

        // Sessionen er gemt — i SAMME transaktion som posten.
        if (
          timerSessionId &&
          !(await saveSessionEntry(tx, {
            userId,
            organizationId: ctx.orgId,
            sessionId: timerSessionId,
            entryId: entry.id,
            // Se kommentaren ved den anden saveSessionEntry ovenfor.
            requireStatus: legacyStop ? "stopping" : undefined,
          }))
        ) {
          throw new SessionAlreadySavedError();
        }

        // Atomic prepaid deduction within same transaction
        if (input.prepaidPackageId) {
          const hoursToDeduct = input.prepaidHoursOverride ?? input.hours;
          const deductResult = await deductHoursCore(tx, userId, ctx.orgId, {
            packageId: input.prepaidPackageId,
            hours: hoursToDeduct,
            timeEntryId: entry.id,
            // Klippekortets kunde skal være postens egen (CodeRabbit,
            // PR #858) — ellers kunne en kendt packageId fra en anden kunde
            // trækkes og gemmes her, uden det tjek time.update allerede har.
            clientId: input.clientId ?? projectClientId,
          });
          // Vis kun klippekort-toasten hvis der faktisk blev trukket — ved
          // overflow-til-faktura (#93) blev intet trukket fra kortet, så en
          // toast med "Trukket 0t" ville være misvisende.
          if (!deductResult.overflowedToInvoice) {
            prepaidDeduction = {
              packageName: deductResult.packageName,
              remainingHours: deductResult.remainingHours,
              totalHours: deductResult.totalHours,
              hoursDeducted: deductResult.hoursDeducted,
            };
          }
        }

        // Update task's actualMinutes if linked to a task
        if (linkedTask && input.taskId) {
          const minutesWorked = Math.round(input.hours * 60);
          await tx
            .update(tasks)
            .set({
              actualMinutes: sql`COALESCE(${tasks.actualMinutes}, 0) + ${minutesWorked}`,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, input.taskId));
        }

        // Inherit tags from project and client
        if (entry) {
          const inheritedTagIds = new Set<string>();

          // Get project tags
          if (entry.projectId) {
            const projectTagRows = await tx.query.projectTags.findMany({
              where: eq(projectTags.projectId, entry.projectId),
            });
            for (const pt of projectTagRows) inheritedTagIds.add(pt.tagId);
          }

          // Get client tags — resolve from entry.clientId OR project.clientId
          let resolvedClientId = entry.clientId;
          if (!resolvedClientId && entry.projectId) {
            const project = await tx.query.projects.findFirst({
              where: eq(projects.id, entry.projectId),
              columns: { clientId: true },
            });
            resolvedClientId = project?.clientId ?? null;
          }

          if (resolvedClientId) {
            const clientTagRows = await tx.query.clientTags.findMany({
              where: eq(clientTags.clientId, resolvedClientId),
            });
            for (const ct of clientTagRows) inheritedTagIds.add(ct.tagId);
          }

          // Insert inherited tags
          if (inheritedTagIds.size > 0) {
            await tx.insert(timeEntryTags).values(
              Array.from(inheritedTagIds).map((tagId) => ({
                entryId: entry.id,
                tagId,
                inherited: true,
              })),
            );
          }
        }

        return entry;
      });

      let sessionLost = false;
      const newEntry = await createTx.catch((err: unknown) => {
        if (!(err instanceof SessionAlreadySavedError)) throw err;
        sessionLost = true;
        return null;
      });
      if (sessionLost && timerSessionId) {
        // Et samtidigt gem af samme session vandt — dens post er sandheden
        const winner = await findEntryForTimerSession(
          ctx.db,
          userId,
          timerSessionId,
        );
        if (winner) return asDeduplicatedCreate(winner);
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr("serverErrors", "time.entryExists"),
        });
      }

      const merged = mergedSession as SameSessionMergeResult | null;
      if (newEntry && merged) {
        const deduction = merged.prepaidDeduction;
        if (deduction?.overflowedToInvoice === false) {
          prepaidDeduction = {
            packageName: deduction.packageName,
            remainingHours: deduction.remainingHours,
            totalHours: deduction.totalHours,
            hoursDeducted: deduction.hoursDeducted,
          };
        }
        emitWebhookEvent({
          userId,
          orgId: ctx.orgId,
          eventType: "time_entry.updated",
          eventId: newEntry.id,
          data: { timeEntry: newEntry },
          clientId: newEntry.clientId,
          projectId: newEntry.projectId,
        });
        // Samme timer-session gemt igen → posten forlænget, ingen dublet.
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: ctx.orgId,
          event: "merge_same_session",
          ...timerEventOrigin(ctx.headers, "web"),
          startTime: sessionStart,
          projectId: input.projectId ?? null,
          clientId: input.clientId ?? null,
          detail: { entryId: newEntry.id, hours: input.hours },
        });
        return {
          ...newEntry,
          prepaidDeduction,
          complianceWarnings,
          deduplicated: false,
          mergedIntoExisting: true,
        };
      }

      if (!newEntry) {
        // Tabte kapløbet om samme clientEntryId/session — vinderens post er
        // sandheden.
        const existing =
          (input.clientEntryId
            ? await findEntryByClientEntryId(
                ctx.db,
                userId,
                input.clientEntryId,
              )
            : undefined) ??
          (timerSessionId
            ? await findEntryForTimerSession(ctx.db, userId, timerSessionId)
            : undefined);
        if (!existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr("serverErrors", "time.entryExists"),
          });
        }
        return asDeduplicatedCreate(existing);
      }

      // Post-transaction: send low balance alert if prepaid deduction happened
      if (input.prepaidPackageId) {
        try {
          const pkg = await ctx.db.query.prepaidPackages.findFirst({
            where: eq(prepaidPackages.id, input.prepaidPackageId),
          });
          if (pkg) {
            await checkAndSendLowBalanceAlert(
              ctx.db,
              userId,
              input.prepaidPackageId,
              {
                remainingHours: parseFloat(pkg.remainingHours || "0"),
                totalHours: parseFloat(pkg.totalHours || "0"),
                clientId: pkg.clientId,
                packageName: pkg.name,
                lowBalanceAlertSentAt: pkg.lowBalanceAlertSentAt,
                usageId: "",
                hoursDeducted: 0,
              },
            );
          }
        } catch (error) {
          console.error("Failed to send low balance alert:", error);
        }
      }

      // Send first time entry milestone email
      if (isFirstTimeEntry) {
        try {
          const user = await ctx.db.query.users.findFirst({
            where: eq(users.id, userId),
          });
          const prefs = await ctx.db.query.emailPreferences.findFirst({
            where: ctx.orgId
              ? eq(emailPreferences.organizationId, ctx.orgId)
              : eq(emailPreferences.userId, userId),
          });

          if (user && prefs?.onboardingMilestones !== false) {
            await sendFirstTimeEntryEmail({
              to: user.email,
              userName: user.name || "der",
              hours: input.hours.toFixed(1).replace(".", ","),
              projectName,
              userId,
              organizationId: ctx.orgId ?? undefined,
            });
          }
        } catch (error) {
          console.error("Failed to send first time entry email:", error);
        }
      }

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "time_entry.created",
        eventId: newEntry.id,
        data: { timeEntry: newEntry },
        clientId: newEntry.clientId,
        projectId: newEntry.projectId,
      });

      trackEvent({ userId, orgId: ctx.orgId, event: "time_entry.created" });

      // Klippekort-info med i svaret, så UI kan vise restsaldo i toasten
      return {
        ...newEntry,
        prepaidDeduction,
        complianceWarnings,
        deduplicated: false,
      };
    }),

  // Update time entry
  update: subscribedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateTimeEntryInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify entry belongs to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
      });

      if (!existingEntry) {
        throw Errors.timeEntryNotFound();
      }

      // "Fortsæt" (timer-sessioner, fase 1): er sessionen allerede gemt (tabt
      // svar → "Gem" igen), forlænges posten IKKE en gang til.
      const continuingSession = input.data.timerSessionId
        ? await findOwnSession(ctx.db, userId, input.data.timerSessionId)
        : undefined;
      if (continuingSession?.savedEntryId) {
        return {
          ...existingEntry,
          complianceWarnings: [] as string[],
          deduplicated: true,
        };
      }

      // Fakturerede poster er låst (#702): kun den interne note må rettes,
      // medmindre en manuel faktureret-markering fjernes i samme gem.
      const billedPatch = {
        projectId: input.data.projectId || null,
        clientId: input.data.clientId || null,
        description: input.data.description,
        date: input.data.date,
        hours: input.data.hours,
        startTime: input.data.startTime,
        endTime: input.data.endTime,
        billableRate: input.data.billableRate,
        isBillable: input.data.isBillable,
        isBilled: input.data.isBilled,
        taskId: input.data.taskId || null,
        prepaidPackageId: input.data.prepaidPackageId,
      };
      assertBilledPatchAllowed(existingEntry, billedPatch);
      if (
        isBilledLocked(existingEntry) &&
        !isManualUnbill(existingEntry, billedPatch)
      ) {
        if (input.data.notes === undefined) {
          return { ...existingEntry, complianceWarnings: [] as string[] };
        }
        await assertEntryEditable(ctx.db, {
          orgId: ctx.orgId,
          userId: existingEntry.userId,
          actorUserId: userId,
          dates: [existingEntry.date],
          entries: [existingEntry],
        });
        const [notesUpdated] = await ctx.db
          .update(timeEntries)
          .set({ notes: input.data.notes || null })
          .where(and(eq(timeEntries.id, input.id), ownershipFilter))
          .returning();
        return { ...notesUpdated, complianceWarnings: [] as string[] };
      }

      // Verify project or client belongs to user/org
      let projectClientId: string | null = null;
      if (input.data.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.data.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
        });

        if (!project) {
          throw Errors.projectNotFound();
        }
        projectClientId = project.clientId ?? null;
      }

      if (input.data.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.data.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });

        if (!client) {
          throw Errors.clientNotFound();
        }
      }

      // Verify task belongs to user/org if provided
      if (input.data.taskId) {
        const task = await ctx.db.query.tasks.findFirst({
          where: and(
            eq(tasks.id, input.data.taskId),
            ctx.orgId
              ? eq(tasks.organizationId, ctx.orgId)
              : eq(tasks.userId, userId),
          ),
        });

        if (!task) {
          throw new Error(await tr("serverErrors", "time.taskNotFound"));
        }
      }

      const oldTaskId = existingEntry.taskId;
      const newTaskId = input.data.taskId || null;
      const oldHours = Number(existingEntry.hours);
      const newHours = input.data.hours;

      // Integrity: editing the hours of an already-decided entry invalidates the
      // decision. A member could otherwise get 1h approved and inflate it to 8h.
      // Re-open it for review (status "not_required" entries have no workflow,
      // so they're left untouched).
      const needsReapproval =
        (existingEntry.approvalStatus === "approved" ||
          existingEntry.approvalStatus === "rejected") &&
        oldHours !== newHours;

      // Satsen genberegnes efter postens (evt. nye) dato, så en post flyttet
      // over en planlagt satsændring får satsen for sin nye dato. Uden
      // planlagte ændringer er resultatet det samme som før.
      let billableRate = await getRateForTimeEntry(
        ctx.db,
        userId,
        input.data.projectId,
        input.data.clientId,
        ctx.orgId,
        input.data.date,
      );
      // En faktureret post må ikke skifte sats fordi datoen rettes — beløbet
      // står allerede på en faktura. Eksplicit billableRate vinder stadig.
      const dateChanged =
        toRateDateKey(existingEntry.date) !== toRateDateKey(input.data.date);
      const ownerUnchanged =
        (input.data.projectId || null) === existingEntry.projectId &&
        (input.data.clientId || null) === existingEntry.clientId;
      if (existingEntry.isBilled && dateChanged && ownerUnchanged) {
        billableRate = existingEntry.billableRate;
      }

      // Klippekort-reconcile-beslutning (#204). Trækket skal følge posten:
      // ved klient-skift må det gamle træk ikke blive stående hos den
      // forkerte kunde, og pakken kan nu skiftes/fjernes eksplicit.
      const oldPackageId = existingEntry.prepaidPackageId ?? null;
      // Fælles redigeringsguard (#467): hverken den gamle eller nye dato må
      // ligge i en låst periode/uge (ellers kan poster flyttes ud af låste)
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: existingEntry.userId,
        actorUserId: userId,
        dates: [existingEntry.date, input.data.date],
        entries: [existingEntry],
      });
      // Arbejdstidsregler (E11, #469) — den gamle post regnes ikke med
      const complianceWarnings = await assertEntryCompliant(ctx.db, {
        orgId: ctx.orgId,
        userId: existingEntry.userId,
        candidate: {
          date: input.data.date,
          hours: input.data.hours,
          startTime: input.data.startTime,
          endTime: input.data.endTime,
        },
        excludeEntryIds: [existingEntry.id],
        neverBlock: input.data.fromTimer === true,
      });

      const wasPrepaid = !!existingEntry.isPrepaid && !!oldPackageId;
      const newClientId = input.data.clientId || null;
      // Den gamle posts projekt-kunde, så reconcile sammenligner EFFEKTIV
      // kunde (A1 P1-1) — kun slået op når posten er på et kort.
      const oldProjectClientId =
        !wasPrepaid || !existingEntry.projectId
          ? null
          : existingEntry.projectId === (input.data.projectId || null)
            ? projectClientId
            : await lookupProjectClientId(ctx.db, existingEntry.projectId);
      const {
        targetPackageId,
        needsReconcile: needsPrepaidReconcile,
        packageChanged,
        clientChanged,
        allowInactive,
      } = resolvePrepaidReconcile({
        wasPrepaid,
        oldPackageId,
        oldClient: {
          clientId: existingEntry.clientId ?? null,
          projectClientId: oldProjectClientId,
        },
        newClient: { clientId: newClientId, projectClientId },
        requestedPackageId: input.data.prepaidPackageId,
        oldHours,
        newHours,
      });

      const updateTx = ctx.db.transaction(async (tx) => {
        // Sessionen markeres gemt FØRST og atomisk: taber vi kapløbet (et
        // samtidigt gem af samme session), rulles hele opdateringen tilbage.
        if (continuingSession) {
          const won = await saveSessionEntry(tx, {
            userId,
            organizationId: ctx.orgId,
            sessionId: continuingSession.id,
            entryId: input.id,
          });
          if (!won) throw new SessionAlreadySavedError();
        }
        // Flyttes posten til en anden dato, følger dens segmenter med — kun
        // tidspunkterne; varighed og timer er uændrede.
        const segmentShift = segmentShiftMs({
          oldDate: existingEntry.date,
          newDateStr: input.data.date,
          oldStart: existingEntry.startTime,
          newStart: input.data.startTime,
        });
        if (segmentShift !== 0) {
          const shift = sql`(${segmentShift}::double precision * interval '1 millisecond')`;
          await tx
            .update(timeEntrySegments)
            .set({
              startTime: sql`${timeEntrySegments.startTime} + ${shift}`,
              endTime: sql`${timeEntrySegments.endTime} + ${shift}`,
            })
            .where(eq(timeEntrySegments.timeEntryId, input.id));
        }

        if (oldTaskId !== newTaskId || oldHours !== newHours) {
          if (oldTaskId) {
            const oldMinutes = Math.round(oldHours * 60);
            await tx
              .update(tasks)
              .set({
                actualMinutes: sql`GREATEST(0, COALESCE(${tasks.actualMinutes}, 0) - ${oldMinutes})`,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, oldTaskId));
          }

          if (newTaskId) {
            const newMinutes = Math.round(newHours * 60);
            await tx
              .update(tasks)
              .set({
                actualMinutes: sql`COALESCE(${tasks.actualMinutes}, 0) + ${newMinutes}`,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, newTaskId));
          }
        }

        // Reconcile the klippekort balance when a prepaid entry changes
        // (#204): timer ændret, klient skiftet eller pakke skiftet/fjernet.
        // Reversér den oprindelige (klip-afrundede) usage, deduktér på
        // målpakken. Nedskrivning på samme pakke må ikke blokeres af at
        // pakken i mellemtiden er deaktiveret/udløbet (allowInactive).
        // Målpakken skal tilhøre postens (nye) effektive klient. Kør også
        // valideringen når balancen IKKE ændres (fx eksplicit samme pakke +
        // klient-skift med uændrede timer) — ellers kan posten ende med en
        // pakke hos den forkerte kunde uden at nogen reconcile kørte.
        const effectiveClientId = newClientId ?? projectClientId;
        if (targetPackageId && (packageChanged || clientChanged)) {
          const [pkg] = await tx
            .select({ clientId: prepaidPackages.clientId })
            .from(prepaidPackages)
            .where(
              and(
                eq(prepaidPackages.id, targetPackageId),
                ctx.orgId
                  ? eq(prepaidPackages.organizationId, ctx.orgId)
                  : eq(prepaidPackages.userId, userId),
              ),
            );
          if (!pkg) {
            throw notFound(await tr("serverErrors", "time.prepaidNotFound"));
          }
          if (!effectiveClientId || pkg.clientId !== effectiveClientId) {
            throw badRequest(
              await tr("serverErrors", "time.prepaidOtherClient"),
            );
          }
        }

        let overflowedToInvoice = false;
        if (needsPrepaidReconcile) {
          if (wasPrepaid && oldPackageId) {
            await reversePrepaidUsage(tx, input.id, oldPackageId);
          }
          if (targetPackageId) {
            const deductResult = await deductHoursCore(tx, userId, ctx.orgId, {
              packageId: targetPackageId,
              hours: newHours,
              timeEntryId: input.id,
              clientId: effectiveClientId,
              allowInactive,
            });
            // invoice-politik (#93): intet blev trukket — posten skal
            // forblive fakturerbar. Uden dette ville set()-blokken nedenfor
            // gen-markere posten som prepaid uden usage-række: timerne
            // ville hverken blive faktureret eller trukket (penge-tab).
            overflowedToInvoice = !!deductResult.overflowedToInvoice;
          }
        }

        return tx
          .update(timeEntries)
          .set({
            projectId: input.data.projectId || null,
            clientId: input.data.clientId || null,
            description: input.data.description,
            notes:
              input.data.notes !== undefined
                ? input.data.notes || null
                : undefined,
            date: entryDateFromStr(input.data.date),
            hours: input.data.hours.toString(),
            ...(input.data.startTime !== undefined && {
              startTime: input.data.startTime
                ? new Date(input.data.startTime)
                : null,
            }),
            ...(input.data.endTime !== undefined && {
              endTime: input.data.endTime ? new Date(input.data.endTime) : null,
            }),
            billableRate: input.data.billableRate ?? billableRate,
            ...(input.data.isBillable !== undefined && {
              isBillable: input.data.isBillable,
            }),
            ...(input.data.isBilled !== undefined && {
              isBilled: input.data.isBilled,
            }),
            ...(needsReapproval && {
              approvalStatus: "pending",
              approvedAt: null,
              approvedBy: null,
            }),
            ...(needsPrepaidReconcile && {
              isPrepaid: !!targetPackageId && !overflowedToInvoice,
              prepaidPackageId: overflowedToInvoice ? null : targetPackageId,
            }),
            taskId: newTaskId,
          })
          .where(and(eq(timeEntries.id, input.id), ownershipFilter))
          .returning();
      });
      const txResult = await updateTx.catch((err: unknown) => {
        if (err instanceof SessionAlreadySavedError) return null;
        throw err;
      });
      if (txResult === null) {
        return {
          ...existingEntry,
          complianceWarnings: [] as string[],
          deduplicated: true,
        };
      }
      const [updatedEntry] = txResult;

      if (ctx.orgId) {
        logOrgAudit(ctx.db, ctx.orgId, userId, "time_entry_updated", {
          metadata: {
            entryId: input.id,
            diff: auditDiff(
              {
                // Numerisk normalisering (review-fund): "8.00" vs "8"
                // må ikke give falsk diff
                hours: Number(existingEntry.hours),
                date: existingEntry.date,
                description: existingEntry.description,
              },
              {
                hours: input.data.hours,
                date: entryDateFromStr(input.data.date),
                description: input.data.description,
              },
            ),
          },
        });
      }

      // Lav-saldo-alert efter deduktion på (evt. ny) pakke - spejler create.
      if (needsPrepaidReconcile && targetPackageId) {
        try {
          const pkg = await ctx.db.query.prepaidPackages.findFirst({
            where: eq(prepaidPackages.id, targetPackageId),
          });
          if (pkg) {
            await checkAndSendLowBalanceAlert(ctx.db, userId, targetPackageId, {
              remainingHours: parseFloat(pkg.remainingHours || "0"),
              totalHours: parseFloat(pkg.totalHours || "0"),
              clientId: pkg.clientId,
              packageName: pkg.name,
              lowBalanceAlertSentAt: pkg.lowBalanceAlertSentAt,
              usageId: "",
              hoursDeducted: 0,
            });
          }
        } catch (error) {
          console.error("Failed to send low balance alert:", error);
        }
      }

      const updatedRow = Array.isArray(updatedEntry)
        ? updatedEntry[0]
        : updatedEntry;
      if (updatedRow) {
        emitWebhookEvent({
          userId,
          orgId: ctx.orgId,
          eventType: "time_entry.updated",
          eventId: updatedRow.id,
          data: { timeEntry: updatedRow },
          clientId: updatedRow.clientId,
          projectId: updatedRow.projectId,
        });
      }

      return { ...updatedEntry, complianceWarnings };
    }),

  // Delete time entry
  delete: subscribedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
      });

      if (!existingEntry) {
        throw Errors.timeEntryNotFound();
      }

      // Fakturerede poster kan ikke slettes (#702)
      assertEntryNotBilled(existingEntry);

      // Fælles redigeringsguard (#467)
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: existingEntry.userId,
        actorUserId: userId,
        dates: [existingEntry.date],
        entries: [existingEntry],
      });

      await ctx.db.transaction(async (tx) => {
        if (existingEntry.taskId) {
          const minutesToRemove = Math.round(Number(existingEntry.hours) * 60);
          await tx
            .update(tasks)
            .set({
              actualMinutes: sql`GREATEST(0, COALESCE(${tasks.actualMinutes}, 0) - ${minutesToRemove})`,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, existingEntry.taskId));
        }

        // Fælles reversal: refunderer kortet og rydder også efterladte
        // usage-rækker på ikke-prepaid poster (FK uden ON DELETE).
        await refundPrepaidForDeletion(tx, [existingEntry]);

        await tx
          .delete(generatedTimeEntries)
          .where(eq(generatedTimeEntries.timeEntryId, input.id));

        await tx.delete(timeEntries).where(eq(timeEntries.id, input.id));
      });

      // Skrivebordet skal høre om sletningen, også når den sker i browseren —
      // ellers står posten stadig i appens lokale db, og dens næste
      // redigering fejler med "Entity not found" for evigt. Ejeren af rækken
      // (ikke den slettende) skriver nøglen, så det er *hans* enhed der ryddes.
      //
      // EFTER commit og på den ydre db, ikke i transaktionen: Postgres
      // afbryder en transaktion ved det første fejlede statement, så en
      // tombstone-insert der fejler (migrationen 0128 er endnu ikke kørt)
      // ville rulle den reelle sletning tilbage — mens mutationen svarede
      // `{success: true}`, så posten så væk ud for brugeren og lå i DB'en
      // ved næste reload. Målt mod Postgres 17 (se
      // sync-tombstones.integration.test.ts).
      await recordDeletionTombstones(ctx.db, {
        entityType: "time_entry",
        rows: [existingEntry],
      });

      // Audit EFTER succes (review-fund) — må ikke påstå sletning der
      // blev rullet tilbage
      if (ctx.orgId) {
        logOrgAudit(ctx.db, ctx.orgId, userId, "time_entry_deleted", {
          metadata: {
            entryId: input.id,
            hours: existingEntry.hours,
            date: existingEntry.date,
            description: existingEntry.description,
          },
        });
      }

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "time_entry.deleted",
        eventId: existingEntry.id,
        data: { timeEntry: existingEntry },
        clientId: existingEntry.clientId,
        projectId: existingEntry.projectId,
      });

      return { success: true };
    }),

  // Duplicate time entry
  duplicate: subscribedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        newDate: z.string().optional(), // Optional date in YYYY-MM-DD format
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Find the original entry
      const originalEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(
          eq(timeEntries.id, input.id),
          ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
        ),
      });

      if (!originalEntry) {
        throw Errors.timeEntryNotFound();
      }

      // Use provided date or today's Danish date (UTC-midnat-konventionen,
      // ikke "nu", der lå på gårsdagen kl. 00-02 i prod, #649)
      const targetDate = input.newDate
        ? new Date(input.newDate)
        : entryDateFromStr(copenhagenToday());

      // Calculate billable rate for new entry (satsen på den nye dato)
      const billableRate = await getRateForTimeEntry(
        ctx.db,
        userId,
        originalEntry.projectId,
        originalEntry.clientId,
        ctx.orgId,
        input.newDate ?? targetDate,
      );

      // Fælles redigeringsguard (#467): duplikering ind i låst periode afvises
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        dates: [targetDate],
      });

      // Kopien er en ny post: godkendelsesflow og kostpris som i create (#1107)
      const approvalStatus = await resolveInitialApprovalStatus(
        ctx.db,
        userId,
        originalEntry.clientId,
        originalEntry.projectId,
      );
      const costRate = await getCostRateForMember(ctx.db, userId, ctx.orgId);

      // Create duplicate with specified or today's date
      const [newEntry] = await ctx.db
        .insert(timeEntries)
        .values({
          userId,
          organizationId: ctx.orgId,
          projectId: originalEntry.projectId,
          clientId: originalEntry.clientId,
          description: originalEntry.description,
          notes: originalEntry.notes,
          date: targetDate,
          hours: originalEntry.hours,
          billableRate,
          costRate,
          isBillable: originalEntry.isBillable,
          isPrepaid: false, // Don't copy prepaid status
          isBilled: false, // New entry is not billed
          source: "manual", // Duplicate is a manual action
          approvalStatus,
        })
        .returning();

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "time_entry.created",
        eventId: newEntry.id,
        data: { timeEntry: newEntry },
        clientId: newEntry.clientId,
        projectId: newEntry.projectId,
      });

      return newEntry;
    }),

  // Copy the user's own entries from the previous week into the target week
  copyWeek: subscribedProcedure
    .input(
      z.object({
        /** Mandag i mål-ugen, YYYY-MM-DD */
        targetWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Danske ugegrænser uanset processens TZ (#649)
      const targetStart = copenhagenDayStart(input.targetWeekStart);
      const sourceStart = copenhagenDayStart(
        addDaysToDateStr(input.targetWeekStart, -7),
      );

      // Kun egne registreringer — også i org-kontekst
      const sourceEntries = await ctx.db.query.timeEntries.findMany({
        where: and(
          eq(timeEntries.userId, userId),
          ctx.orgId ? eq(timeEntries.organizationId, ctx.orgId) : undefined,
          gte(timeEntries.date, sourceStart),
          lt(timeEntries.date, targetStart),
        ),
      });

      if (sourceEntries.length === 0) {
        return { count: 0 };
      }

      // Målugen må ikke være låst (#467): kopier aldrig ind i en lukket uge
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        dates: sourceEntries.map(
          (e) => new Date(e.date.getTime() + 7 * 86_400_000),
        ),
      });

      // Én rate-cache for hele ugen i stedet for et opslag pr. post
      const rateCache = await buildRateLookupCache(ctx.db, userId, ctx.orgId);
      // Kopierne er nye poster: godkendelsesflow og kostpris som i create
      // (#1107). Flowet afhænger af klient/projekt, så det slås op pr. par.
      const costRate = await getCostRateForMember(ctx.db, userId, ctx.orgId);
      const approvalByScope = new Map<string, "pending" | "not_required">();
      const values = [];
      for (const entry of sourceEntries) {
        const scopeKey = `${entry.clientId ?? ""}|${entry.projectId ?? ""}`;
        let approvalStatus = approvalByScope.get(scopeKey);
        if (!approvalStatus) {
          approvalStatus = await resolveInitialApprovalStatus(
            ctx.db,
            userId,
            entry.clientId,
            entry.projectId,
          );
          approvalByScope.set(scopeKey, approvalStatus);
        }
        // +7 døgn i UTC: datoen gemmes som UTC-midnat, så ugedagen bevares
        // uafhængigt af processens TZ og sommertid.
        const newDate = new Date(entry.date.getTime() + 7 * 86_400_000);
        // Sats fra satshierarkiet på den nye dato — som duplicate gør
        const billableRate = getRateFromCache(
          rateCache,
          entry.projectId,
          entry.clientId,
          newDate,
        );
        values.push({
          userId,
          organizationId: ctx.orgId,
          projectId: entry.projectId,
          clientId: entry.clientId,
          description: entry.description,
          notes: entry.notes,
          date: newDate,
          hours: entry.hours,
          billableRate,
          costRate,
          isBillable: entry.isBillable,
          // Kopier aldrig klippekort-træk eller faktureret-status
          isPrepaid: false,
          isBilled: false,
          source: "manual" as const,
          approvalStatus,
        });
      }

      await ctx.db.insert(timeEntries).values(values);
      return { count: values.length };
    }),

  // Bulk delete time entries
  bulkDelete: subscribedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.ids.length === 0) {
        return { success: true, count: 0 };
      }

      // Verify all entries belong to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntries = await ctx.db.query.timeEntries.findMany({
        where: and(inArray(timeEntries.id, input.ids), ownershipFilter),
      });

      if (existingEntries.length !== input.ids.length) {
        throw Errors.timeEntriesNotFound();
      }

      // Fakturerede poster kan ikke slettes (#702)
      assertNoEntriesBilled(existingEntries, "slettes");

      // Fælles redigeringsguard (#467)
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        dates: existingEntries.map((e) => e.date),
        entries: existingEntries,
      });

      await ctx.db.transaction(async (tx) => {
        const minutesByTask = new Map<string, number>();
        for (const entry of existingEntries) {
          if (!entry.taskId) continue;
          const minutes = Math.round(Number(entry.hours) * 60);
          minutesByTask.set(
            entry.taskId,
            (minutesByTask.get(entry.taskId) ?? 0) + minutes,
          );
        }
        for (const [taskId, minutesToRemove] of minutesByTask) {
          await tx
            .update(tasks)
            .set({
              actualMinutes: sql`GREATEST(0, COALESCE(${tasks.actualMinutes}, 0) - ${minutesToRemove})`,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, taskId));
        }

        // Samme reversal som time.delete (A1 P2-3): låser pakken, giver
        // kun ikke-overtræk tilbage på saldoen og nedskriver overtrækket.
        await refundPrepaidForDeletion(tx, existingEntries);

        await tx
          .delete(generatedTimeEntries)
          .where(inArray(generatedTimeEntries.timeEntryId, input.ids));

        await tx
          .delete(timeEntries)
          .where(and(inArray(timeEntries.id, input.ids), ownershipFilter));
      });

      // Uden for transaktionen — en fejlet tombstone-insert må ikke kunne
      // rulle sletningen tilbage (se time.delete).
      await recordDeletionTombstones(ctx.db, {
        entityType: "time_entry",
        rows: existingEntries,
      });

      // Audit EFTER succes (review-fund)
      if (ctx.orgId) {
        logOrgAudit(ctx.db, ctx.orgId, userId, "time_entries_bulk_deleted", {
          metadata: {
            count: existingEntries.length,
            entryIds: existingEntries.slice(0, 50).map((e) => e.id),
          },
        });
      }

      return { success: true, count: existingEntries.length };
    }),

  // Bulk mark as billed
  bulkMarkBilled: subscribedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()), isBilled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.ids.length === 0) {
        return { success: true, count: 0 };
      }

      // Verify all entries belong to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntries = await ctx.db.query.timeEntries.findMany({
        where: and(inArray(timeEntries.id, input.ids), ownershipFilter),
      });

      if (existingEntries.length !== input.ids.length) {
        throw Errors.timeEntriesNotFound();
      }

      // Poster på en faktura frigives kun via fakturaen (#702) — ellers
      // brydes invarianten isBilled ⟺ aktiv fakturalinje
      if (!input.isBilled) {
        const onInvoice = existingEntries.filter((e) => e.invoiceId);
        if (onInvoice.length > 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "time.onInvoiceUnmark", {
              count: onInvoice.length,
            }),
          });
        }
      }

      // Kun lukket periode låser (#1107): faktureret-markering sker typisk
      // efter godkendelse, så ugestatus og rullende lås gælder ikke her
      await assertEntriesEditable(ctx.db, {
        orgId: ctx.orgId,
        actorUserId: userId,
        entries: existingEntries,
        periodOnly: true,
      });

      // Update all entries
      await ctx.db
        .update(timeEntries)
        .set({ isBilled: input.isBilled })
        .where(and(inArray(timeEntries.id, input.ids), ownershipFilter));

      return { success: true, count: existingEntries.length };
    }),

  // Bulk mark as billable (can-be-billed toggle, distinct from isBilled)
  bulkMarkBillable: subscribedProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()),
        isBillable: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.ids.length === 0) {
        return { success: true, count: 0 };
      }

      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntries = await ctx.db.query.timeEntries.findMany({
        where: and(inArray(timeEntries.id, input.ids), ownershipFilter),
      });

      if (existingEntries.length !== input.ids.length) {
        throw Errors.timeEntriesNotFound();
      }

      assertNoEntriesBilled(existingEntries, "ændres");

      // Fælles redigeringsguard (#467)
      await assertEntriesEditable(ctx.db, {
        orgId: ctx.orgId,
        actorUserId: userId,
        entries: existingEntries,
      });

      await ctx.db
        .update(timeEntries)
        .set({ isBillable: input.isBillable })
        .where(and(inArray(timeEntries.id, input.ids), ownershipFilter));

      return { success: true, count: existingEntries.length };
    }),

  // Bulk move to project
  bulkMoveToProject: subscribedProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()),
        projectId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.ids.length === 0) {
        return { success: true, count: 0 };
      }

      // Verify project belongs to user/org
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, userId),
        ),
      });

      if (!project) {
        throw Errors.projectNotFound();
      }

      // Verify all entries belong to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntries = await ctx.db.query.timeEntries.findMany({
        where: and(inArray(timeEntries.id, input.ids), ownershipFilter),
      });

      if (existingEntries.length !== input.ids.length) {
        throw Errors.timeEntriesNotFound();
      }

      assertNoEntriesBilled(existingEntries, "flyttes");

      // Fælles redigeringsguard (#467)
      await assertEntriesEditable(ctx.db, {
        orgId: ctx.orgId,
        actorUserId: userId,
        entries: existingEntries,
      });

      // Satsen afhænger af postens dato (planlagte satsændringer), så
      // posterne grupperes efter sats og opdateres pr. gruppe.
      const rateCache = await buildRateLookupCache(ctx.db, userId, ctx.orgId);
      const idsByRate = new Map<string, string[]>();
      for (const entry of existingEntries) {
        const rateKey =
          getRateFromCache(rateCache, input.projectId, null, entry.date) ??
          "null";
        const ids = idsByRate.get(rateKey) ?? [];
        ids.push(entry.id);
        idsByRate.set(rateKey, ids);
      }

      // Klippekort-poster der flyttes til en anden kunde, må ikke blive
      // stående på den gamle kundes kort (A1 P2-2): samme detach som
      // time.update ved kundeskift. Gamle projekt-kunder slås op samlet.
      const prepaidEntries = existingEntries.filter(
        (e) => e.isPrepaid && e.prepaidPackageId,
      );
      const oldProjectIds = [
        ...new Set(
          prepaidEntries
            .map((e) => e.projectId)
            .filter((id): id is string => !!id),
        ),
      ];
      const oldProjectClients = new Map(
        oldProjectIds.length > 0
          ? (
              await ctx.db
                .select({ id: projects.id, clientId: projects.clientId })
                .from(projects)
                .where(inArray(projects.id, oldProjectIds))
            ).map((p) => [p.id, p.clientId ?? null] as const)
          : [],
      );

      await ctx.db.transaction(async (tx) => {
        // Kortene afstemmes FØR posterne skrives og i sorteret pakke-
        // rækkefølge — samme låseorden som time.update (pakke → post) og
        // refundPrepaidForDeletion, så samtidige skrivninger ikke deadlocker.
        const patches: Array<{ id: string; patch: PrepaidPatch }> = [];
        for (const entry of sortForPackageLock(prepaidEntries)) {
          const { patch } = await reconcilePrepaidAfterEdit(tx, {
            userId,
            orgId: ctx.orgId,
            entry: { ...entry, hours: Number(entry.hours) },
            oldClient: {
              clientId: entry.clientId ?? null,
              projectClientId: entry.projectId
                ? (oldProjectClients.get(entry.projectId) ?? null)
                : null,
            },
            newClient: {
              clientId: null,
              projectClientId: project.clientId ?? null,
            },
            newHours: Number(entry.hours),
          });
          if (patch) patches.push({ id: entry.id, patch });
        }

        for (const [rateKey, ids] of idsByRate) {
          await tx
            .update(timeEntries)
            .set({
              projectId: input.projectId,
              clientId: null,
              billableRate: rateKey === "null" ? null : rateKey,
            })
            .where(and(inArray(timeEntries.id, ids), ownershipFilter));
        }

        for (const { id, patch } of patches) {
          await tx.update(timeEntries).set(patch).where(eq(timeEntries.id, id));
        }
      });

      return {
        success: true,
        count: existingEntries.length,
        projectName: project.name,
      };
    }),

  // Bulk recalculate billable rates based on current rate hierarchy
  bulkRecalculateRates: subscribedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.ids.length === 0) {
        return { updated: 0, skipped: 0 };
      }

      // Verify all entries belong to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntries = await ctx.db.query.timeEntries.findMany({
        where: and(inArray(timeEntries.id, input.ids), ownershipFilter),
      });

      if (existingEntries.length !== input.ids.length) {
        throw Errors.timeEntriesNotFound();
      }

      // Fælles redigeringsguard (#467) — kun på de poster, der skrives;
      // fakturerede springes over nedenfor (billed → locked)
      await assertEntriesEditable(ctx.db, {
        orgId: ctx.orgId,
        actorUserId: userId,
        entries: existingEntries.filter((e) => !isBilledLocked(e)),
      });

      const rateCache = await buildRateLookupCache(ctx.db, userId, ctx.orgId);

      const invoicedIds: string[] = [];
      const updatesByRate = new Map<string, string[]>();

      for (const entry of existingEntries) {
        // Fakturerede poster er låst (#702) — også manuelt markerede
        if (isBilledLocked(entry)) {
          invoicedIds.push(entry.id);
          continue;
        }
        const newRate = getRateFromCache(
          rateCache,
          entry.projectId,
          entry.clientId,
          entry.date,
        );
        const rateKey = newRate ?? "null";
        const ids = updatesByRate.get(rateKey) ?? [];
        ids.push(entry.id);
        updatesByRate.set(rateKey, ids);
      }

      await ctx.db.transaction(async (tx) => {
        for (const [rateKey, ids] of updatesByRate) {
          await tx
            .update(timeEntries)
            .set({ billableRate: rateKey === "null" ? null : rateKey })
            .where(inArray(timeEntries.id, ids));
        }
      });

      const updated = existingEntries.length - invoicedIds.length;
      return {
        updated,
        skipped: invoicedIds.length,
        skippedReason:
          invoicedIds.length > 0
            ? "Allerede fakturerede posteringer blev sprunget over"
            : undefined,
      };
    }),

  // Inline quick update (hours only)
  quickUpdateHours: subscribedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        hours: z.number().min(0.01, { error: () => st("zod.hoursMin") }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify entry belongs to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
      });

      if (!existingEntry) {
        throw Errors.timeEntryNotFound();
      }

      assertEntryNotBilled(existingEntry);

      // Fælles redigeringsguard (#467)
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: existingEntry.userId,
        actorUserId: userId,
        dates: [existingEntry.date],
        entries: [existingEntry],
      });

      const oldHours = Number(existingEntry.hours);
      const newHours = input.hours;
      // Same integrity rules as the full update: re-open an already-decided
      // entry, and reconcile the klippekort balance, when hours change.
      const needsReapproval =
        (existingEntry.approvalStatus === "approved" ||
          existingEntry.approvalStatus === "rejected") &&
        oldHours !== newHours;

      // Klienten ændres ikke her — kun timetallet. Effektiv klient til
      // deductHoursCores kunde-tjek (CodeRabbit, PR #858).
      const entryClientId =
        existingEntry.clientId ??
        (await lookupProjectClientId(ctx.db, existingEntry.projectId));

      const [updatedEntry] = await ctx.db.transaction(async (tx) => {
        if (
          existingEntry.isPrepaid &&
          existingEntry.prepaidPackageId &&
          oldHours !== newHours
        ) {
          await reversePrepaidUsage(
            tx,
            input.id,
            existingEntry.prepaidPackageId,
          );
          await deductHoursCore(tx, userId, ctx.orgId, {
            packageId: existingEntry.prepaidPackageId,
            hours: newHours,
            timeEntryId: input.id,
            allowInactive: newHours <= oldHours,
            clientId: entryClientId,
          });
        }

        const [entry] = await tx
          .update(timeEntries)
          .set({
            hours: input.hours.toString(),
            ...(needsReapproval && {
              approvalStatus: "pending",
              approvedAt: null,
              approvedBy: null,
            }),
          })
          .where(and(eq(timeEntries.id, input.id), ownershipFilter))
          .returning();

        if (existingEntry.taskId) {
          const oldMinutes = Math.round(Number(existingEntry.hours) * 60);
          const newMinutes = Math.round(input.hours * 60);
          const delta = newMinutes - oldMinutes;
          if (delta !== 0) {
            await tx
              .update(tasks)
              .set({
                actualMinutes: sql`GREATEST(0, COALESCE(${tasks.actualMinutes}, 0) + ${delta})`,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, existingEntry.taskId));
          }
        }

        return [entry];
      });

      return updatedEntry;
    }),

  // Inline quick update (description only)
  quickUpdateDescription: subscribedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        description: z
          .string()
          .min(1, { error: () => st("zod.descriptionRequired") }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify entry belongs to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
      });

      if (!existingEntry) {
        throw Errors.timeEntryNotFound();
      }

      assertEntryNotBilled(existingEntry);

      // Fælles redigeringsguard (#467)
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: existingEntry.userId,
        actorUserId: userId,
        dates: [existingEntry.date],
        entries: [existingEntry],
      });

      const [updatedEntry] = await ctx.db
        .update(timeEntries)
        .set({ description: input.description })
        .where(and(eq(timeEntries.id, input.id), ownershipFilter))
        .returning();

      return updatedEntry;
    }),

  // Toggle billable status
  toggleBillable: subscribedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        isBillable: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify entry belongs to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
      });

      if (!existingEntry) {
        throw Errors.timeEntryNotFound();
      }

      assertEntryNotBilled(existingEntry);

      // Fælles redigeringsguard (#467)
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: existingEntry.userId,
        actorUserId: userId,
        dates: [existingEntry.date],
        entries: [existingEntry],
      });

      const [updatedEntry] = await ctx.db
        .update(timeEntries)
        .set({ isBillable: input.isBillable })
        .where(and(eq(timeEntries.id, input.id), ownershipFilter))
        .returning();

      return updatedEntry;
    }),

  // Inline quick update (time range only)
  quickUpdateTimeRange: subscribedProcedure
    .input(
      z
        .object({
          id: z.string().uuid(),
          startTime: z
            .string()
            .datetime({ offset: true })
            .optional()
            .nullable(),
          endTime: z.string().datetime({ offset: true }).optional().nullable(),
          // Optionally also update hours if calculated from time range
          hours: z.number().min(0.01).optional(),
        })
        .refine(
          (data) => {
            if (data.startTime && data.endTime) {
              return new Date(data.endTime) > new Date(data.startTime);
            }
            return true;
          },
          {
            error: () => st("zod.endAfterStart"),
            path: ["endTime"],
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify entry belongs to user/org
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const existingEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
      });

      if (!existingEntry) {
        throw Errors.timeEntryNotFound();
      }

      assertEntryNotBilled(existingEntry);

      // Fælles redigeringsguard (#467)
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: existingEntry.userId,
        actorUserId: userId,
        dates: [existingEntry.date],
        entries: [existingEntry],
      });

      const hoursChanged =
        input.hours !== undefined &&
        Number(existingEntry.hours) !== input.hours;
      const needsReapproval =
        hoursChanged &&
        (existingEntry.approvalStatus === "approved" ||
          existingEntry.approvalStatus === "rejected");

      const updateData: {
        startTime?: Date | null;
        endTime?: Date | null;
        hours?: string;
        approvalStatus?: string;
        approvedAt?: Date | null;
        approvedBy?: string | null;
      } = {};

      if (input.startTime !== undefined) {
        updateData.startTime = input.startTime
          ? new Date(input.startTime)
          : null;
      }
      if (input.endTime !== undefined) {
        updateData.endTime = input.endTime ? new Date(input.endTime) : null;
      }
      if (input.hours !== undefined) {
        updateData.hours = input.hours.toString();
      }
      // Re-open an already-decided entry when hours change (see update()).
      if (needsReapproval) {
        updateData.approvalStatus = "pending";
        updateData.approvedAt = null;
        updateData.approvedBy = null;
      }

      // Klienten ændres ikke her — kun tidsrummet/timetallet. Effektiv
      // klient til deductHoursCores kunde-tjek (CodeRabbit, PR #858).
      const entryClientId =
        existingEntry.clientId ??
        (await lookupProjectClientId(ctx.db, existingEntry.projectId));

      const [updatedEntry] = await ctx.db.transaction(async (tx) => {
        // Reconcile the klippekort balance when a prepaid entry's hours change.
        if (
          hoursChanged &&
          existingEntry.isPrepaid &&
          existingEntry.prepaidPackageId &&
          input.hours !== undefined
        ) {
          await reversePrepaidUsage(
            tx,
            input.id,
            existingEntry.prepaidPackageId,
          );
          await deductHoursCore(tx, userId, ctx.orgId, {
            packageId: existingEntry.prepaidPackageId,
            hours: input.hours,
            timeEntryId: input.id,
            allowInactive: input.hours <= Number(existingEntry.hours),
            clientId: entryClientId,
          });
        }

        return tx
          .update(timeEntries)
          .set(updateData)
          .where(and(eq(timeEntries.id, input.id), ownershipFilter))
          .returning();
      });

      return updatedEntry;
    }),

  // Get total hours for today (lightweight query for top bar counter)
  // Ugens afslutning (#110): fredagsritualet — huller mod ugemål,
  // ufaktureret pulje, luk-status og streak.
  getWeekReview: protectedProcedure
    .input(z.object({ weekStart: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // Danske datoer som strenge, uafhængigt af processens TZ (#649, #734).
      // Posternes `date` er UTC-midnat på den danske dato, så ugens grænser
      // er UTC-midnat på mandagene.
      const todayStr = copenhagenToday();
      const mondayStr =
        input?.weekStart && isDateStr(input.weekStart)
          ? input.weekStart
          : weekStartDateStr(todayStr);
      const nextMondayStr = addDaysToDateStr(mondayStr, 7);
      const monday = entryDateFromStr(mondayStr);
      const weekEnd = entryDateFromStr(nextMondayStr);

      // Ufaktureret tid: ÉN definition, delt med dashboard, påmindelsescron,
      // rapporter og API (#626). Ugeoversigten brugte før
      // `isBillable=true AND !isBilled AND !isPrepaid`, som både tabte
      // `isBillable NULL` og talte intern tid (#541) med.
      const [entries, unbilled, user, closure, closures] = await Promise.all([
        ctx.db.query.timeEntries.findMany({
          where: and(
            eq(timeEntries.userId, userId),
            gte(timeEntries.date, monday),
            lt(timeEntries.date, weekEnd),
            ne(timeEntries.approvalStatus, "rejected"),
          ),
          columns: {
            date: true,
            hours: true,
          },
        }),
        loadUnbilledSummary(ctx.db, {
          userId,
          orgId: ctx.orgId,
          onlyOwnEntries: true,
          from: monday,
          // weekEnd er mandag + 7 døgn (eksklusiv); helperen er inklusiv
          to: new Date(weekEnd.getTime() - 1),
        }),
        ctx.db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { weeklyHourGoal: true },
        }),
        ctx.db.query.weekClosures.findFirst({
          where: and(
            eq(weekClosures.userId, userId),
            eq(weekClosures.weekStart, weekClosureKey(mondayStr)),
          ),
          columns: { closedAt: true },
        }),
        ctx.db.query.weekClosures.findMany({
          where: eq(weekClosures.userId, userId),
          orderBy: (w, { desc: d }) => [d(w.weekStart)],
          limit: 52,
          columns: { weekStart: true },
        }),
      ]);

      const weeklyGoal = user?.weeklyHourGoal
        ? Number.parseFloat(user.weeklyHourGoal)
        : null;
      const dailyGoal = weeklyGoal ? weeklyGoal / 5 : null;

      // Timer pr. ugedag (man-søn)
      const days = Array.from({ length: 7 }, (_, i) => ({
        date: addDaysToDateStr(mondayStr, i),
        hours: 0,
      }));
      for (const e of entries) {
        // UTC-midnat på dansk dato — samme konvention som grænserne
        const dateStr = new Date(e.date).toISOString().slice(0, 10);
        const idx = days.findIndex((d) => d.date === dateStr);
        if (idx >= 0) {
          days[idx].hours += Number.parseFloat(e.hours || "0");
        }
      }

      // Streak: sammenhængende lukkede uger — men KUN hvis den seneste
      // lukning er denne eller sidste uge
      const streak = weekClosureStreak(
        closures.map((c) => new Date(c.weekStart)),
        todayStr,
      );

      return {
        weekStart: mondayStr,
        days: days.map((d, i) => ({
          date: d.date,
          hours: Math.round(d.hours * 100) / 100,
          // Kun hverdage måles mod dagsmålet
          isGap:
            i < 5 && dailyGoal !== null ? d.hours < dailyGoal * 0.5 : false,
        })),
        totalHours:
          Math.round(days.reduce((sum, d) => sum + d.hours, 0) * 100) / 100,
        weeklyGoal,
        unbilledHours: unbilled.hours,
        unbilledValue: unbilled.value,
        isClosed: !!closure,
        closedAt: closure?.closedAt ?? null,
        streak,
      };
    }),

  closeWeek: protectedProcedure
    .input(z.object({ weekStart: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!isDateStr(input.weekStart)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "time.invalidWeek"),
        });
      }

      const inserted = await ctx.db
        .insert(weekClosures)
        .values({
          userId,
          organizationId: ctx.orgId,
          // UTC-midnat på den danske mandag uanset proces-TZ (#734)
          weekStart: weekClosureKey(input.weekStart),
        })
        .onConflictDoNothing()
        .returning({ id: weekClosures.id });

      // Kun event ved REEL lukning (review-fund) — dobbeltklik/re-kald
      // må ikke inflatere week.closed-metrikken
      if (inserted.length > 0) {
        trackEvent({ userId, orgId: ctx.orgId, event: "week.closed" });
      }

      return { success: true };
    }),

  todayTotal: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    // Dansk dag uanset processens TZ (#649)
    const todayStr = copenhagenToday();
    const today = copenhagenDayStart(todayStr);
    const tomorrow = copenhagenDayEndExclusive(todayStr);

    // PERF: SUM in SQL instead of fetching every row and reducing in JS.
    const [row] = await ctx.db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
      })
      .from(timeEntries)
      .where(
        and(
          // Personal widget — the caller's own hours today, not the org total
          // (matches monthlyHours' personal default).
          eq(timeEntries.userId, userId),
          gte(timeEntries.date, today),
          lt(timeEntries.date, tomorrow),
        ),
      );

    return parseFloat((row?.total as unknown as string) ?? "0");
  }),

  // Get total hours for current month.
  // scope "personal" (default) = the current user's own hours — correct for
  // the personal dashboard so a team member sees their own, not the org total.
  // scope "team" = whole org (used by team/overview surfaces).
  monthlyHours: protectedProcedure
    .input(
      z
        .object({ scope: z.enum(["personal", "team"]).default("personal") })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const scopeFilter =
        (input?.scope ?? "personal") === "team" && ctx.orgId
          ? eq(timeEntries.organizationId, ctx.orgId)
          : eq(timeEntries.userId, userId);

      // PERF: SUM in SQL.
      const [row] = await ctx.db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
        })
        .from(timeEntries)
        .where(
          and(
            scopeFilter,
            gte(timeEntries.date, startOfMonth),
            lt(timeEntries.date, startOfNextDay(endOfMonth)),
          ),
        );

      const totalHours = parseFloat((row?.total as unknown as string) ?? "0");
      return Math.round(totalHours * 10) / 10; // hours with 1 decimal
    }),

  // Get estimated revenue for current month (scope as in monthlyHours).
  monthlyRevenue: protectedProcedure
    .input(
      z
        .object({ scope: z.enum(["personal", "team"]).default("personal") })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const scopeFilter =
        (input?.scope ?? "personal") === "team" && ctx.orgId
          ? eq(timeEntries.organizationId, ctx.orgId)
          : eq(timeEntries.userId, userId);

      // PERF: Previously called getRateForTimeEntry inside the per-entry loop,
      // producing an N+1 cascade (3 additional queries per time entry). Build
      // a single rate lookup cache up front and only fetch the columns we need.
      const [entries, rateCache] = await Promise.all([
        ctx.db.query.timeEntries.findMany({
          where: and(
            scopeFilter,
            gte(timeEntries.date, startOfMonth),
            lt(timeEntries.date, startOfNextDay(endOfMonth)),
          ),
          columns: {
            hours: true,
            projectId: true,
            clientId: true,
            isPrepaid: true,
            date: true,
          },
        }),
        buildRateLookupCache(ctx.db, userId, ctx.orgId),
      ]);

      let totalRevenue = 0;
      for (const entry of entries) {
        if (entry.isPrepaid) continue;
        const rate = getRateFromCache(
          rateCache,
          entry.projectId,
          entry.clientId,
          entry.date,
        );
        if (rate) {
          const hours = parseFloat(entry.hours || "0");
          totalRevenue += hours * parseFloat(rate);
        }
      }

      return Math.round(totalRevenue);
    }),

  // Get unbilled time entries stats
  unbilledStats: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Ufaktureret tid — ÉN definition, delt med påmindelsescronen, rapporterne
    // og det offentlige API (#626). Widget'en filtrerede tidligere kun på
    // `isPrepaid=false AND isBilled=false`, så intern tid (#541) og eksplicit
    // ikke-fakturerbar tid talte med i et beløb man ikke kunne fakturere.
    //
    // PERF: aggregeringen sker nu i SQL — hverken rækkerne eller en
    // rate-lookup-cache skal loades. Værdien er timer × billableRate, altså
    // den sats fakturalinjen faktisk ville blive skrevet med (samme regnestykke
    // som invoices.createFromTimeEntries).
    return loadUnbilledSummary(ctx.db, {
      // Personal dashboard widget — the caller's own unbilled time.
      userId,
      orgId: ctx.orgId,
      onlyOwnEntries: true,
    });
  }),

  // Ufaktureret tid pr. kunde — samme definition som unbilledStats (#626).
  // Driver /api/v1/reports/unbilled, der tidligere aggregerede time.list i
  // hukommelsen og dermed både brugte et andet filter og tavst stoppede ved
  // listens default-limit på 100 rækker.
  unbilledByClient: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Samme synlighedsregel som time.list: kun owner/admin (eller en med
    // viewTeamTime) ser hele org'ens tid.
    const restrictToOwnEntries = ctx.orgId
      ? !(await canViewAllOrgTime(ctx.db, ctx.orgId, userId))
      : false;

    const rows = await loadUnbilledByClient(ctx.db, {
      userId,
      orgId: ctx.orgId,
      onlyOwnEntries: restrictToOwnEntries,
    });

    if (!ctx.orgId) return rows;

    // Per-medlem klientadgang (member_client_access). Alle rækker HER har en
    // kunde, så et simpelt filter er nok.
    const { getAccessibleClientIds } = await import("./clientAccess");
    const accessibleIds = await getAccessibleClientIds(
      ctx.db,
      userId,
      ctx.orgId,
    );
    if (accessibleIds === null) return rows;
    return rows.filter((r) => accessibleIds.includes(r.clientId));
  }),

  // Get weekly goal progress
  weeklyGoalProgress: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)

    // Get user's weekly hour goal preference
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    // Get Monday of current week
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    currentWeekStart.setHours(0, 0, 0, 0);

    // Get Sunday of current week
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
    currentWeekEnd.setHours(23, 59, 59, 999);

    // PERF: SUM in SQL.
    const [weekRow] = await ctx.db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
      })
      .from(timeEntries)
      .where(
        and(
          // Personal: progress is measured against the caller's own weekly hour
          // goal, so it must sum only their own hours — never the org total.
          eq(timeEntries.userId, userId),
          gte(timeEntries.date, currentWeekStart),
          lte(timeEntries.date, currentWeekEnd),
        ),
      );
    const hoursWorked = parseFloat(
      (weekRow?.total as unknown as string) ?? "0",
    );

    // Use user's preference or default to 37 hours (typical Danish workweek)
    const parsed = user?.weeklyHourGoal ? parseFloat(user.weeklyHourGoal) : 37;
    const weeklyGoal = Number.isFinite(parsed) && parsed > 0 ? parsed : 37;

    // Calculate days remaining in week (from now until Sunday 23:59)
    const now2 = new Date();
    const daysRemaining = Math.max(
      0,
      Math.ceil(
        (currentWeekEnd.getTime() - now2.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );

    const hoursRemaining = Math.max(0, weeklyGoal - hoursWorked);
    const hoursPerDayNeeded =
      daysRemaining > 0 ? hoursRemaining / daysRemaining : 0;

    const progressPercentage = Math.min(
      100,
      Math.round((hoursWorked / weeklyGoal) * 100),
    );

    return {
      hoursWorked: Math.round(hoursWorked * 10) / 10,
      weeklyGoal,
      hoursRemaining: Math.round(hoursRemaining * 10) / 10,
      daysRemaining,
      hoursPerDayNeeded: Math.round(hoursPerDayNeeded * 10) / 10,
      progressPercentage,
      isOnTrack: hoursWorked >= (weeklyGoal / 7) * (7 - daysRemaining),
      weekStart: currentWeekStart,
      weekEnd: currentWeekEnd,
    };
  }),

  // Get productivity heatmap data (last 90 days)
  productivityHeatmap: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)

    // Get date 90 days ago
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(now.getDate() - 90);
    ninetyDaysAgo.setHours(0, 0, 0, 0);

    // PERF: Aggregate per-day totals in SQL. Previously pulled every time
    // entry from the last 90 days into memory just to bucket them by day.
    const rows = await ctx.db
      .select({
        date: sql<string>`to_char(${timeEntries.date}, 'YYYY-MM-DD')`,
        hours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
      })
      .from(timeEntries)
      .where(
        and(
          // Personal dashboard widget — the caller's own activity, never the
          // whole team's (matches monthlyHours' personal default).
          eq(timeEntries.userId, userId),
          gte(timeEntries.date, ninetyDaysAgo),
        ),
      )
      .groupBy(sql`to_char(${timeEntries.date}, 'YYYY-MM-DD')`);

    const heatmapData = rows.map((r) => ({
      date: r.date,
      hours: Math.round(parseFloat(r.hours as unknown as string) * 10) / 10,
    }));

    // PERF: Use a Set for O(1) streak lookups instead of Array.includes in a
    // loop (was O(n) per lookup × 365 iterations).
    const dateSet = new Set(heatmapData.map((d) => d.date));
    let currentStreak = 0;

    if (dateSet.size > 0) {
      // Danske datoer og ren kalender-aritmetik: uafhængigt af processens
      // TZ, og et døgn på 23/25 timer ved sommertid springer ikke en dag over
      // (#649).
      const today = copenhagenToday(now);
      const yesterday = addDaysToDateStr(today, -1);

      if (dateSet.has(today) || dateSet.has(yesterday)) {
        currentStreak = 1;
        let checkDateStr = dateSet.has(today) ? today : yesterday;

        for (let i = 1; i < 365; i++) {
          checkDateStr = addDaysToDateStr(checkDateStr, -1);

          if (dateSet.has(checkDateStr)) {
            currentStreak++;
          } else {
            break;
          }
        }
      }
    }

    // Calculate weekly average
    const weeklyAverage =
      heatmapData.length > 0
        ? (heatmapData.reduce((sum, day) => sum + day.hours, 0) /
            Math.min(90, heatmapData.length)) *
          7
        : 0;

    return {
      heatmapData,
      currentStreak,
      weeklyAverage: Math.round(weeklyAverage * 10) / 10,
    };
  }),

  // Get revenue forecast
  revenueForecast: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)

    // Build rate cache once (avoids N+1 queries)
    const rateCache = await buildRateLookupCache(ctx.db, userId, ctx.orgId);

    // Calculate date range for all 6 months
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const endOfCurrentMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    );

    // Fetch all entries in one query
    const allEntries = await ctx.db.query.timeEntries.findMany({
      where: and(
        // Personal dashboard widget — forecast from the caller's own history.
        eq(timeEntries.userId, userId),
        gte(timeEntries.date, sixMonthsAgo),
        lt(timeEntries.date, startOfNextDay(endOfCurrentMonth)),
        eq(timeEntries.isPrepaid, false), // Only billable time
      ),
    });

    // Group entries by month and calculate revenue
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        1,
      );
      const endOfMonth = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        0,
      );

      // Filter entries for this month
      const monthEntries = allEntries.filter(
        (e) => e.date >= startOfMonth && e.date <= endOfMonth,
      );

      // Calculate revenue using cached rates (no DB queries)
      let revenue = 0;
      for (const entry of monthEntries) {
        const rate = getRateFromCache(
          rateCache,
          entry.projectId,
          entry.clientId,
          entry.date,
        );
        if (rate) {
          const hours = parseFloat(entry.hours) || 0;
          const rateValue = parseFloat(rate) || 0;
          revenue += hours * rateValue;
        }
      }

      months.push({
        month: monthDate.toLocaleDateString(toIntlLocale(activeLocale()), {
          timeZone: "Europe/Copenhagen",
          month: "short",
          year: "numeric",
        }),
        revenue: Math.round(revenue),
        isPast: i !== 0,
      });
    }

    // Calculate forecast for current month
    const _currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();

    const currentMonthRevenue = months[months.length - 1].revenue;
    const averageDailyRevenue =
      dayOfMonth > 0 ? currentMonthRevenue / dayOfMonth : 0;
    const forecastRevenue = Math.round(averageDailyRevenue * daysInMonth);

    // Calculate trend (last month vs this month forecast)
    const lastMonthRevenue =
      months.length > 1 ? months[months.length - 2].revenue : 0;
    const trendPercentage =
      lastMonthRevenue > 0
        ? Math.round(
            ((forecastRevenue - lastMonthRevenue) / lastMonthRevenue) * 100,
          )
        : 0;

    // Calculate 6-month average
    const sixMonthAverage = Math.round(
      months.slice(0, -1).reduce((sum, m) => sum + m.revenue, 0) /
        Math.max(1, months.length - 1),
    );

    return {
      monthlyData: months,
      forecastRevenue,
      currentRevenue: currentMonthRevenue,
      trendPercentage,
      sixMonthAverage,
      dayOfMonth,
      daysInMonth,
    };
  }),

  // Get weekly hours comparison (current week vs last week)
  weeklyComparison: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)

    // Get Monday of current week
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    currentWeekStart.setHours(0, 0, 0, 0);

    // Get Sunday of current week
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
    currentWeekEnd.setHours(23, 59, 59, 999);

    // Get Monday of last week
    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(currentWeekStart.getDate() - 7);

    // Get Sunday of last week
    const lastWeekEnd = new Date(currentWeekStart);
    lastWeekEnd.setDate(currentWeekStart.getDate() - 1);
    lastWeekEnd.setHours(23, 59, 59, 999);

    // PERF: SUM both weeks in a single query via FILTER — previously
    // loaded every entry from both weeks into memory just to sum.
    // Convert Date → ISO string because postgres.js rejects raw Date
    // objects in sql`` template tags with "argument must be string".
    const cwStart = currentWeekStart.toISOString();
    const cwEnd = currentWeekEnd.toISOString();
    const lwStart = lastWeekStart.toISOString();
    const lwEnd = lastWeekEnd.toISOString();

    const [row] = await ctx.db
      .select({
        currentHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)) FILTER (WHERE ${timeEntries.date} >= ${cwStart} AND ${timeEntries.date} <= ${cwEnd}), 0)`,
        lastHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)) FILTER (WHERE ${timeEntries.date} >= ${lwStart} AND ${timeEntries.date} <= ${lwEnd}), 0)`,
      })
      .from(timeEntries)
      .where(
        and(
          // Personal dashboard widget — the caller's own hours this/last week.
          eq(timeEntries.userId, userId),
          sql`${timeEntries.date} >= ${lwStart}`,
          sql`${timeEntries.date} <= ${cwEnd}`,
        ),
      );

    const currentWeekHours = parseFloat(
      (row?.currentHours as unknown as string) ?? "0",
    );
    const lastWeekHours = parseFloat(
      (row?.lastHours as unknown as string) ?? "0",
    );

    const difference = currentWeekHours - lastWeekHours;
    const percentageChange =
      lastWeekHours > 0
        ? ((currentWeekHours - lastWeekHours) / lastWeekHours) * 100
        : currentWeekHours > 0
          ? 100
          : 0;

    return {
      currentWeek: {
        hours: Math.round(currentWeekHours * 10) / 10,
        startDate: currentWeekStart,
        endDate: currentWeekEnd,
      },
      lastWeek: {
        hours: Math.round(lastWeekHours * 10) / 10,
        startDate: lastWeekStart,
        endDate: lastWeekEnd,
      },
      difference: Math.round(difference * 10) / 10,
      percentageChange: Math.round(percentageChange),
    };
  }),

  // Bulk import time entries from CSV
  bulkImport: protectedProcedure
    .input(
      z.object({
        entries: z.array(csvImportEntrySchema),
        defaultProjectId: z.string().uuid().optional(),
        skipDuplicates: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Fælles redigeringsguard (#467): CSV-import er den mest direkte
      // backdating-vektor
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        dates: input.entries.map((e) => e.date),
      });

      // Build rate cache once (avoids N+1 queries)
      const rateCache = await buildRateLookupCache(ctx.db, userId, ctx.orgId);

      // Get user's projects and clients for matching
      const userProjects = await ctx.db.query.projects.findMany({
        where: ctx.orgId
          ? eq(projects.organizationId, ctx.orgId)
          : eq(projects.userId, userId),
        with: { client: true },
      });

      // Standardprojektet skrives på hver række uden projektmatch, så det skal
      // tilhøre kalderens org/bruger ligesom de navnematchede projekter.
      if (
        input.defaultProjectId &&
        !userProjects.some((p) => p.id === input.defaultProjectId)
      ) {
        throw Errors.projectNotFound();
      }

      const userClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
      });

      // Create lookup maps (case-insensitive)
      const projectMap = new Map<
        string,
        { id: string; clientId: string | null }
      >();
      for (const p of userProjects) {
        projectMap.set(p.name.toLowerCase(), {
          id: p.id,
          clientId: p.clientId,
        });
      }

      const clientMap = new Map<string, string>();
      for (const c of userClients) {
        clientMap.set(c.name.toLowerCase(), c.id);
      }

      const results = {
        imported: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string }>,
      };

      // Hver rækkes danske dato. En ulæselig celle bidrager ikke til
      // dedupe-vinduet — den rapporteres pr. række i løkken nedenfor, så én
      // ugyldig dato ikke kasserer hele importen.
      const entryDateStrs = input.entries.map((e) =>
        entryDateStrFromInput(e.date),
      );
      const validDateStrs = entryDateStrs
        .filter((d): d is string => d !== null)
        .sort();

      const existingEntries =
        input.skipDuplicates && validDateStrs.length > 0
          ? await ctx.db.query.timeEntries.findMany({
              where: and(
                ctx.orgId
                  ? eq(timeEntries.organizationId, ctx.orgId)
                  : eq(timeEntries.userId, userId),
                // Hele danske døgn: dækker både UTC-midnat-rækker og ældre
                // rækker gemt på dansk midnat (22:00Z/23:00Z dagen før).
                gte(timeEntries.date, copenhagenDayStart(validDateStrs[0])),
                lt(
                  timeEntries.date,
                  copenhagenDayEndExclusive(
                    validDateStrs[validDateStrs.length - 1],
                  ),
                ),
              ),
              columns: {
                date: true,
                hours: true,
                description: true,
                projectId: true,
              },
            })
          : [];

      // Create a set for fast duplicate lookup. `hoursKey` på begge sider:
      // DB-siden læser `numeric(5,2)` som "7.50", input-siden et zod-tal 7.5 —
      // uden fælles form matchede nøglen aldrig, og en genimport med "spring
      // dubletter" oprettede (og fakturerede) hver post igen.
      const existingKeys = new Set(
        existingEntries.map(
          (e) =>
            `${toCopenhagenDateStr(e.date)}-${hoursKey(e.hours)}-${e.description}-${e.projectId || ""}`,
        ),
      );

      for (let i = 0; i < input.entries.length; i++) {
        const entry = input.entries[i];

        try {
          // Dagen fra CSV'en læses på den danske dag; en ulæselig celle
          // rapporteres pr. række, og de øvrige rækker importeres stadig.
          const entryDateStr = entryDateStrs[i];
          if (!entryDateStr) {
            results.errors.push({
              row: i + 1,
              error: await tr("serverErrors", "time.importInvalidDate", {
                date: entry.date,
              }),
            });
            continue;
          }

          // Match project by name
          let projectId: string | null = input.defaultProjectId || null;
          let clientId: string | null = null;

          if (entry.projectName) {
            const projectMatch = projectMap.get(
              entry.projectName.toLowerCase(),
            );
            if (projectMatch) {
              projectId = projectMatch.id;
              clientId = projectMatch.clientId;
            }
          }

          // If no project matched but we have client name, try to find client
          if (!projectId && entry.clientName) {
            const clientMatch = clientMap.get(entry.clientName.toLowerCase());
            if (clientMatch) {
              clientId = clientMatch;
            }
          }

          // Must have either project or client
          if (!projectId && !clientId) {
            results.errors.push({
              row: i + 1,
              error: await tr("serverErrors", "time.importNoProjectOrClient", {
                project: entry.projectName || "?",
                client: entry.clientName || "?",
              }),
            });
            continue;
          }

          // Check for duplicates
          const entryKey = `${entryDateStr}-${hoursKey(entry.hours)}-${entry.description}-${projectId || ""}`;
          if (input.skipDuplicates && existingKeys.has(entryKey)) {
            results.skipped++;
            continue;
          }

          // Calculate rate using cache (no DB query)
          const billableRate = getRateFromCache(
            rateCache,
            projectId,
            clientId,
            entryDateStr,
          );

          // Insert time entry
          await ctx.db.insert(timeEntries).values({
            userId,
            organizationId: ctx.orgId,
            projectId,
            clientId,
            description: entry.description,
            date: entryDateFromStr(entryDateStr),
            hours: entry.hours.toString(),
            billableRate,
            isBillable: await resolveDefaultBillable(ctx.db, {
              projectId,
              clientId,
            }),
            source: "import",
          });

          results.imported++;
          existingKeys.add(entryKey); // Add to existing set to prevent duplicates within batch
        } catch (error) {
          results.errors.push({
            row: i + 1,
            error:
              error instanceof Error
                ? error.message
                : await tr("serverErrors", "common.unknownError"),
          });
        }
      }

      return results;
    }),

  // =====================================
  // Time Entry Segments API
  // Allows multiple work periods per time entry
  // e.g., "9:00-11:30 + 14:00-16:00" on the same entry
  // =====================================

  // List segments for a time entry
  listSegments: protectedProcedure
    .input(z.object({ timeEntryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify the time entry belongs to the user/org
      const entry = await ctx.db.query.timeEntries.findFirst({
        where: and(
          eq(timeEntries.id, input.timeEntryId),
          ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
        ),
      });

      if (!entry) {
        throw Errors.timeEntryNotFound();
      }

      const segments = await ctx.db.query.timeEntrySegments.findMany({
        where: eq(timeEntrySegments.timeEntryId, input.timeEntryId),
        orderBy: [desc(timeEntrySegments.startTime)],
      });

      return segments;
    }),

  // Create a new segment for a time entry
  createSegment: protectedProcedure
    .input(
      z
        .object({
          timeEntryId: z.string().uuid(),
          startTime: z.string().datetime({ offset: true }),
          endTime: z.string().datetime({ offset: true }),
          notes: z.string().optional(),
        })
        .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
          error: () => st("zod.endAfterStart"),
          path: ["endTime"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify the time entry belongs to the user (kun ejer må røre andres,
      // som alle øvrige tid-mutationer). Uden dette kunne et menigt medlem
      // tilføje et segment til en kollegas post → tiderne lægges sammen i én
      // post (manglede i it.7-sweepet over tid-mutationer).
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const entry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.timeEntryId), ownershipFilter),
      });

      if (!entry) {
        throw Errors.timeEntryNotFound();
      }

      assertEntryNotBilled(entry);
      // Segmenter ændrer postens timer — samme låse som øvrige tid-mutationer
      // (periodelås, periodeafslutning #518, ugestatus, rullende lås)
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: entry.userId,
        actorUserId: userId,
        dates: [entry.date],
        entries: [entry],
      });

      return ctx.db.transaction(async (tx) => {
        // Lås posten, så to samtidige segmenter ikke begge lægger til de
        // samme forrige timer.
        const [locked] = await tx
          .select()
          .from(timeEntries)
          .where(eq(timeEntries.id, input.timeEntryId))
          .for("update");
        const current = locked ?? entry;

        const existingSegments = await tx.query.timeEntrySegments.findMany({
          where: eq(timeEntrySegments.timeEntryId, input.timeEntryId),
        });

        const startTime = new Date(input.startTime);
        const endTime = new Date(input.endTime);
        // Timer = forrige timer + nyt segment — aldrig udledt af postens
        // start→slut-spænd, der efter "Fortsæt" indeholder pausen (review
        // P2, A2 P1-4). Uden segmenter bygges et retroaktivt segment af
        // postens timer, forankret i dens sluttid.
        const plan = planSegmentAppend({
          entryHours: Number(current.hours),
          entryStartTime: current.startTime
            ? new Date(current.startTime)
            : null,
          entryEndTime: current.endTime ? new Date(current.endTime) : null,
          hasSegments: existingSegments.length > 0,
          newStart: startTime,
          newEnd: endTime,
        });
        if (plan.retroSegment) {
          await tx.insert(timeEntrySegments).values({
            timeEntryId: input.timeEntryId,
            ...plan.retroSegment,
            notes: null,
          });
        }

        const durationMinutes = Math.round(
          (endTime.getTime() - startTime.getTime()) / (1000 * 60),
        );

        const [segment] = await tx
          .insert(timeEntrySegments)
          .values({
            timeEntryId: input.timeEntryId,
            startTime,
            endTime,
            durationMinutes,
            notes: input.notes || null,
          })
          .returning();

        // Timer + klippekort-afstemning. Et timer-stop må aldrig fejle på
        // kortet: kan det ikke dække tiden, gemmes den alligevel og det
        // oprindelige træk bevares (som #767's same-session-merge).
        await applySegmentHours(tx, {
          userId,
          orgId: ctx.orgId,
          entry: { ...current, hours: Number(current.hours) },
          newHours: plan.newHours,
          neverFail: true,
        });

        return segment;
      });
    }),

  // Update a segment
  updateSegment: protectedProcedure
    .input(
      z
        .object({
          id: z.string().uuid(),
          startTime: z.string().datetime({ offset: true }).optional(),
          endTime: z.string().datetime({ offset: true }).optional(),
          notes: z.string().optional(),
        })
        .refine(
          (data) => {
            if (data.startTime && data.endTime) {
              return new Date(data.endTime) > new Date(data.startTime);
            }
            return true;
          },
          {
            error: () => st("zod.endAfterStart"),
            path: ["endTime"],
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get the segment
      const segment = await ctx.db.query.timeEntrySegments.findFirst({
        where: eq(timeEntrySegments.id, input.id),
      });

      if (!segment) {
        throw notFound("Segment");
      }

      // Verify ownership through the parent time entry (kun ejer må røre
      // andres, som createSegment og de øvrige tid-mutationer).
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const parentEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, segment.timeEntryId), ownershipFilter),
      });
      if (!parentEntry) {
        throw forbidden();
      }
      assertEntryNotBilled(parentEntry);
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: parentEntry.userId,
        actorUserId: userId,
        dates: [parentEntry.date],
        entries: [parentEntry],
      });

      const updateData: {
        startTime?: Date;
        endTime?: Date;
        durationMinutes?: number;
        notes?: string | null;
      } = {};

      // Calculate new times
      const newStartTime = input.startTime
        ? new Date(input.startTime)
        : segment.startTime;
      const newEndTime = input.endTime
        ? new Date(input.endTime)
        : segment.endTime;

      if (input.startTime) {
        updateData.startTime = newStartTime;
      }
      if (input.endTime) {
        updateData.endTime = newEndTime;
      }
      if (input.notes !== undefined) {
        updateData.notes = input.notes || null;
      }

      // Recalculate duration if times changed
      if (input.startTime || input.endTime) {
        updateData.durationMinutes = Math.round(
          (newEndTime.getTime() - newStartTime.getTime()) / (1000 * 60),
        );
      }

      return ctx.db.transaction(async (tx) => {
        const [updatedSegment] = await tx
          .update(timeEntrySegments)
          .set(updateData)
          .where(eq(timeEntrySegments.id, input.id))
          .returning();

        // Update parent time entry's hours (+ klippekort-afstemning)
        const allSegments = await tx.query.timeEntrySegments.findMany({
          where: eq(timeEntrySegments.timeEntryId, segment.timeEntryId),
        });

        const totalMinutes = allSegments.reduce(
          (sum, seg) => sum + seg.durationMinutes,
          0,
        );

        await applySegmentHours(tx, {
          userId,
          orgId: ctx.orgId,
          entry: { ...parentEntry, hours: Number(parentEntry.hours) },
          newHours: totalMinutes / 60,
        });

        return updatedSegment;
      });
    }),

  // Delete a segment
  deleteSegment: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get the segment
      const segment = await ctx.db.query.timeEntrySegments.findFirst({
        where: eq(timeEntrySegments.id, input.id),
      });

      if (!segment) {
        throw notFound("Segment");
      }

      // Verify ownership through the parent time entry (kun ejer må røre
      // andres, som createSegment og de øvrige tid-mutationer).
      const ownershipFilter = await resolveTimeOwnershipFilter(
        ctx.db,
        ctx.orgId,
        userId,
      );
      const parentEntry = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, segment.timeEntryId), ownershipFilter),
      });
      if (!parentEntry) {
        throw forbidden();
      }
      assertEntryNotBilled(parentEntry);
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId: parentEntry.userId,
        actorUserId: userId,
        dates: [parentEntry.date],
        entries: [parentEntry],
      });

      const timeEntryId = segment.timeEntryId;

      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(timeEntrySegments)
          .where(eq(timeEntrySegments.id, input.id));

        // Update parent time entry's hours (+ klippekort-afstemning)
        const remainingSegments = await tx.query.timeEntrySegments.findMany({
          where: eq(timeEntrySegments.timeEntryId, timeEntryId),
        });

        if (remainingSegments.length > 0) {
          const totalMinutes = remainingSegments.reduce(
            (sum, seg) => sum + seg.durationMinutes,
            0,
          );
          await applySegmentHours(tx, {
            userId,
            orgId: ctx.orgId,
            entry: { ...parentEntry, hours: Number(parentEntry.hours) },
            newHours: totalMinutes / 60,
          });
        }
      });

      return { success: true };
    }),

  // Get profitability stats for the "Reel timepris" dashboard widget.
  // Returns agreed rate (weighted avg via rate hierarchy), billable avg
  // (invoiced / billable hrs), and real rate (invoiced / all hrs) for the period.
  getProfitability: protectedProcedure
    .input(
      z.object({
        from: z.date().optional(),
        to: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)

      const from = input.from ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const to =
        input.to ??
        new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // Fetch time entries and rate cache in parallel
      const [entries, rateCache, user] = await Promise.all([
        ctx.db.query.timeEntries.findMany({
          where: and(
            // Personal dashboard widget — the caller's own profitability.
            eq(timeEntries.userId, userId),
            gte(timeEntries.date, from),
            lte(timeEntries.date, to),
          ),
          columns: {
            hours: true,
            isBillable: true,
            billableRate: true,
            projectId: true,
            clientId: true,
            date: true,
          },
        }),
        buildRateLookupCache(ctx.db, userId, ctx.orgId),
        ctx.db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { defaultHourlyRate: true },
        }),
      ]);

      // Fetch invoices issued in the period for this user/org
      const periodInvoices = await ctx.db.query.invoices.findMany({
        where: and(
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
          gte(invoices.issueDate, from),
          lte(invoices.issueDate, to),
        ),
        columns: { amount: true },
      });

      const invoicedAmount = periodInvoices.reduce(
        (sum, inv) => sum + (Number.parseFloat(inv.amount) || 0),
        0,
      );

      // Build entries with pre-resolved rates (avoids N+1)
      const entriesForCalc = entries.map((entry) => {
        // Prefer stored billableRate if present (snapshot at time of entry)
        const rate = entry.billableRate
          ? Number.parseFloat(entry.billableRate)
          : (() => {
              const cached = getRateFromCache(
                rateCache,
                entry.projectId,
                entry.clientId,
                entry.date,
              );
              return cached ? Number.parseFloat(cached) : null;
            })();

        return {
          hours: entry.hours ?? "0",
          isBillable: entry.isBillable ?? true,
          resolvedRate: rate,
        };
      });

      const fallbackRate = user?.defaultHourlyRate
        ? Number.parseFloat(user.defaultHourlyRate)
        : null;

      const { computeProfitability } = await import(
        "@/lib/profitability/calculate"
      );

      const result = computeProfitability(
        { entries: entriesForCalc, invoicedAmount },
        fallbackRate,
      );

      return {
        ...result,
        period: { from, to },
      };
    }),

  // Get rounding bonus stats for the dashboard widget.
  // Computes the delta between actual tracked hours and rounded hours,
  // converted to revenue using the rate hierarchy, for this month and this year.
  getRoundingBonus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)

    // Date ranges
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Fetch time entries for this year (covers both month and year ranges)
    const entries = await ctx.db.query.timeEntries.findMany({
      where: and(
        ctx.orgId
          ? eq(timeEntries.organizationId, ctx.orgId)
          : eq(timeEntries.userId, userId),
        gte(timeEntries.date, yearStart),
        eq(timeEntries.isBillable, true),
        eq(timeEntries.isPrepaid, false),
      ),
      columns: {
        hours: true,
        billableRate: true,
        date: true,
        projectId: true,
        clientId: true,
      },
      with: {
        project: {
          columns: {
            id: true,
            roundingEnabled: true,
            roundingMinutes: true,
            roundingMethod: true,
          },
          with: {
            client: {
              columns: {
                id: true,
                roundingEnabled: true,
                roundingMinutes: true,
                roundingMethod: true,
              },
            },
          },
        },
        client: {
          columns: {
            id: true,
            roundingEnabled: true,
            roundingMinutes: true,
            roundingMethod: true,
          },
        },
      },
    });

    // Fetch user rounding settings and rate
    const userRow = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        roundingEnabled: true,
        roundingMinutes: true,
        roundingMethod: true,
        defaultHourlyRate: true,
      },
    });

    const userRounding = {
      roundingEnabled: userRow?.roundingEnabled ?? null,
      roundingMinutes: userRow?.roundingMinutes ?? null,
      roundingMethod: userRow?.roundingMethod ?? null,
    };

    const nullRounding = {
      roundingEnabled: null as null,
      roundingMinutes: null as null,
      roundingMethod: null as null,
    };

    // Build rate cache for revenue calculation
    const rateCache = await buildRateLookupCache(ctx.db, userId, ctx.orgId);

    let thisMonthBonus = 0;
    let thisYearBonus = 0;
    let hasRoundingActive = false;

    for (const entry of entries) {
      const clientRounding =
        entry.client ?? entry.project?.client ?? nullRounding;
      const projectRounding = entry.project ?? nullRounding;

      const config = resolveRoundingConfig(
        userRounding,
        clientRounding,
        projectRounding,
      );

      // Check if rounding is active for at least one entry
      if (config?.enabled) {
        hasRoundingActive = true;
      }

      const actualHours = Number.parseFloat(entry.hours);
      const roundedHours = roundHours(actualHours, config);
      const deltaHours = roundedHours - actualHours;

      if (deltaHours === 0) continue;

      const rate = getRateFromCache(
        rateCache,
        entry.projectId,
        entry.clientId,
        entry.date,
      );
      if (!rate) continue;

      const deltaRevenue = deltaHours * Number.parseFloat(rate);

      // Accumulate for year total
      thisYearBonus += deltaRevenue;

      // Accumulate for month total if entry is in current month
      if (entry.date >= monthStart) {
        thisMonthBonus += deltaRevenue;
      }
    }

    return {
      thisMonth: Math.round(thisMonthBonus),
      thisYear: Math.round(thisYearBonus),
      hasRoundingActive,
    };
  }),
});
