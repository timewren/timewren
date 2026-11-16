import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  isNull,
  lt,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import {
  type Client as AIClient,
  type Project as AIProject,
  categorizeTask,
  isAIEnabled,
} from "@/lib/ai";
import { getAppUrl } from "@/lib/config";
import {
  clients,
  extensionTokens,
  generatedTimeEntries,
  members,
  organizations,
  prepaidPackages,
  projects,
  tasks,
  timeEntries,
  timerStates,
} from "@/lib/db/schema";
import { scopeClientEntryId } from "@/lib/desktop-sync";
import { recordDeletionTombstones } from "@/lib/desktop-sync-tombstones";
import { assertEntriesOutsideClosedPeriods } from "@/lib/enterprise/period-closing-lock";
import {
  generateExtensionToken,
  pickExtensionOrgId,
} from "@/lib/extension-auth";
import { sendNotification } from "@/lib/notifications";
import { assertPeriodUnlocked } from "@/lib/org/period-lock";
import { findAutoDeductPackageForClient } from "@/lib/prepaid/auto-select.server";
import {
  lookupProjectClientId,
  reconcilePrepaidAfterEdit,
  refundPrepaidForDeletion,
} from "@/lib/prepaid/entry-sync";
import { prepaidExpiredBefore } from "@/lib/prepaid/expiry";
import { TIME_ENTRY_DOMAINS } from "@/lib/query/invalidate-domains";
import { publishDataChanged, publishTimerEvent } from "@/lib/realtime";
import { hashToken, tokenLookup } from "@/lib/security/token-hash";
import { trackEvent } from "@/lib/telemetry/track";
import {
  assertBilledPatchAllowed,
  assertEntryNotBilled,
  isBilledLocked,
} from "@/lib/time/billed-lock";
import {
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
  entryDateFromStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import { isDateOnlyString } from "@/lib/time/date-bounds";
import { toUtcSql } from "@/lib/time/db-timestamp";
import { resolveDefaultBillable } from "@/lib/time/default-billable";
import { entryDateStrInput } from "@/lib/time/entry-date-input";
import { mergeIntoSameSessionEntry } from "@/lib/time/same-session-merge";
import { entryDateForStart } from "@/lib/timer/entry-date";
import {
  classifyTimerWrite,
  logTimerEvent,
  timerEventOrigin,
} from "@/lib/timer/events";
import { claimIdleStamp, stampIdle } from "@/lib/timer/idle-claim";
import {
  CLEARED_PREPAID_CHOICE,
  prepaidChoiceReturning,
  readReturnedPrepaidChoice,
  readTimerPrepaidChoice,
  setTimerPrepaidChoice,
  timerPrepaidChoiceInputSchema,
  writeResetsPrepaidChoice,
} from "@/lib/timer/prepaid-choice";
import {
  clearedRowSql,
  noResurrectionGuardSql,
} from "@/lib/timer/resurrection";
import {
  closeActiveSessions,
  currentSessionNotSavedSql,
  currentSessionSavedSql,
  findLegacySavedEntry,
  findOwnSession,
  findSessionByStartOp,
  newSessionId,
  recordSession,
  SESSION_MISMATCH,
  SessionAlreadySavedError,
  saveSessionEntry,
  sessionIdInsertValue,
  sessionIdSetSql,
  sessionMatchSql,
  sessionStartFromRow,
  sessionStatusForRow,
  timerSyncSessionMode,
} from "@/lib/timer/sessions";
import { cancelStop, claimStop, confirmStop } from "@/lib/timer/stop-protocol";
import { isCrossClientTimerConflict } from "@/lib/timer-conflict";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { protectedProcedure, publicProcedure, router } from "../trpc";
import { assertClientAccess } from "./clientAccess";
import { tokenProcedure } from "./ext/bearer-token";
import { deductHoursCore } from "./prepaid";

// Helper to match URL against a pattern
function matchUrlPattern(url: string, pattern: string): boolean {
  // Convert pattern to regex
  // Support wildcards: * matches anything, ? matches single char
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars except * and ?
    .replace(/\*/g, ".*") // * becomes .*
    .replace(/\?/g, "."); // ? becomes .

  try {
    const regex = new RegExp(`^${regexPattern}$`, "i");
    return regex.test(url);
  } catch {
    return false;
  }
}

/**
 * Build the where-clause for an active extension token.
 *
 * Active = matches the bearer token, is not revoked, AND either has no
 * expiration set (long-lived by design) or expiresAt is in the future.
 * Previously several procedures only checked isRevoked and ignored
 * expiresAt, so a token that had been rotated and had an expiry set
 * would still work. Centralizing the filter in one helper means every
 * procedure gets consistent semantics for free.
 */
export function activeTokenWhere(token: string) {
  return and(
    tokenLookup(extensionTokens.tokenHash, token),
    eq(extensionTokens.isRevoked, false),
    or(
      isNull(extensionTokens.expiresAt),
      gt(extensionTokens.expiresAt, new Date()),
    ),
  );
}

/** Brugeren bag et aktivt extension-token — ellers UNAUTHORIZED. */
async function requireExtensionUser(
  database: typeof import("@/lib/db").db,
  token: string,
): Promise<string> {
  const tokenRecord = await database.query.extensionTokens.findFirst({
    where: activeTokenWhere(token),
    columns: { userId: true },
  });
  if (!tokenRecord) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: await tr("serverErrors", "ext.invalidToken"),
    });
  }
  return tokenRecord.userId;
}

/**
 * Resolve the org an extension request is scoped to. Honors a per-request
 * `requestedOrgId` if the user is a member; otherwise falls back to the
 * primary org (owner-preferred), matching getExtensionUserOrgId.
 */
async function resolveExtensionOrg(
  database: typeof import("@/lib/db").db,
  userId: string,
  requestedOrgId?: string | null,
): Promise<string | null> {
  const memberships = await database.query.members.findMany({
    where: eq(members.userId, userId),
    columns: { organizationId: true, role: true },
  });
  const memberOrgIds = memberships.map((m) => m.organizationId);
  const primaryOrgId =
    memberships.find((m) => m.role === "owner")?.organizationId ??
    memberships[0]?.organizationId ??
    null;
  return pickExtensionOrgId(requestedOrgId, memberOrgIds, primaryOrgId);
}

/**
 * Per-token write rate limit. Call after the token has been validated (keyed on
 * the token's DB id, never the secret) and before any DB write, so a leaked
 * extension token cannot flood the database with entries/tasks/timer updates.
 */
export async function enforceExtensionWriteLimit(
  tokenId: string,
): Promise<void> {
  const result = await rateLimiter.check(
    `ext:write:${tokenId}`,
    "extensionWrite",
  );
  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: await tr("serverErrors", "common.rateLimited", {
        seconds: Math.ceil(result.resetIn / 1000),
      }),
    });
  }
}

/** Tilstandssvaret fra updateTimerState (også ved en afvist skrivning). */
function extensionTimerStateResponse(
  state:
    | {
        isRunning: boolean | null;
        startTime: Date | null;
        elapsedSeconds: number | null;
        baseSeconds: number | null;
        projectId: string | null;
        clientId: string | null;
        taskId?: string | null;
        description: string | null;
        project: { id: string; name: string } | null;
        client: { id: string; name: string } | null;
        lastSyncedAt: Date | null;
        version: number;
        currentSessionId: string | null;
        intent?: string | null;
      }
    | undefined,
) {
  return {
    isRunning: state?.isRunning ?? false,
    startTime: state?.startTime?.toISOString() ?? null,
    elapsedSeconds: state?.elapsedSeconds ?? 0,
    baseSeconds: state?.baseSeconds ?? 0,
    projectId: state?.projectId ?? null,
    clientId: state?.clientId ?? null,
    taskId: state?.taskId ?? null,
    description: state?.description ?? "",
    project: state?.project ?? null,
    client: state?.client ?? null,
    lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
    version: state?.version ?? 0,
    // Server-udstedt session (timer-sessioner, fase 1)
    sessionId: state?.currentSessionId ?? null,
    // Midt i et stop (extension 2.6.0 viser rækken som stoppende)
    intent: state?.intent ?? null,
  };
}

/**
 * Et stop-claim ældre end dette uden confirm regnes for forladt — samme
 * grænse som timerSync (review P2-1).
 */
const ABANDONED_STOP_MS = 60_000;

/** Hele sætningen om en allerede kørende timer (web eller en anden enhed, med/uden projekt). */
async function timerConflictMessage(
  projectName: string | undefined,
  lastSyncedFrom: string | null,
): Promise<string> {
  const place = lastSyncedFrom === "web" ? "Web" : "Other";
  return tr(
    "serverErrors",
    `extension.timerRunning${projectName ? "Project" : "Any"}${place}`,
    { project: projectName ?? "" },
  );
}

export const extensionRouter = router({
  // Generate a new extension token (requires web auth)
  generateToken: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const token = generateExtensionToken();

      // Kun hashen gemmes (#713) — tokenet vises én gang herunder.
      await ctx.db.insert(extensionTokens).values({
        userId,
        tokenHash: hashToken(token),
        name: input.name,
      });

      // Return the token - this is the ONLY time it will be shown
      return { token };
    }),

  // List all active tokens for the current user
  listTokens: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const tokens = await ctx.db.query.extensionTokens.findMany({
      where: and(
        eq(extensionTokens.userId, userId),
        eq(extensionTokens.isRevoked, false),
      ),
      columns: {
        id: true,
        name: true,
        lastUsedAt: true,
        lastUsedIp: true,
        usageCount: true,
        createdAt: true,
        expiresAt: true,
        // Enheds-login (desktop 1.0): vises i listen, så enheden kan genkendes
        deviceName: true,
        deviceOs: true,
        clientKind: true,
      },
      orderBy: (tokens, { desc }) => [desc(tokens.createdAt)],
    });

    return tokens;
  }),

  // Revoke a token
  revokeToken: protectedProcedure
    .input(
      z.object({
        tokenId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify the token belongs to this user
      const token = await ctx.db.query.extensionTokens.findFirst({
        where: and(
          eq(extensionTokens.id, input.tokenId),
          eq(extensionTokens.userId, userId),
        ),
      });

      if (!token) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "ext.tokenNotFound"),
        });
      }

      await ctx.db
        .update(extensionTokens)
        .set({
          isRevoked: true,
          revokedAt: new Date(),
        })
        .where(eq(extensionTokens.id, input.tokenId));

      return { success: true };
    }),

  // Validate token (public - used by extension to verify token and get user info)
  validateToken: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Rate limit to prevent brute-force token guessing
      const ip = ctx.headers ? getClientIp(ctx.headers) : "unknown";
      const rateLimitKey = ipRateLimitKey(ip, "extension.validateToken");
      const rateLimitResult = await rateLimiter.check(
        rateLimitKey,
        "extensionToken",
      );
      if (!rateLimitResult.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: await tr("serverErrors", "common.rateLimited", {
            seconds: Math.ceil(rateLimitResult.resetIn / 1000),
          }),
        });
      }

      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!tokenRecord) {
        return { valid: false, user: null };
      }

      // Check expiration
      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        return { valid: false, user: null };
      }

      return {
        valid: true,
        user: tokenRecord.user,
      };
    }),

  // List the organizations the token owner belongs to (for the extension's
  // org switcher). Public — extension uses token auth.
  listOrganizations: tokenProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });
      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      const rows = await ctx.db
        .select({
          id: organizations.id,
          name: organizations.name,
          role: members.role,
        })
        .from(members)
        .innerJoin(organizations, eq(members.organizationId, organizations.id))
        .where(eq(members.userId, tokenRecord.userId))
        .orderBy(organizations.name);

      return rows;
    }),

  // Get timer state for the current user (public - extension uses token auth)
  getTimerState: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token and get user
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      // Check expiration
      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: (tokenRecord.usageCount || 0) + 1,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      // Get timer state
      const timerState = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, tokenRecord.userId),
        with: {
          project: {
            columns: {
              id: true,
              name: true,
              clientId: true,
            },
          },
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!timerState) {
        return {
          isRunning: false,
          startTime: null,
          elapsedSeconds: 0,
          baseSeconds: 0,
          projectId: null,
          clientId: null,
          description: "",
          project: null,
          client: null,
          lastSyncedAt: null,
          prepaidChoice: null,
          sessionId: null as string | null,
        };
      }

      return {
        isRunning: timerState.isRunning,
        startTime: timerState.startTime?.toISOString() || null,
        elapsedSeconds: timerState.elapsedSeconds,
        baseSeconds: timerState.baseSeconds,
        projectId: timerState.projectId,
        clientId: timerState.clientId,
        description: timerState.description || "",
        project: timerState.project,
        client: timerState.client,
        lastSyncedAt: timerState.lastSyncedAt?.toISOString() || null,
        // Klippekort-valg for den kørende timer (#422); null = automatisk
        prepaidChoice: readTimerPrepaidChoice(timerState),
        sessionId: timerState.currentSessionId ?? null,
        sessionStartedAt: timerState.currentSessionId
          ? ((
              await findOwnSession(
                ctx.db,
                tokenRecord.userId,
                timerState.currentSessionId,
              )
            )?.startedAt.toISOString() ?? null)
          : null,
      };
    }),

  // Update timer state (public - extension uses token auth)
  // Supports partial updates - only provided fields will be updated
  updateTimerState: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        isRunning: z.boolean().optional(),
        startTime: z.string().nullable().optional(),
        elapsedSeconds: z.number().int().min(0).optional(),
        baseSeconds: z.number().int().min(0).optional(),
        projectId: z.string().uuid().nullable().optional(),
        clientId: z.string().uuid().nullable().optional(),
        // Opgaven på timeren (desktop 0.2.23). Udeladt = uændret; en frisk
        // start uden taskId starter uden opgave.
        taskId: z.string().uuid().nullable().optional(),
        description: z.string().optional(),
        source: z.enum(["web", "extension", "mobile"]).default("extension"),
        // True only on the user's explicit "start a fresh timer" action. Kept
        // for wire-compat with older extension versions; the one-running-timer
        // guard below now applies to EVERY write that sets isRunning=true.
        isFreshStart: z.boolean().optional().default(false),
        // Optimistisk lås for skrivninger der bygger på en FORUDGÅENDE
        // læsning (fx idle-auto-pausen, der beregner elapsed ud fra rækken).
        // Er rækken ændret imellem — et quick-add, en pause fra web — matcher
        // guarden ikke, og skrivningen droppes i stedet for at overskrive.
        expectedVersion: z.number().int().optional(),
        // Server-udstedt session (timer-sessioner): skrivningen lander kun på
        // netop den session; ellers returneres serverens tilstand med
        // `sessionMismatch: true`.
        sessionId: z.string().uuid().optional(),
        // Idempotensnøgle på en frisk start (extension 2.6.0, #784): starten
        // lander kun på en ryddet række, og samme nøgle er samme start. En
        // afvist start returnerer serverens tilstand med `startRejected`.
        clientOpId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate token and get user
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      // Check expiration
      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: (tokenRecord.usageCount || 0) + 1,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      await enforceExtensionWriteLimit(tokenRecord.id);

      // Get existing timer state (needed for partial-update merges and the
      // fresh-start guard below) — fetched once, with relations.
      const existing = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
        with: {
          project: {
            columns: { id: true, name: true },
          },
          client: {
            columns: { id: true, name: true },
          },
        },
      });

      // Only ONE running timer per user across all clients. Reject ANY write
      // that would set isRunning=true (fresh start OR resume) while a
      // *different* client (e.g. the web app) already has a timer running, so
      // we don't end up logging time on two projects at once. Same-source
      // resumes are allowed; the blocked user is told to stop the running
      // timer first. This pre-check gives the rich error message; the upsert
      // below re-enforces the rule atomically to close the read-then-write
      // race where two clients start at the same moment.
      // Hændelseslog (A6): skrives efter hver afgørelse, aldrig i en guard.
      const eventBase = {
        userId,
        organizationId: orgId,
        ...timerEventOrigin(ctx.headers, input.source),
        startTime: input.startTime ? new Date(input.startTime) : null,
        baseSeconds: input.baseSeconds ?? null,
        projectId: input.projectId ?? null,
        clientId: input.clientId ?? null,
      };
      const writeKind =
        input.isRunning === true
          ? input.isFreshStart
            ? "fresh_start"
            : "running_write"
          : input.isRunning === false
            ? (input.elapsedSeconds ?? 0) > 0 || (input.baseSeconds ?? 0) > 0
              ? "pause"
              : "clear"
            : "metadata";

      // Extension 2.6.0 (#784): en frisk start bærer en idempotensnøgle. En
      // start med samme nøgle, der allerede er landet (tabt svar,
      // dobbeltklik), er én effekt: intet skrives, og serverens tilstand
      // returneres, så extensionen adopterer den.
      const isOpStart =
        input.isRunning === true && input.isFreshStart && !!input.clientOpId;
      if (isOpStart && input.clientOpId) {
        const opSession = await findSessionByStartOp(
          ctx.db,
          userId,
          input.clientOpId,
        );
        if (opSession || existing?.lastClientOpId === input.clientOpId) {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: "start_deduplicated",
            versionAfter: existing?.version ?? null,
            detail: {
              kind: writeKind,
              clientOpId: input.clientOpId,
              sessionId: opSession?.id,
            },
          });
          return {
            ...extensionTimerStateResponse(existing),
            sessionMismatch: false,
            deduplicated: true,
          };
        }
      }

      if (
        input.isRunning === true &&
        isCrossClientTimerConflict(existing, input.source)
      ) {
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: "blocked_other_owner",
          versionAfter: existing?.version ?? null,
          detail: {
            kind: writeKind,
            runningFrom: existing?.lastSyncedFrom ?? null,
            stage: "precheck",
          },
        });
        const where = existing?.lastSyncedFrom ?? null;
        const projectName = existing?.project?.name;
        throw new TRPCError({
          code: "CONFLICT",
          message: await timerConflictMessage(projectName, where),
        });
      }

      // Verify project/client belong to this user before writing them onto
      // the timer state — otherwise an authenticated extension token could
      // pollute its own timer state with another tenant's projectId/clientId,
      // which would then be copied into a timeEntry on quickStop.
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            orgId
              ? eq(projects.organizationId, orgId)
              : eq(projects.userId, userId),
          ),
          columns: { id: true },
        });
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.projectNotFound"),
          });
        }
      }
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            orgId
              ? eq(clients.organizationId, orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.clientNotFound"),
          });
        }
      }
      if (input.taskId) {
        const task = await ctx.db.query.tasks.findFirst({
          where: and(
            eq(tasks.id, input.taskId),
            orgId ? eq(tasks.organizationId, orgId) : eq(tasks.userId, userId),
          ),
          columns: { id: true },
        });
        if (!task) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.taskNotFound"),
          });
        }
      }

      // Build timer data - merge with existing state for partial updates
      const now = new Date();
      const timerData: Record<string, unknown> = {
        lastSyncedAt: now,
        updatedAt: now,
      };

      // Only update fields that are explicitly provided
      if (input.isRunning !== undefined) {
        timerData.isRunning = input.isRunning;
        // Ownership (lastSyncedFrom) only changes when a client changes the
        // run-state. Metadata edits (description/project) must not "steal" a
        // running timer from the other client — that would make the owner's
        // next legitimate write look like a cross-client conflict.
        timerData.lastSyncedFrom = input.source;
      }
      if (isOpStart) timerData.lastClientOpId = input.clientOpId;
      if (input.isRunning === true) {
        // A start/resume invalidates any lingering stop intent. Without this,
        // a queued confirmStop replay (whose version keeps getting refreshed
        // via version_mismatch) or the cleanup cron could later match the NEW
        // session and destroy it — the intent must die with the old session.
        timerData.intent = null;
        timerData.intentAt = null;
        timerData.intentFrom = null;
      }
      if (input.startTime !== undefined) {
        timerData.startTime = input.startTime
          ? new Date(input.startTime)
          : null;
      }
      if (input.elapsedSeconds !== undefined) {
        timerData.elapsedSeconds = input.elapsedSeconds;
      }
      if (input.baseSeconds !== undefined) {
        timerData.baseSeconds = input.baseSeconds;
      }
      if (input.projectId !== undefined) {
        timerData.projectId = input.projectId;
      }
      if (input.clientId !== undefined) {
        timerData.clientId = input.clientId;
      }
      if (input.taskId !== undefined) {
        timerData.taskId = input.taskId;
      } else if (writeResetsPrepaidChoice(input)) {
        // En ny session (eller en fuld nulstilling) arver aldrig den forrige
        // sessions opgave — samme regel som klippekort-valget.
        timerData.taskId = null;
      }
      if (input.description !== undefined) {
        timerData.description = input.description;
      }
      // Klippekort-valget (#422) hører til sessionen: en frisk start og en
      // fuld nulstilling starter forfra på automatisk. Et valg truffet før
      // starten sender extensionen igen bagefter (setPrepaidChoice).
      if (writeResetsPrepaidChoice(input)) {
        Object.assign(timerData, CLEARED_PREPAID_CHOICE);
      }

      // Every write bumps `version` — the clients' remote-change detection
      // (web's reconcile mirror, claim expectedVersion) keys off it, so a
      // pause/resume/metadata write that leaves version unchanged makes other
      // clients silently miss the change.
      timerData.version = sql`${timerStates.version} + 1`;

      // Atomic upsert. When this write would set isRunning=true, the
      // `setWhere` guard only lets it through if no *other* client currently
      // owns a running timer — closing the race where web and extension start
      // at the same moment and both pass the pre-check above.
      const guard = sql`NOT (COALESCE(${timerStates.isRunning}, false) AND ${timerStates.lastSyncedFrom} IS NOT NULL AND ${timerStates.lastSyncedFrom} <> ${input.source})`;
      // A pause-class write (isRunning=false carrying time) must not revive a
      // fully CLEARED row: a late idle-pause/pause landing after a stop+save on
      // another client would re-materialize already-saved time, which a later
      // manual save double-counts.
      const isPauseWrite =
        input.isRunning === false &&
        ((input.elapsedSeconds ?? 0) > 0 || (input.baseSeconds ?? 0) > 0);
      const notClearedGuard = sql`(COALESCE(${timerStates.isRunning}, false) OR COALESCE(${timerStates.elapsedSeconds}, 0) > 0 OR COALESCE(${timerStates.baseSeconds}, 0) > 0)`;
      // GENOPSTANDELSE (kunde A 1/10): en kørende skrivning må ikke genoplive
      // en RYDDET række (stoppet+gemt et andet sted). Et genoptag (ikke fresh
      // start — idle-genoptag, popup-genoptag, offline-afspilning) har intet
      // at genoptage på en ryddet række; en fresh start skal have en starttid
      // fra efter rydningen. Se lib/timer/resurrection.ts.
      // Extension 2.6.0 (#784 K2): en start med nøgle lander kun på en række
      // uden aktiv session — heller ikke oven i en anden extension-instans'
      // timer (samme kilde) eller en pauset session med tid. Undtaget: en
      // række hvis session allerede er gemt (dens tid ligger i posten),
      // herunder et forladt stop af en gemt session (P2-1).
      const abandonedSavedStopSql = sql`(${timerStates.intent} = 'stopping' AND ${timerStates.intentAt} < ${toUtcSql(new Date(Date.now() - ABANDONED_STOP_MS))}::timestamp AND ${currentSessionSavedSql()})`;
      const opStartGuard = sql`(((NOT COALESCE(${timerStates.isRunning}, false) AND (${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping') AND ((COALESCE(${timerStates.elapsedSeconds}, 0) = 0 AND COALESCE(${timerStates.baseSeconds}, 0) = 0) OR ${currentSessionSavedSql()})) OR ${abandonedSavedStopSql}) AND ${timerStates.lastClientOpId} IS DISTINCT FROM ${input.clientOpId ?? null})`;
      const runningGuard = isOpStart
        ? sql`(${opStartGuard}) AND (${noResurrectionGuardSql()})`
        : input.isFreshStart
          ? sql`(${guard}) AND (${noResurrectionGuardSql()})`
          : sql`(${guard}) AND NOT ${clearedRowSql()}`;
      // #787 K6: et kundeskift (metadata) må ikke lande midt i et stop fra en
      // ANDEN kilde — så ville sessionen sidst stå på én kunde, mens stoppet
      // gemmer en anden. Den blokerede skrivning returnerer serverens
      // tilstand, som extensionen spejler.
      const isMetadataWrite = input.isRunning === undefined;
      const notStoppingElsewhereGuard = sql`(${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping' OR ${timerStates.intentFrom} = ${input.source})`;

      // Timer-sessioner (fase 1): sessionsskiftet og evt. klientens session
      // som prædikat — i SAMME upsert. Metadata rører ikke sessionen.
      const sessionMode = isMetadataWrite
        ? null
        : timerSyncSessionMode({
            isRunning: input.isRunning === true,
            isPauseWrite,
            isQueuedStart: isOpStart,
            isFreshStart: input.isFreshStart,
            isAdoption: false,
            baseSeconds: input.baseSeconds ?? 0,
            hasSessionId: !!input.sessionId,
          });
      const candidateSessionId = newSessionId();
      if (sessionMode) {
        timerData.currentSessionId = sessionIdSetSql(
          sessionMode,
          candidateSessionId,
        );
      }
      // En sessionsbevidst skrivning (2.6.0) lander heller ikke midt i et
      // stop af sessionen — heller ikke fra samme kilde (en anden
      // extension-instans): så ville sessionen sidst stå på én kunde, mens
      // stoppet gemmer en anden (#787 K6, extension-udgaven).
      const sessionPredicate = input.sessionId
        ? sessionMode === "clear"
          ? sql`(${timerStates.currentSessionId} IS NULL OR ${sessionMatchSql(input.sessionId)})`
          : sql`${sessionMatchSql(input.sessionId)} AND (${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')`
        : null;
      const upsertGuard = (() => {
        const base =
          input.isRunning === true
            ? runningGuard
            : isPauseWrite
              ? notClearedGuard
              : isMetadataWrite
                ? notStoppingElsewhereGuard
                : null;
        const versionGuard =
          input.expectedVersion !== undefined
            ? sql`${timerStates.version} = ${input.expectedVersion}`
            : null;
        // Review P1/P2-4: en skrivning uden sessionId (extension 2.5.x) lander
        // aldrig på en session der allerede er gemt — et genoptag mellem post
        // og confirm ville ellers genoplive den gemte tid.
        const notSavedGuard =
          !input.sessionId && sessionMode !== "clear" && !isOpStart
            ? currentSessionNotSavedSql()
            : null;
        const guards = [
          base,
          versionGuard,
          sessionPredicate,
          notSavedGuard,
        ].filter((g): g is SQL => g !== null);
        return guards.length > 0
          ? sql.join(
              guards.map((g) => sql`(${g})`),
              sql` AND `,
            )
          : null;
      })();

      const row = await ctx.db.transaction(async (tx) => {
        const [written] = await tx
          .insert(timerStates)
          .values({
            userId,
            isRunning: input.isRunning ?? false,
            startTime: input.startTime ? new Date(input.startTime) : null,
            elapsedSeconds: input.elapsedSeconds ?? 0,
            baseSeconds: input.baseSeconds ?? 0,
            projectId: input.projectId ?? null,
            clientId: input.clientId ?? null,
            taskId: input.taskId ?? null,
            description: input.description ?? "",
            lastSyncedAt: now,
            lastSyncedFrom: input.source,
            updatedAt: now,
            currentSessionId:
              sessionMode && input.isRunning
                ? sessionIdInsertValue(sessionMode, candidateSessionId)
                : null,
            lastClientOpId: isOpStart ? input.clientOpId : null,
            version: 1,
          })
          .onConflictDoUpdate({
            target: timerStates.userId,
            set: timerData,
            ...(upsertGuard ? { setWhere: upsertGuard } : {}),
          })
          .returning({
            id: timerStates.id,
            currentSessionId: timerStates.currentSessionId,
            isRunning: timerStates.isRunning,
            startTime: timerStates.startTime,
            baseSeconds: timerStates.baseSeconds,
            elapsedSeconds: timerStates.elapsedSeconds,
            intent: timerStates.intent,
            projectId: timerStates.projectId,
            clientId: timerStates.clientId,
            taskId: timerStates.taskId,
            description: timerStates.description,
          });
        if (!written) return written;
        const active =
          !!written.isRunning ||
          (written.elapsedSeconds ?? 0) > 0 ||
          (written.baseSeconds ?? 0) > 0;
        if (sessionMode === "clear" || (!active && !isMetadataWrite)) {
          await closeActiveSessions(tx, userId, "discarded");
        } else if (written.currentSessionId && active) {
          await recordSession(tx, {
            userId,
            organizationId: orgId,
            sessionId: written.currentSessionId,
            status: sessionStatusForRow(written),
            startedAt: sessionStartFromRow(written, now),
            projectId: written.projectId,
            clientId: written.clientId,
            taskId: written.taskId,
            description: written.description,
            source: eventBase.source,
            clientHint: eventBase.clientHint,
            startOpId: isOpStart ? input.clientOpId : null,
          });
        }
        return written;
      });

      if (!row && isOpStart) {
        // Klassificér den afviste start (læsning EFTER den atomiske
        // skrivning). Svaret er serverens tilstand — extensionen adopterer
        // den i stedet for at overskrive en kørende session (#784 K2).
        const current = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          with: {
            project: { columns: { id: true, name: true } },
            client: { columns: { id: true, name: true } },
          },
        });
        const sameOp =
          !!current?.lastClientOpId &&
          current.lastClientOpId === input.clientOpId;
        const hasTime =
          (current?.baseSeconds ?? 0) > 0 || (current?.elapsedSeconds ?? 0) > 0;
        const startRejected = sameOp
          ? null
          : current?.isRunning || current?.intent === "stopping"
            ? ("already_running" as const)
            : hasTime
              ? ("paused_session" as const)
              : ("stale_start" as const);
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: sameOp
            ? "start_deduplicated"
            : current?.intent === "stopping"
              ? "blocked_stopping"
              : startRejected === "stale_start"
                ? "blocked_resurrection"
                : "blocked_other_owner",
          versionAfter: current?.version ?? null,
          detail: {
            kind: writeKind,
            clientOpId: input.clientOpId,
            reason: startRejected ?? undefined,
            runningFrom: current?.isRunning
              ? (current.lastSyncedFrom ?? null)
              : undefined,
          },
        });
        return {
          ...extensionTimerStateResponse(current),
          sessionMismatch: false,
          ...(sameOp ? { deduplicated: true } : { startRejected }),
        };
      }

      if (!row && input.sessionId) {
        // Klassificér (læsning efter den atomiske skrivning): en anden
        // session står på rækken → serverens tilstand tilbage, intet skrevet.
        const current = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          with: {
            project: { columns: { id: true, name: true } },
            client: { columns: { id: true, name: true } },
          },
        });
        if (
          current?.currentSessionId === input.sessionId &&
          current?.intent === "stopping" &&
          sessionMode !== "clear"
        ) {
          // Samme session, men midt i et stop: ikke en fejl — extensionen
          // viser rækken som stoppende og afstemmer.
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: "blocked_stopping",
            versionAfter: current.version,
            detail: {
              kind: writeKind,
              sessionId: input.sessionId,
              stoppedBy: current.intentFrom,
            },
          });
          return {
            ...extensionTimerStateResponse(current),
            sessionMismatch: false,
            stoppingInProgress: true,
          };
        }
        if (current?.currentSessionId !== input.sessionId) {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event:
              input.isRunning === true
                ? "heartbeat_rejected"
                : isMetadataWrite
                  ? "blocked_stopping"
                  : "pause_rejected",
            versionAfter: current?.version ?? null,
            detail: {
              kind: writeKind,
              reason: SESSION_MISMATCH,
              sessionId: input.sessionId,
              currentSessionId: current?.currentSessionId ?? null,
            },
          });
          return {
            ...extensionTimerStateResponse(current),
            sessionMismatch: true,
          };
        }
      }

      if (!row && input.expectedVersion !== undefined) {
        // Rækken er ændret siden læsningen — skrivningen bygger på forældede
        // tal og må ikke lande. Kalderen læser forfra og prøver igen.
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: "version_conflict",
          versionBefore: input.expectedVersion,
          // Med expectedVersion kan også en guard (andet-ejer/genopstandelse)
          // have afvist — begge giver CONFLICT til klienten.
          detail: { kind: writeKind, reason: "version_or_guard" },
        });
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr("serverErrors", "ext.timerChangedElsewhere"),
        });
      }

      // Blocked atomically. Re-read (classification only — the write is
      // already decided). A row that is not running means the resurrection
      // guard blocked a revive of a stopped/saved session: that is not an
      // error — fall through and return the actual (cleared) server state so
      // the extension reconciles (popup shows it stopped, an offline replay
      // counts as processed). Otherwise another client started a timer
      // between the pre-check and this write.
      const blockedRunning =
        !row && input.isRunning === true
          ? await ctx.db.query.timerStates.findFirst({
              where: eq(timerStates.userId, userId),
              with: {
                project: { columns: { id: true, name: true } },
              },
            })
          : undefined;
      if (!row) {
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event:
            input.isRunning === true
              ? blockedRunning?.isRunning
                ? "blocked_other_owner"
                : input.isFreshStart
                  ? "blocked_resurrection"
                  : "heartbeat_rejected"
              : isMetadataWrite
                ? "blocked_stopping"
                : "pause_rejected",
          versionAfter: blockedRunning?.version ?? null,
          detail: {
            kind: writeKind,
            reason:
              input.isRunning === true && !blockedRunning?.isRunning
                ? "cleared_row"
                : input.isRunning === true
                  ? "other_owner"
                  : isMetadataWrite
                    ? "stopping_elsewhere"
                    : "not_active",
            runningFrom: blockedRunning?.isRunning
              ? (blockedRunning.lastSyncedFrom ?? null)
              : undefined,
          },
        });
      }
      if (!row && input.isRunning === true && blockedRunning?.isRunning) {
        const running = blockedRunning;
        const where = running?.lastSyncedFrom ?? null;
        const projectName = running?.project?.name;
        throw new TRPCError({
          code: "CONFLICT",
          message: await timerConflictMessage(projectName, where),
        });
      }
      // A blocked pause (row already cleared by a stop elsewhere) is not an
      // error — fall through and return the actual (cleared) server state so
      // the extension reconciles instead of resurrecting saved time.

      // Fetch and return the updated state for the extension
      const updatedState = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
        with: {
          project: {
            columns: { id: true, name: true },
          },
          client: {
            columns: { id: true, name: true },
          },
        },
      });

      // Fan out over realtime so open web tabs react instantly to extension-
      // driven changes (start/pause/resume/metadata) instead of waiting for
      // their next poll. Only when the write actually landed.
      if (row && updatedState) {
        const successEvent = classifyTimerWrite(existing, updatedState);
        if (successEvent) {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: successEvent,
            versionBefore: existing?.version ?? null,
            versionAfter: updatedState.version,
            startTime: updatedState.startTime,
            baseSeconds: updatedState.baseSeconds,
            projectId: updatedState.projectId,
            clientId: updatedState.clientId,
            detail: {
              kind: writeKind,
              prevProjectId:
                successEvent === "client_change"
                  ? (existing?.projectId ?? null)
                  : undefined,
              prevClientId:
                successEvent === "client_change"
                  ? (existing?.clientId ?? null)
                  : undefined,
              prevStartTime:
                successEvent === "time_change"
                  ? (existing?.startTime?.toISOString() ?? null)
                  : undefined,
              prevBaseSeconds:
                successEvent === "time_change"
                  ? (existing?.baseSeconds ?? null)
                  : undefined,
            },
          });
        }
        await publishTimerEvent(userId, orgId, {
          userId,
          type: "sync",
          isRunning: updatedState.isRunning ?? false,
          projectId: updatedState.projectId,
          clientId: updatedState.clientId,
          taskId: updatedState.taskId,
          description: updatedState.description ?? "",
          version: updatedState.version,
        });
      }

      // Every write bumps the row version; without returning it the client's
      // cached version goes stale, and its next claimForStop fails with
      // version_mismatch — the timer then lives on server-side with the old
      // session and gets re-adopted with all its elapsed time.
      return {
        ...extensionTimerStateResponse(updatedState),
        sessionStartedAt: updatedState?.currentSessionId
          ? ((
              await findOwnSession(
                ctx.db,
                userId,
                updatedState.currentSessionId,
              )
            )?.startedAt.toISOString() ?? null)
          : null,
        sessionMismatch: false,
      };
    }),

  // Get timer state with version (for intent-based sync)
  getTimerStateWithVersion: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token and get user
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      // Get timer state
      const timerState = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, tokenRecord.userId),
        with: {
          project: {
            columns: { id: true, name: true, clientId: true },
          },
          client: {
            columns: { id: true, name: true },
          },
        },
      });

      if (!timerState) {
        return {
          isRunning: false,
          startTime: null,
          elapsedSeconds: 0,
          baseSeconds: 0,
          projectId: null,
          clientId: null,
          taskId: null as string | null,
          description: "",
          project: null,
          client: null,
          version: 0,
          intent: null,
          intentAt: null,
          intentFrom: null,
          prepaidChoice: null,
          sessionId: null as string | null,
        };
      }

      return {
        isRunning: timerState.isRunning,
        startTime: timerState.startTime?.toISOString() || null,
        elapsedSeconds: timerState.elapsedSeconds,
        baseSeconds: timerState.baseSeconds,
        projectId: timerState.projectId,
        clientId: timerState.clientId,
        taskId: timerState.taskId,
        description: timerState.description || "",
        project: timerState.project,
        client: timerState.client,
        version: timerState.version,
        intent: timerState.intent,
        // Hvornår stop-intentet blev sat — så klienter kan se et forældet
        // (forladt) stop i stedet for at vente på oprydnings-cron'en.
        intentAt: timerState.intentAt?.toISOString() ?? null,
        intentFrom: timerState.intentFrom,
        prepaidChoice: readTimerPrepaidChoice(timerState),
        // Server-udstedt session (timer-sessioner, fase 1)
        sessionId: timerState.currentSessionId ?? null,
        sessionStartedAt: timerState.currentSessionId
          ? ((
              await findOwnSession(
                ctx.db,
                tokenRecord.userId,
                timerState.currentSessionId,
              )
            )?.startedAt.toISOString() ?? null)
          : null,
      };
    }),

  // Klippekort-valg for den kørende timer (#422) — samme kontrakt som
  // timerSync.setPrepaidChoice. Svarer { success: false, reason:
  // "not_active" } når der ingen aktiv session er på kunden (fx valg truffet
  // før start); extensionen sender så valget igen efter starten.
  setPrepaidChoice: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        clientId: z.string().uuid(),
        choice: timerPrepaidChoiceInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });
      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }
      const userId = tokenRecord.userId;
      await enforceExtensionWriteLimit(tokenRecord.id);
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );
      return setTimerPrepaidChoice(ctx.db, {
        userId,
        orgId,
        clientId: input.clientId,
        choice: input.choice,
      });
    }),

  // Claim timer for stopping (atomic operation) — fælles stop-protokol
  // med timerSync (lib/timer/stop-protocol.ts).
  claimForStop: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        expectedVersion: z.number(),
        source: z.enum(["web", "extension"]),
        // Server-udstedt session (timer-sessioner): claimet lander kun på den.
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExtensionUser(ctx.db, input.token);
      const orgId = await resolveExtensionOrg(ctx.db, userId, null);
      return claimStop(ctx.db, {
        userId,
        orgId,
        headers: ctx.headers,
        source: input.source,
        expectedVersion: input.expectedVersion,
        sessionId: input.sessionId,
      });
    }),

  // Confirm stop (called after saving time entry)
  confirmStop: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        version: z.number(),
        source: z.enum(["web", "extension"]),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExtensionUser(ctx.db, input.token);
      const orgId = await resolveExtensionOrg(ctx.db, userId, null);
      return confirmStop(ctx.db, {
        userId,
        orgId,
        headers: ctx.headers,
        source: input.source,
        version: input.version,
        sessionId: input.sessionId,
      });
    }),

  // Cancel stop (resume from save modal). Afvises med `already_saved`, når
  // sessionen allerede er gemt (#783).
  cancelStop: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        version: z.number(),
        source: z.enum(["web", "extension"]),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExtensionUser(ctx.db, input.token);
      const orgId = await resolveExtensionOrg(ctx.db, userId, null);
      return cancelStop(ctx.db, {
        userId,
        orgId,
        headers: ctx.headers,
        source: input.source,
        version: input.version,
        sessionId: input.sessionId,
      });
    }),

  // Get projects and clients for extension dropdown (public - extension uses token auth)
  getProjectsAndClients: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Get active clients
      const clientsList = await ctx.db.query.clients.findMany({
        where: and(
          orgId
            ? eq(clients.organizationId, orgId)
            : eq(clients.userId, userId),
          eq(clients.isArchived, false),
        ),
        columns: {
          id: true,
          name: true,
          company: true,
        },
        orderBy: (c, { asc }) => [asc(c.name)],
      });

      // Get active projects with their clients
      const projectsList = await ctx.db.query.projects.findMany({
        where: and(
          orgId
            ? eq(projects.organizationId, orgId)
            : eq(projects.userId, userId),
          eq(projects.status, "active"),
        ),
        columns: {
          id: true,
          name: true,
          clientId: true,
          // The extension's client/project selector filters on `status ===
          // "active"`. Omitting it here left status undefined, so every project
          // was filtered out and only clients (no projects) were selectable.
          status: true,
          // The extension's Project type also expects a flat hourlyRate (shown
          // as the "X kr/t" line under each project in the selector).
          hourlyRate: true,
        },
        with: {
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: (p, { asc }) => [asc(p.name)],
      });

      // Count time entries per client for usage-based sorting
      const usageCounts = await ctx.db
        .select({
          clientId: timeEntries.clientId,
          count: sql<number>`count(*)::int`.as("count"),
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, userId),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
          ),
        )
        .groupBy(timeEntries.clientId);

      const countMap = new Map(
        usageCounts
          .filter((u) => u.clientId !== null)
          .map((u) => [u.clientId as string, u.count]),
      );

      return {
        clients: clientsList.map((c) => ({
          ...c,
          timeEntryCount: countMap.get(c.id) ?? 0,
        })),
        // Flatten to the extension's Project shape: it expects clientName +
        // hourlyRate (not the nested `client` relation), so map them out here.
        projects: projectsList.map((p) => {
          const client = Array.isArray(p.client) ? p.client[0] : p.client;
          return {
            id: p.id,
            name: p.name,
            clientId: p.clientId,
            status: p.status,
            clientName: client?.name ?? "",
            hourlyRate: p.hourlyRate ? Number(p.hourlyRate) : null,
          };
        }),
      };
    }),

  // Create task from extension (e.g., Gmail integration)
  createTask: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        sourceType: z
          .enum(["manual", "email", "calendar", "extension"])
          .default("extension"),
        sourceId: z.string().optional(),
        useAiCategorization: z.boolean().default(false),
        projectId: z.string().uuid().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: (tokenRecord.usageCount || 0) + 1,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      await enforceExtensionWriteLimit(tokenRecord.id);

      // Samme ejerskabstjek som updateTimerState: et fremmed projekt på
      // opgaven ville kunne læses via tasks.list (project + client).
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            orgId
              ? eq(projects.organizationId, orgId)
              : eq(projects.userId, userId),
          ),
          columns: { id: true },
        });
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.projectNotFound"),
          });
        }
      }

      // AI categorization if requested
      let aiSuggestedProject: string | null = null;
      const aiSuggestedPriority: "low" | "medium" | "high" | "urgent" | null =
        null;
      let aiConfidence: string | null = null;

      if (
        input.useAiCategorization &&
        isAIEnabled() &&
        (input.title || input.description)
      ) {
        try {
          // Get user's projects and clients for AI categorization
          const userProjects = await ctx.db.query.projects.findMany({
            where: and(
              orgId
                ? eq(projects.organizationId, orgId)
                : eq(projects.userId, userId),
              eq(projects.status, "active"),
            ),
            columns: {
              id: true,
              name: true,
              description: true,
              clientId: true,
            },
          });

          const userClients = await ctx.db.query.clients.findMany({
            where: and(
              orgId
                ? eq(clients.organizationId, orgId)
                : eq(clients.userId, userId),
              eq(clients.isArchived, false),
            ),
            columns: { id: true, name: true, email: true },
          });

          const aiProjects: AIProject[] = userProjects.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            clientId: p.clientId,
          }));

          const aiClients: AIClient[] = userClients.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            domain: c.email ? c.email.split("@")[1] : null,
          }));

          const categorization = await categorizeTask(
            { title: input.title, description: input.description },
            aiProjects,
            aiClients,
          );
          if (categorization) {
            aiSuggestedProject = categorization.suggestedProjectId;
            aiConfidence = String(
              Math.max(
                categorization.projectConfidence,
                categorization.clientConfidence,
              ),
            );
          }
        } catch (error) {
          // AI categorization failed, continue without it
          console.error("AI categorization failed:", error);
        }
      }

      // Get next position for backlog — scope to the resolved org so the
      // position sequence is consistent within the org the task lands in
      // (otherwise the new task inherits the max position across all of the
      // user's orgs).
      const maxPositionResult = await ctx.db
        .select({ maxPos: max(tasks.position) })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, userId),
            eq(tasks.status, "backlog"),
            ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
          ),
        );
      const nextPosition = (maxPositionResult[0]?.maxPos ?? 0) + 1;

      // Create the task
      const [newTask] = await ctx.db
        .insert(tasks)
        .values({
          userId,
          organizationId: orgId,
          title: input.title,
          description: input.description || null,
          status: "backlog",
          priority: input.priority,
          position: nextPosition,
          sourceType: input.sourceType,
          sourceId: input.sourceId || null,
          projectId: input.projectId || aiSuggestedProject,
          aiSuggestedProject,
          aiSuggestedPriority,
          aiConfidence,
        })
        .returning({ id: tasks.id });

      return {
        id: newTask.id,
        aiSuggestions: aiSuggestedProject
          ? {
              projectId: aiSuggestedProject,
              priority: aiSuggestedPriority,
              confidence: aiConfidence ? Number.parseFloat(aiConfidence) : null,
            }
          : null,
      };
    }),

  // ============================================
  // URL Pattern Matching for Auto-Detection
  // ============================================

  // Match URL against project patterns (for auto-detecting project from current page)
  matchUrlToProject: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        url: z.string().url(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Get all active projects with URL patterns
      const projectsList = await ctx.db.query.projects.findMany({
        where: and(
          orgId
            ? eq(projects.organizationId, orgId)
            : eq(projects.userId, userId),
          eq(projects.status, "active"),
        ),
        columns: {
          id: true,
          name: true,
          clientId: true,
          urlPatterns: true,
        },
        with: {
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Try to match URL against each project's patterns
      for (const project of projectsList) {
        const patterns = (project.urlPatterns as string[]) || [];
        for (const pattern of patterns) {
          if (matchUrlPattern(input.url, pattern)) {
            return {
              matched: true,
              project: {
                id: project.id,
                name: project.name,
              },
              client: project.client,
              matchedPattern: pattern,
            };
          }
        }
      }

      return {
        matched: false,
        project: null,
        client: null,
        matchedPattern: null,
      };
    }),

  // Get all URL patterns for extension popup (to show which patterns are configured)
  getUrlPatterns: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Get all projects with their URL patterns
      const projectsList = await ctx.db.query.projects.findMany({
        where: and(
          orgId
            ? eq(projects.organizationId, orgId)
            : eq(projects.userId, userId),
          eq(projects.status, "active"),
        ),
        columns: {
          id: true,
          name: true,
          urlPatterns: true,
        },
        with: {
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return projectsList.map((p) => {
        const client = Array.isArray(p.client) ? p.client[0] : p.client;
        return {
          projectId: p.id,
          projectName: p.name,
          clientName: client?.name || null,
          patterns: (p.urlPatterns as string[]) || [],
        };
      });
    }),

  // ============================================
  // Idle Detection
  // ============================================

  // Report idle state from extension
  reportIdleState: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        isIdle: z.boolean(),
        lastActivityAt: z.string().optional(), // ISO timestamp of last activity
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      const userId = tokenRecord.userId;

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: (tokenRecord.usageCount || 0) + 1,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      // Get existing timer state
      const timerState = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
      });

      if (!timerState) {
        // No timer state, nothing to update
        return { success: true, action: "none" };
      }

      const now = input.lastActivityAt
        ? new Date(input.lastActivityAt)
        : new Date();

      if (!input.isIdle) {
        // Tilbage ved tasterne: KLIP stemplet ud atomisk. Web og extension
        // kapløber om det — vinderen spørger brugeren, taberen får null og
        // spørger derfor ikke om det samme fravær igen (#588).
        const claimedAt = await claimIdleStamp(ctx.db, userId);
        if (claimedAt) {
          await logTimerEvent(ctx.db, {
            userId,
            event: "idle_claim",
            ...timerEventOrigin(ctx.headers, "extension"),
            detail: { idleDetectedAt: claimedAt.toISOString() },
          });
        }

        return {
          success: true,
          action: "activity_detected",
          wasRunning: timerState.isRunning,
          idleDetectedAt: claimedAt ? claimedAt.toISOString() : null,
        };
      }

      // Inaktivitet registreres — timeren pauses IKKE. Stemplet sættes af den
      // FØRSTE detektor; en senere må ikke flytte det, ellers krymper det
      // målte fravær.
      const stampedAt = await stampIdle(ctx.db, userId);
      if (!timerState.isIdle) {
        await logTimerEvent(ctx.db, {
          userId,
          event: "idle_stamp",
          ...timerEventOrigin(ctx.headers, "extension"),
          detail: {
            idleDetectedAt: stampedAt?.toISOString() ?? null,
            wasRunning: !!timerState.isRunning,
          },
        });
      }

      if (timerState.isRunning && !timerState.isIdle) {
        const elapsedMinutes = Math.round(
          (timerState.elapsedSeconds || 0) / 60,
        );
        sendNotification({
          type: "idle_detected",
          userId: tokenRecord.userId,
          i18n: {
            key: "idleDetected",
            values: { minutes: elapsedMinutes },
          },
          url: `${getAppUrl()}/dashboard/time`,
        }).catch((err) => {
          console.error("Failed to send idle notification:", err);
        });
      }

      return {
        success: true,
        action: "idle_detected",
        wasRunning: timerState.isRunning,
        idleDetectedAt: (stampedAt ?? now).toISOString(),
      };
    }),

  // Get idle settings for extension
  getIdleSettings: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      const userId = tokenRecord.userId;

      // Get timer state with idle settings
      const timerState = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
        columns: {
          idleThresholdMinutes: true,
          autoPauseAfterMinutes: true,
          isIdle: true,
          idleDetectedAt: true,
          lastActivityAt: true,
        },
      });

      return {
        idleThresholdMinutes: timerState?.idleThresholdMinutes || 5,
        // Hård auto-pause efter lang stilstand. null = slået fra.
        autoPauseAfterMinutes: timerState
          ? (timerState.autoPauseAfterMinutes ?? null)
          : 120,
        isCurrentlyIdle: timerState?.isIdle || false,
        idleDetectedAt: timerState?.idleDetectedAt?.toISOString() || null,
        lastActivityAt: timerState?.lastActivityAt?.toISOString() || null,
      };
    }),

  // Update idle threshold setting
  updateIdleThreshold: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        thresholdMinutes: z.number().int().min(1).max(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      const userId = tokenRecord.userId;

      // Upsert timer state with new threshold
      const existing = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
      });

      if (existing) {
        await ctx.db
          .update(timerStates)
          .set({
            idleThresholdMinutes: input.thresholdMinutes,
            updatedAt: new Date(),
          })
          .where(eq(timerStates.id, existing.id));
      } else {
        await ctx.db.insert(timerStates).values({
          userId,
          idleThresholdMinutes: input.thresholdMinutes,
        });
      }

      return { success: true, thresholdMinutes: input.thresholdMinutes };
    }),

  // ============================================
  // Quick Timer Actions
  // ============================================

  // Quick start timer with optional project auto-detection
  quickStart: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        url: z.string().url().optional(), // Current page URL for auto-detection
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: (tokenRecord.usageCount || 0) + 1,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      // Only ONE running timer per user. quickStart is always a fresh start,
      // so refuse if a timer is already running anywhere (avoids double
      // tracking when the web app — or another quickStart — is mid-session).
      const currentTimer = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
        with: { project: { columns: { id: true, name: true } } },
      });
      if (currentTimer?.isRunning) {
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: orgId,
          event: "blocked_other_owner",
          ...timerEventOrigin(ctx.headers, "extension"),
          versionAfter: currentTimer.version,
          detail: {
            kind: "quick_start",
            runningFrom: currentTimer.lastSyncedFrom,
            stage: "precheck",
          },
        });
        return {
          success: false as const,
          reason: "already_running" as const,
          runningFrom: currentTimer.lastSyncedFrom,
          startTime: null,
          project: currentTimer.project ?? null,
          client: null,
          autoDetected: false,
        };
      }

      // Try to auto-detect project from URL
      let detectedProject: { id: string; name: string } | null = null;
      let detectedClient: { id: string; name: string } | null = null;

      if (input.url) {
        const projectsList = await ctx.db.query.projects.findMany({
          where: and(
            orgId
              ? eq(projects.organizationId, orgId)
              : eq(projects.userId, userId),
            eq(projects.status, "active"),
          ),
          columns: {
            id: true,
            name: true,
            clientId: true,
            urlPatterns: true,
          },
          with: {
            client: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        });

        for (const project of projectsList) {
          const patterns = (project.urlPatterns as string[]) || [];
          for (const pattern of patterns) {
            if (matchUrlPattern(input.url, pattern)) {
              detectedProject = { id: project.id, name: project.name };
              const projectClient = Array.isArray(project.client)
                ? project.client[0]
                : project.client;
              detectedClient = projectClient || null;
              break;
            }
          }
          if (detectedProject) break;
        }
      }

      // Create or update timer state — ATOMICALLY. The isRunning pre-check
      // above is only for a friendly early error; the real one-running-timer
      // rule is the setWhere guard here (read-then-write would let two
      // simultaneous starts both pass the pre-check). Bumps version so other
      // clients' remote-change detection sees the start.
      const now = new Date();
      const timerData = {
        isRunning: true,
        startTime: now,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: detectedProject?.id || null,
        clientId: detectedClient?.id || null,
        // Ny session: ingen opgave fra den forrige
        taskId: null,
        description: input.description || "",
        // A fresh start invalidates any lingering stop intent — a stale
        // intent left on the row would let a late confirm-replay or the
        // cleanup cron hit the NEW session.
        intent: null,
        intentAt: null,
        intentFrom: null,
        // Ny session = automatisk klippekort-valg (#422)
        ...CLEARED_PREPAID_CHOICE,
        // Ny server-udstedt session (timer-sessioner, fase 1)
        currentSessionId: newSessionId(),
        lastSyncedAt: now,
        lastSyncedFrom: "extension" as const,
        isIdle: false,
        lastActivityAt: now,
        updatedAt: now,
      };

      const startGuard = sql`NOT COALESCE(${timerStates.isRunning}, false)`;
      const startedRow = await ctx.db.transaction(async (tx) => {
        const [written] = await tx
          .insert(timerStates)
          .values({ userId, ...timerData, version: 1 })
          .onConflictDoUpdate({
            target: timerStates.userId,
            set: { ...timerData, version: sql`${timerStates.version} + 1` },
            setWhere: startGuard,
          })
          .returning({ version: timerStates.version });
        if (written) {
          const origin = timerEventOrigin(ctx.headers, "extension");
          await recordSession(tx, {
            userId,
            organizationId: orgId,
            sessionId: timerData.currentSessionId,
            status: "running",
            startedAt: now,
            projectId: timerData.projectId,
            clientId: timerData.clientId,
            taskId: null,
            description: timerData.description,
            source: origin.source,
            clientHint: origin.clientHint,
          });
        }
        return written;
      });

      if (!startedRow) {
        // Lost the race: a timer started elsewhere between pre-check and write.
        const running = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          with: { project: { columns: { id: true, name: true } } },
        });
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: orgId,
          event: "blocked_other_owner",
          ...timerEventOrigin(ctx.headers, "extension"),
          versionAfter: running?.version ?? null,
          detail: {
            kind: "quick_start",
            runningFrom: running?.lastSyncedFrom ?? null,
          },
        });
        return {
          success: false as const,
          reason: "already_running" as const,
          runningFrom: running?.lastSyncedFrom ?? null,
          startTime: null,
          project: running?.project ?? null,
          client: null,
          autoDetected: false,
        };
      }

      await logTimerEvent(ctx.db, {
        userId,
        organizationId: orgId,
        event: "start",
        ...timerEventOrigin(ctx.headers, "extension"),
        versionBefore: startedRow.version - 1,
        versionAfter: startedRow.version,
        startTime: now,
        baseSeconds: 0,
        projectId: detectedProject?.id || null,
        clientId: detectedClient?.id || null,
        detail: { kind: "quick_start", autoDetected: !!detectedProject },
      });

      await publishTimerEvent(userId, orgId, {
        userId,
        type: "sync",
        isRunning: true,
        projectId: detectedProject?.id || null,
        clientId: detectedClient?.id || null,
        taskId: null,
        description: input.description || "",
        version: startedRow.version,
      });

      return {
        success: true,
        startTime: now.toISOString(),
        project: detectedProject,
        client: detectedClient,
        autoDetected: !!detectedProject,
      };
    }),

  // Quick stop timer
  quickStop: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        saveEntry: z.boolean().default(false), // Whether to create a time entry
        // Extension 2.6.0: stop kun netop denne session (fx notifikationen
        // for en timer, der siden er stoppet og startet på ny et andet sted).
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: (tokenRecord.usageCount || 0) + 1,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      // Get current timer state
      const timerState = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
      });

      if (!timerState?.isRunning) {
        return {
          success: true,
          wasRunning: false,
          elapsedSeconds: 0,
        };
      }

      // A stop is already mid-flight on another client (claim→save→confirm).
      // Creating our own entry here would double-bill the same session.
      if (timerState.intent === "stopping") {
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: orgId,
          event: "blocked_stopping",
          ...timerEventOrigin(ctx.headers, "extension"),
          versionAfter: timerState.version,
          detail: { kind: "quick_stop", stoppedBy: timerState.intentFrom },
        });
        return {
          success: true,
          wasRunning: false,
          elapsedSeconds: 0,
        };
      }

      // Calculate elapsed time
      const now = new Date();
      let elapsedSeconds = timerState.elapsedSeconds || 0;
      if (timerState.startTime) {
        const sessionSeconds = Math.floor(
          (now.getTime() - timerState.startTime.getTime()) / 1000,
        );
        elapsedSeconds = (timerState.baseSeconds || 0) + sessionSeconds;
      }

      // Stop the timer ATOMICALLY: only if it is still running and no stop has
      // been claimed in the meantime. Losing the race means another client owns
      // the stop — we must not also create a time entry (double billing).
      // Rækken bærer altid en session efter stoppet (dovent id til en ældre
      // række), så posten kan bindes til den, og nulstillingen nedenfor kan
      // ramme netop den session (review P3).
      const stopCandidate = newSessionId();
      const stopped = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(timerStates)
          .set({
            isRunning: false,
            startTime: null,
            elapsedSeconds,
            isIdle: false,
            idleDetectedAt: null,
            lastActivityAt: now,
            lastSyncedAt: now,
            lastSyncedFrom: "extension",
            // Uden tid er rækken ryddet — og en ryddet række bærer ingen
            // session (modellen: invariant 9)
            currentSessionId:
              elapsedSeconds > 0
                ? sessionIdSetSql("keep", stopCandidate)
                : null,
            version: sql`${timerStates.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(timerStates.id, timerState.id),
              eq(timerStates.isRunning, true),
              sql`(${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')`,
              input.sessionId ? sessionMatchSql(input.sessionId) : undefined,
            ),
          )
          // Klippekort-valget læses i SAMME atomiske skrivning som stoppet
          // (#422) — et valg der lander efter stoppet, gælder ikke længere.
          .returning({
            version: timerStates.version,
            currentSessionId: timerStates.currentSessionId,
            ...prepaidChoiceReturning,
          });
        if (row && !row.currentSessionId) {
          await closeActiveSessions(tx, userId, "discarded");
        } else if (row?.currentSessionId) {
          const origin = timerEventOrigin(ctx.headers, "extension");
          await recordSession(tx, {
            userId,
            organizationId: orgId,
            sessionId: row.currentSessionId,
            status: "paused",
            startedAt: new Date(now.getTime() - elapsedSeconds * 1000),
            projectId: timerState.projectId,
            clientId: timerState.clientId,
            taskId: timerState.taskId,
            description: timerState.description,
            source: origin.source,
            clientHint: origin.clientHint,
          });
        }
        return row;
      });

      if (!stopped) {
        // Someone else stopped/claimed it between our read and this write.
        // Klassificér ud fra rækken NU (læsning efter den atomiske
        // skrivning): en anden session kan være startet imens.
        const current = input.sessionId
          ? await ctx.db.query.timerStates.findFirst({
              where: eq(timerStates.userId, userId),
              columns: { currentSessionId: true, isRunning: true },
            })
          : undefined;
        const otherSession =
          !!input.sessionId &&
          (timerState.currentSessionId !== input.sessionId ||
            (!!current?.isRunning &&
              current.currentSessionId !== input.sessionId));
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: orgId,
          event: "blocked_stopping",
          ...timerEventOrigin(ctx.headers, "extension"),
          versionAfter: timerState.version,
          detail: {
            kind: "quick_stop",
            reason: otherSession ? SESSION_MISMATCH : "lost_race",
            sessionId: input.sessionId,
          },
        });
        return {
          success: true,
          wasRunning: false,
          elapsedSeconds: 0,
          // 2.6.0: en ANDEN session kører nu — den er ikke stoppet
          sessionMismatch: otherSession,
        };
      }

      await publishTimerEvent(userId, orgId, {
        userId,
        type: "stopped",
        isRunning: false,
        projectId: timerState.projectId,
        clientId: timerState.clientId,
        taskId: timerState.taskId,
        description: timerState.description ?? "",
        version: stopped.version,
      });

      // If saveEntry is true and we have a project or client, create a time entry
      let savedEntryId: string | null = null;
      // Tildeles inde i transaktions-callbacken — `as` holder TS fra at
      // indsnævre typen til null.
      let prepaidDeduction = null as {
        packageName: string;
        hoursDeducted: number;
        remainingHours: number;
        overflowedToInvoice: boolean;
      } | null;
      // Klippekort (#422): brugerens valg for den kørende timer, ellers
      // udløber-først-reglen — samme resultat som et stop i web/extension.
      const stopClientId = stopped.effectiveClientId;
      const prepaidChoice = readReturnedPrepaidChoice(stopped);
      if (input.saveEntry && (timerState.projectId || timerState.clientId)) {
        const hours = Math.round((elapsedSeconds / 3600) * 100) / 100;

        // Only save if there's meaningful time (at least 1 minute = 0.017 hours)
        if (hours >= 0.02) {
          // Start = stop minus sporet tid (pauser klappet sammen), samme
          // interval som gemmes nedenfor. Posten dateres efter starten (#650).
          const startedAt = new Date(now.getTime() - elapsedSeconds * 1000);

          // Entry + row-zeroing in ONE transaction: a crash between them
          // would otherwise leave the saved seconds resumable on the row
          // (isRunning=false, elapsed>0, no intent) — a shape no cleanup
          // catches, and the classic double-count seed.
          const stopSessionId = stopped.currentSessionId;
          savedEntryId = await ctx.db
            .transaction(async (tx) => {
              const [newEntry] = await tx
                .insert(timeEntries)
                .values({
                  userId,
                  organizationId: orgId,
                  projectId: timerState.projectId,
                  clientId: timerState.clientId || null,
                  description:
                    timerState.description || "Tid registreret via extension",
                  hours: hours.toFixed(2),
                  date: entryDateForStart(startedAt),
                  // Derive the interval from the timer: end = now, start = now
                  // minus total tracked time (pause gaps collapse into one span).
                  startTime: startedAt,
                  endTime: now,
                  isBillable: await resolveDefaultBillable(tx, {
                    projectId: timerState.projectId,
                    clientId: timerState.clientId,
                  }),
                  source: "timer",
                  // Timer-sessioner: én session ⇒ én post (unikt indeks)
                  timerSessionId: stopSessionId ?? null,
                })
                .onConflictDoNothing()
                .returning({ id: timeEntries.id });

              if (!newEntry) return null;

              // The session is now SAVED — zero the row's tracked time so no
              // client can resume/adopt the same seconds and double-count them
              // on a later stop. Review P3: nulstillingen rammer SESSIONEN, ikke
              // en bestemt version. Før tabte den til enhver samtidig skrivning
              // (fx et klippekort-valg), og rækken blev stående pauset på en
              // gemt session — uden for et stop, så ældre klienters starter
              // blev afvist, og ingen cron ryddede den. Nu ryddes en pauset rest
              // af sessionen uanset version; er rækken genoptaget, får den et
              // nyt id; en ny session røres ikke. Sessionen markeres gemt i
              // samme transaktion (rækken før sessionen — samme låserækkefølge
              // som resten af timer-skrivningerne).
              if (stopSessionId) {
                const saved = await saveSessionEntry(tx, {
                  userId,
                  organizationId: orgId,
                  sessionId: stopSessionId,
                  entryId: newEntry.id,
                  // Review P3: minutter fra et quick-add der landede efter
                  // stoppet, ryddes ikke med den gemte tid
                  expectedElapsedSeconds: elapsedSeconds,
                });
                // Et samtidigt gem af samme session vandt — rul tilbage
                if (!saved) throw new SessionAlreadySavedError();
              } else {
                await tx
                  .update(timerStates)
                  .set({
                    elapsedSeconds: 0,
                    baseSeconds: 0,
                    startTime: null,
                    projectId: null,
                    clientId: null,
                    taskId: null,
                    description: "",
                    ...CLEARED_PREPAID_CHOICE,
                    currentSessionId: null,
                    version: sql`${timerStates.version} + 1`,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(timerStates.id, timerState.id),
                      eq(timerStates.version, stopped.version),
                    ),
                  );
              }

              // Klippekort-trækket EFTER rækken (review P3): samme låserækkefølge
              // som time.create — timer_states før klippekortet.
              // Klippekort-træk i samme transaktion som posten. Trækket kører i
              // et savepoint: afvises det (tomt kort med block-politik, udløbet
              // kort), gemmes tiden UDEN træk i stedet for at gå tabt — samme
              // regel som extensionens eget stop.
              if (stopClientId && prepaidChoice?.mode !== "none") {
                const packageId =
                  prepaidChoice?.mode === "package"
                    ? prepaidChoice.packageId
                    : ((
                        await findAutoDeductPackageForClient(tx, {
                          userId,
                          orgId,
                          clientId: stopClientId,
                          now,
                        })
                      )?.id ?? null);
                if (packageId) {
                  try {
                    const result = await tx.transaction((sp) =>
                      deductHoursCore(sp, userId, orgId, {
                        packageId,
                        hours,
                        timeEntryId: newEntry.id,
                        // Et eksplicit kortvalg (prepaidChoice.mode === "package")
                        // kan være en kendt packageId fra en anden kunde
                        // (CodeRabbit, PR #858) — stopClientId er postens egen.
                        clientId: stopClientId,
                      }),
                    );
                    prepaidDeduction = {
                      packageName: result.packageName,
                      hoursDeducted: result.hoursDeducted,
                      remainingHours: result.remainingHours,
                      overflowedToInvoice: !!result.overflowedToInvoice,
                    };
                  } catch (error) {
                    if (!(error instanceof TRPCError)) throw error;
                    console.warn(
                      `[quickStop] Klippekort-træk afvist for user ${userId} — tiden gemmes uden træk: ${error.message}`,
                    );
                  }
                }
              }

              return newEntry.id;
            })
            .catch(async (err: unknown) => {
              if (
                !(err instanceof SessionAlreadySavedError) ||
                !stopSessionId
              ) {
                throw err;
              }
              // Sessionen blev gemt et andet sted imens — dens post er sandheden
              const won = await findOwnSession(ctx.db, userId, stopSessionId);
              return won?.savedEntryId ?? null;
            });
        }
      }

      await logTimerEvent(ctx.db, {
        userId,
        organizationId: orgId,
        event: "quick_stop",
        ...timerEventOrigin(ctx.headers, "extension"),
        versionBefore: timerState.version,
        versionAfter: stopped.version,
        startTime: timerState.startTime,
        baseSeconds: timerState.baseSeconds,
        projectId: timerState.projectId,
        clientId: timerState.clientId,
        detail: {
          elapsedSeconds,
          saveEntry: input.saveEntry,
          savedEntryId: savedEntryId ?? undefined,
        },
      });

      return {
        success: true,
        wasRunning: true,
        elapsedSeconds,
        projectId: timerState.projectId,
        clientId: timerState.clientId,
        description: timerState.description,
        savedEntryId,
        prepaidDeduction,
      };
    }),

  // Get recent time entries for extension
  getRecentEntries: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        limit: z.number().min(1).max(20).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Get recent time entries (always scoped to token owner)
      const entries = await ctx.db.query.timeEntries.findMany({
        where: and(
          eq(timeEntries.userId, userId),
          ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
        ),
        orderBy: [desc(timeEntries.date), desc(timeEntries.createdAt)],
        limit: input.limit,
        with: {
          project: {
            columns: {
              id: true,
              name: true,
            },
            with: {
              client: {
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return entries.map((entry) => {
        const project = Array.isArray(entry.project)
          ? entry.project[0]
          : entry.project;
        const client = Array.isArray(entry.client)
          ? entry.client[0]
          : entry.client;
        const projectClient = project?.client
          ? Array.isArray(project.client)
            ? project.client[0]
            : project.client
          : null;
        return {
          id: entry.id,
          description: entry.description || "",
          hours: Number(entry.hours),
          date: toCopenhagenDateStr(entry.date),
          projectId: entry.projectId,
          projectName: project?.name || null,
          clientId: entry.clientId || projectClient?.id || null,
          clientName: client?.name || projectClient?.name || null,
          startTime: entry.startTime?.toISOString() ?? null,
          endTime: entry.endTime?.toISOString() ?? null,
        };
      });
    }),

  // Get time entries for a date range (for smart notifications and pattern analysis)
  getTimeEntries: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        startDate: z.string(), // YYYY-MM-DD
        endDate: z.string().optional(), // YYYY-MM-DD, defaults to today
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: sql`${extensionTokens.usageCount} + 1`,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      // Danske dagsgrænser uanset processens TZ (#649); slutdato inkl. hele
      // dagen, og uden slutdato hele dagens danske dato (ikke "nu", der
      // udelukkede dagens poster mellem 00 og 02).
      if (
        !isDateOnlyString(input.startDate) ||
        (input.endDate && !isDateOnlyString(input.endDate))
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "ext.datesFormat"),
        });
      }
      const startDateObj = copenhagenDayStart(input.startDate);
      const endDateObj = copenhagenDayEndExclusive(
        input.endDate ?? copenhagenToday(),
      );

      // Get time entries in date range (always scoped to token owner)
      const entries = await ctx.db.query.timeEntries.findMany({
        where: and(
          eq(timeEntries.userId, userId),
          ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
          gte(timeEntries.date, startDateObj),
          lt(timeEntries.date, endDateObj),
        ),
        orderBy: [desc(timeEntries.date)],
        with: {
          project: {
            columns: {
              id: true,
              name: true,
            },
            with: {
              client: {
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return entries.map((entry) => {
        const project = Array.isArray(entry.project)
          ? entry.project[0]
          : entry.project;
        const client = Array.isArray(entry.client)
          ? entry.client[0]
          : entry.client;
        const projectClient = project?.client
          ? Array.isArray(project.client)
            ? project.client[0]
            : project.client
          : null;
        return {
          id: entry.id,
          description: entry.description || "",
          hours: Number(entry.hours),
          date: toCopenhagenDateStr(entry.date),
          projectId: entry.projectId,
          projectName: project?.name || null,
          clientId: entry.clientId || projectClient?.id || null,
          clientName: client?.name || projectClient?.name || null,
          createdAt: entry.createdAt.toISOString(),
          startTime: entry.startTime?.toISOString() ?? null,
          endTime: entry.endTime?.toISOString() ?? null,
          isBillable: entry.isBillable ?? true, // Default to true if not specified
          isFromPrepaid: !!entry.prepaidPackageId, // True if linked to prepaid package
        };
      });
    }),

  // Get prepaid packages for smart notifications
  getPrepaidPackages: tokenProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: sql`${extensionTokens.usageCount} + 1`,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      // Get active prepaid packages (exclude expired). Kortet gælder hele
      // udløbsdagen i dansk tid (#736).
      const expiredBefore = prepaidExpiredBefore();
      const packages = await ctx.db.query.prepaidPackages.findMany({
        where: and(
          orgId
            ? eq(prepaidPackages.organizationId, orgId)
            : eq(prepaidPackages.userId, userId),
          eq(prepaidPackages.isActive, true),
          // Include packages with no expiry date OR not yet expired
          or(
            isNull(prepaidPackages.expiryDate),
            gte(prepaidPackages.expiryDate, expiredBefore),
          ),
        ),
        orderBy: [desc(prepaidPackages.purchaseDate)],
        with: {
          client: {
            columns: { id: true, name: true },
          },
        },
      });

      // Map to interface with defensive null check for client
      return packages
        .filter((pkg) => pkg.client) // Skip packages without client
        .map((pkg) => {
          const client = Array.isArray(pkg.client) ? pkg.client[0] : pkg.client;
          return {
            id: pkg.id,
            clientId: pkg.clientId,
            clientName: client?.name || "",
            name: pkg.name,
            totalHours: Number(pkg.totalHours),
            usedHours: Number(pkg.usedHours),
            remainingHours: Number(pkg.remainingHours),
            expiresAt: pkg.expiryDate ? pkg.expiryDate.toISOString() : null,
            // Tie-break i auto-valget: ældste kort først (A1 P2-6)
            purchasedAt: pkg.purchaseDate
              ? pkg.purchaseDate.toISOString()
              : null,
            isActive: true,
            // Extensionen forvælger kortet ud fra dette flag, så tid registreret
            // derfra lander på klippekortet uden en tur forbi web-appen.
            autoDeduct: pkg.autoDeduct,
            clipSizeMinutes: pkg.clipSizeMinutes,
          };
        });
    }),

  // Create time entry from extension (e.g., auto-tracked sessions)
  // Supports either projectId OR clientId (at least one required)
  createTimeEntry: publicProcedure
    .input(
      z
        .object({
          token: z.string().min(1),
          organizationId: z.string().optional(),
          projectId: z.string().uuid().optional().nullable(),
          clientId: z.string().uuid().optional().nullable(),
          description: z.string(),
          hours: z.number().positive(),
          date: entryDateStrInput, // dansk dato, normaliseret til YYYY-MM-DD
          startTime: z.string().optional(),
          endTime: z.string().optional(),
          source: z
            .enum(["auto_track", "api"])
            .optional()
            .default("auto_track"),
          // Client-generated idempotency key: a retried create (offline queue,
          // lost response) with the same key must not insert a duplicate.
          clientEntryId: z.string().uuid().optional(),
          // Klippekort valgt i extensionen — så tiden lander på kortet uden
          // en tur forbi web-appen (ønsket fra kunde A, 6/8-2026).
          prepaidPackageId: z.string().uuid().optional().nullable(),
          // Server-udstedt timer-session (fase 2-klar): én session ⇒ højst
          // én post. Et gentaget kald returnerer den eksisterende post.
          timerSessionId: z.string().uuid().optional(),
        })
        .refine(
          (data) => data.projectId || data.clientId || data.description?.trim(),
          {
            error: () => st("zod.selectProjectClientOrDescriptionShort"),
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate token
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.tokenExpired"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      // Update token usage
      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: sql`${extensionTokens.usageCount} + 1`,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      await enforceExtensionWriteLimit(tokenRecord.id);

      // Ældre poster brugte den rå UUID. Genfind kun callerens egen række.
      if (input.clientEntryId) {
        const legacy = await ctx.db.query.timeEntries.findFirst({
          where: and(
            eq(timeEntries.clientEntryId, input.clientEntryId),
            eq(timeEntries.userId, userId),
          ),
          columns: { id: true },
        });
        if (legacy) return { id: legacy.id, success: true };
      }
      const clientEntryId = scopeClientEntryId(
        input.clientEntryId,
        userId,
        "extension",
        true,
      );

      let finalClientId: string | null = input.clientId || null;

      // If projectId provided, verify it exists and get its clientId
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            orgId
              ? eq(projects.organizationId, orgId)
              : eq(projects.userId, userId),
          ),
        });

        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.projectNotFound"),
          });
        }
        finalClientId = project.clientId;
      }

      // If only clientId provided, verify it exists
      if (!input.projectId && input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            orgId
              ? eq(clients.organizationId, orgId)
              : eq(clients.userId, userId),
          ),
        });

        if (!client) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.clientNotFound"),
          });
        }
      }

      // Org-periodelås (#144) — extension-tokenet må ikke omgå låsen
      await assertPeriodUnlocked(ctx.db, orgId, [input.date]);
      // Afsluttede perioder (#518) er låst for alle registreringsveje
      await assertEntriesOutsideClosedPeriods(ctx.db, orgId, userId, [
        input.date,
      ]);

      // Klippekort: kortet skal tilhøre samme kunde som posten, ellers ville
      // en registrering kunne tømme en fremmed kundes saldo. Samme kontrakt
      // som web-appen — serveren trækker aldrig uden et eksplicit kort-id.
      let prepaidPackageId: string | null = null;
      if (input.prepaidPackageId) {
        const pkg = await ctx.db.query.prepaidPackages.findFirst({
          where: and(
            eq(prepaidPackages.id, input.prepaidPackageId),
            orgId
              ? eq(prepaidPackages.organizationId, orgId)
              : eq(prepaidPackages.userId, userId),
          ),
          columns: { id: true, clientId: true },
        });
        if (!pkg) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "ext.prepaidNotFound"),
          });
        }
        if (!finalClientId || pkg.clientId !== finalClientId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "ext.prepaidOtherClient"),
          });
        }
        await assertClientAccess(ctx.db, userId, orgId, pkg.clientId);
        prepaidPackageId = pkg.id;
      }

      // Create time entry. With a clientEntryId the insert is IDEMPOTENT: a
      // retry whose original request actually committed (response lost on the
      // network) hits the unique index and returns the existing entry instead
      // of inserting a duplicate.
      // Insert og klippekort-træk i SAMME transaktion, og trækket sker kun
      // hvis insertet faktisk oprettede en række. Ved en gentagelse fra
      // offline-køen rammer insertet unique-indekset og returnerer intet —
      // uden den binding ville hver retry trække timerne igen.
      // Én session = én post (kunde A 1/10): samme session gemt igen (fx
      // efter en genopstanden timer) forlænger den eksisterende post i
      // stedet for at indsætte en dublet med samme start.
      const sessionStart = input.startTime ? new Date(input.startTime) : null;
      const sessionEnd = input.endTime ? new Date(input.endTime) : null;
      let mergedSessionEntryId: string | null = null;
      // Timer-session: et fremmed/ukendt id ignoreres; en allerede gemt
      // session returnerer sin post (idempotent).
      const ownSession = input.timerSessionId
        ? await findOwnSession(ctx.db, userId, input.timerSessionId)
        : undefined;
      if (ownSession?.savedEntryId) {
        return { id: ownSession.savedEntryId, success: true };
      }
      // Gemt af en ældre klient uden id (fx efter at cron'en parkerede et
      // forladt stop, og 2.5.x gemte den pausede rest): dens post er
      // sandheden — et sent gem fra write-ahead-køen må ikke gemme sessionen
      // igen (fundet af modellen, 2.6.0 + 2.5.x).
      const legacySaved = ownSession
        ? await findLegacySavedEntry(ctx.db, userId, ownSession, {
            hours: input.hours,
          })
        : undefined;
      if (ownSession && legacySaved) {
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: orgId,
          event: "merge_same_session",
          ...timerEventOrigin(ctx.headers, "extension"),
          detail: {
            sessionId: ownSession.id,
            entryId: legacySaved.id,
            alreadySaved: true,
          },
        });
        return { id: legacySaved.id, success: true, alreadySaved: true };
      }
      const timerSessionId = ownSession?.id ?? null;
      const { entry: timeEntry, deduction: prepaidDeduction } = await ctx.db
        .transaction(async (tx) => {
          // En afspilning med en kendt clientEntryId er allerede gemt — den
          // håndteres idempotent af insertet nedenfor og må ikke forlænge en
          // post, brugeren siden har rettet ned.
          const isReplay = clientEntryId
            ? !!(await tx.query.timeEntries.findFirst({
                where: and(
                  eq(timeEntries.clientEntryId, clientEntryId),
                  eq(timeEntries.userId, userId),
                ),
                columns: { id: true },
              }))
            : false;
          if (
            !isReplay &&
            sessionStart &&
            !Number.isNaN(sessionStart.getTime())
          ) {
            const merged = await mergeIntoSameSessionEntry(tx, {
              userId,
              orgId,
              startTime: sessionStart,
              endTime:
                sessionEnd && !Number.isNaN(sessionEnd.getTime())
                  ? sessionEnd
                  : null,
              hours: input.hours,
              prepaidPackageId,
              incomingProjectId: input.projectId || null,
              incomingClientIdRaw: finalClientId,
              incomingClientId: finalClientId,
              assertEditable: (existing) =>
                assertPeriodUnlocked(tx, orgId, [existing.date]),
            });
            if (merged) {
              mergedSessionEntryId = merged.entry?.id ?? null;
              if (
                timerSessionId &&
                merged.entry &&
                !(await saveSessionEntry(tx, {
                  userId,
                  organizationId: orgId,
                  sessionId: timerSessionId,
                  entryId: merged.entry.id,
                }))
              ) {
                // Samtidigt gem af samme session vandt — rul tilbage (P2-3)
                throw new SessionAlreadySavedError();
              }
              return {
                entry: merged.entry,
                deduction: merged.prepaidDeduction,
              };
            }
          }

          const [inserted] = await tx
            .insert(timeEntries)
            .values({
              userId,
              organizationId: orgId,
              projectId: input.projectId || null,
              clientId: finalClientId,
              description: input.description || "Timer fra extension",
              hours: input.hours.toString(),
              date: entryDateFromStr(input.date),
              startTime: input.startTime ? new Date(input.startTime) : null,
              endTime: input.endTime ? new Date(input.endTime) : null,
              source: input.source,
              clientEntryId,
              timerSessionId,
              isBillable: await resolveDefaultBillable(tx, {
                projectId: input.projectId,
                clientId: finalClientId,
              }),
              isPrepaid: !!prepaidPackageId,
              prepaidPackageId,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            // Begge unikke indeks (clientEntryId, timer_session_id) dømmer
            .onConflictDoNothing()
            .returning();

          if (
            inserted &&
            timerSessionId &&
            !(await saveSessionEntry(tx, {
              userId,
              organizationId: orgId,
              sessionId: timerSessionId,
              entryId: inserted.id,
            }))
          ) {
            throw new SessionAlreadySavedError();
          }

          if (!inserted || !prepaidPackageId) {
            return { entry: inserted, deduction: null };
          }

          const result = await deductHoursCore(tx, userId, orgId, {
            packageId: prepaidPackageId,
            hours: input.hours,
            timeEntryId: inserted.id,
            // Allerede valideret mod finalClientId ovenfor (linje ~3148).
            clientId: finalClientId,
          });
          return {
            entry: inserted,
            deduction: {
              packageName: result.packageName,
              hoursDeducted: result.hoursDeducted,
              remainingHours: result.remainingHours,
              // invoice-politik (#93): kortet dækkede ikke posten, den er
              // sat fakturerbar igen af deductHoursCore
              overflowedToInvoice: !!result.overflowedToInvoice,
            },
          };
        })
        .catch((err: unknown) => {
          // Et samtidigt gem af samme session vandt: intet gemt her
          if (err instanceof SessionAlreadySavedError) {
            return { entry: undefined, deduction: null };
          }
          throw err;
        });

      if (!timeEntry && timerSessionId) {
        // Tabte kapløbet om samme session — vinderens post er sandheden.
        const sessionEntry = await ctx.db.query.timeEntries.findFirst({
          where: and(
            eq(timeEntries.timerSessionId, timerSessionId),
            eq(timeEntries.userId, userId),
          ),
          columns: { id: true },
        });
        if (sessionEntry) return { id: sessionEntry.id, success: true };
        const won = await findOwnSession(ctx.db, userId, timerSessionId);
        if (won?.savedEntryId) return { id: won.savedEntryId, success: true };
      }
      if (!timeEntry && clientEntryId) {
        // Duplicate replay — the entry already exists. Return it as success so
        // the offline queue marks the action processed.
        //
        const existingEntry = await ctx.db.query.timeEntries.findFirst({
          where: and(
            eq(timeEntries.clientEntryId, clientEntryId),
            eq(timeEntries.userId, userId),
          ),
          columns: { id: true },
        });
        if (existingEntry) {
          return { id: existingEntry.id, success: true };
        }
      }
      if (!timeEntry) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: await tr("serverErrors", "ext.saveEntryFailed"),
        });
      }

      if (mergedSessionEntryId) {
        // Samme timer-session gemt igen → eksisterende post forlænget i
        // stedet for en dublet. Logges, så "dublet"-klager kan spores.
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: orgId,
          event: "merge_same_session",
          ...timerEventOrigin(
            ctx.headers,
            input.source === "api" ? "api" : "extension",
          ),
          startTime: sessionStart,
          projectId: input.projectId || null,
          clientId: finalClientId,
          detail: { entryId: mergedSessionEntryId, hours: input.hours },
        });
      }

      trackEvent({
        userId,
        orgId,
        event: "time_entry.created",
        source: "extension",
      });
      // Åbne web-faner/enheder skal se posten og klippekortssaldoen nu.
      void publishDataChanged(userId, orgId, TIME_ENTRY_DOMAINS);

      return {
        id: timeEntry.id,
        success: true,
        prepaidDeduction,
      };
    }),

  updateTimeEntry: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        id: z.string().uuid(),
        description: z.string().optional(),
        hours: z.number().positive(),
        date: entryDateStrInput,
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        projectId: z.string().uuid().optional().nullable(),
        clientId: z.string().uuid().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: sql`${extensionTokens.usageCount} + 1`,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      const ownershipFilter = and(
        eq(timeEntries.userId, userId),
        ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
      );

      const existing = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.timeEntryNotFound"),
        });
      }

      // Fakturerede poster er låst (#702) — en uændret gem er en no-op
      assertBilledPatchAllowed(existing, {
        hours: input.hours,
        date: input.date,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        projectId: input.projectId,
        clientId: input.clientId,
      });
      if (isBilledLocked(existing)) return { success: true };

      // Org-periodelås (#144): både gammel og ny dato
      await assertPeriodUnlocked(ctx.db, orgId, [existing.date, input.date]);
      await assertEntriesOutsideClosedPeriods(ctx.db, orgId, userId, [
        existing.date,
        input.date,
      ]);

      const updateData: Record<string, unknown> = {
        hours: input.hours.toString(),
        date: entryDateFromStr(input.date),
        updatedAt: new Date(),
      };

      if (input.description !== undefined)
        updateData.description = input.description;
      if (input.startTime) updateData.startTime = new Date(input.startTime);
      if (input.endTime) updateData.endTime = new Date(input.endTime);
      // Validér nye projekt-/klient-referencer mod kalderens org/bruger, som
      // createTimeEntry og updateTimerState allerede gør. Uden det kunne en
      // opdatering hænge posten på en fremmed klient, der derefter blev læst
      // tilbage via time.list/getById's client-join.
      let newProjectClientId: string | null = null;
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            orgId
              ? eq(projects.organizationId, orgId)
              : eq(projects.userId, userId),
          ),
          columns: { id: true, clientId: true },
        });
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.projectNotFound"),
          });
        }
        newProjectClientId = project.clientId ?? null;
      }
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            orgId
              ? eq(clients.organizationId, orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.clientNotFound"),
          });
        }
      }

      if (input.projectId !== undefined) updateData.projectId = input.projectId;
      if (input.clientId !== undefined) updateData.clientId = input.clientId;

      // Klippekortet følger posten som i time.update (A1 P1-2): nye timer
      // reverseres og trækkes igen, skift af effektiv kunde detacher.
      // Udeladte felter er uændrede, så postens egne værdier gælder dér.
      const oldProjectClientId = existing.isPrepaid
        ? await lookupProjectClientId(ctx.db, existing.projectId)
        : null;
      const projectUnchanged =
        input.projectId === undefined ||
        (input.projectId ?? null) === existing.projectId;

      await ctx.db.transaction(async (tx) => {
        const { patch } = await reconcilePrepaidAfterEdit(tx, {
          userId,
          orgId,
          entry: { ...existing, hours: Number(existing.hours) },
          oldClient: {
            clientId: existing.clientId ?? null,
            projectClientId: oldProjectClientId,
          },
          newClient: {
            clientId:
              input.clientId !== undefined
                ? input.clientId
                : (existing.clientId ?? null),
            projectClientId: projectUnchanged
              ? oldProjectClientId
              : newProjectClientId,
          },
          newHours: input.hours,
        });

        await tx
          .update(timeEntries)
          .set({ ...updateData, ...(patch ?? {}) })
          .where(and(eq(timeEntries.id, input.id), ownershipFilter));
      });
      void publishDataChanged(userId, orgId, TIME_ENTRY_DOMAINS);

      return { success: true };
    }),

  deleteTimeEntry: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        organizationId: z.string().optional(),
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenRecord = await ctx.db.query.extensionTokens.findFirst({
        where: activeTokenWhere(input.token),
      });

      if (!tokenRecord) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.invalidToken"),
        });
      }

      const userId = tokenRecord.userId;
      const orgId = await resolveExtensionOrg(
        ctx.db,
        userId,
        input.organizationId,
      );

      await ctx.db
        .update(extensionTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: sql`${extensionTokens.usageCount} + 1`,
        })
        .where(eq(extensionTokens.id, tokenRecord.id));

      const ownershipFilter = and(
        eq(timeEntries.userId, userId),
        ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
      );

      const existing = await ctx.db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.id, input.id), ownershipFilter),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.timeEntryNotFound"),
        });
      }

      // Fakturerede poster kan ikke slettes (#702)
      assertEntryNotBilled(existing);

      // Org-periodelås (#144)
      await assertPeriodUnlocked(ctx.db, orgId, [existing.date]);
      await assertEntriesOutsideClosedPeriods(ctx.db, orgId, userId, [
        existing.date,
      ]);

      // Som time.delete (A1 P1-2): giv kortet timerne tilbage og ryd
      // usage-/skabelon-rækker først — begge FK'er har ingen ON DELETE i
      // prod, så en klippekort-post kunne ellers ikke slettes herfra.
      await ctx.db.transaction(async (tx) => {
        await refundPrepaidForDeletion(tx, [existing]);
        await tx
          .delete(generatedTimeEntries)
          .where(eq(generatedTimeEntries.timeEntryId, input.id));
        await tx
          .delete(timeEntries)
          .where(and(eq(timeEntries.id, input.id), ownershipFilter));
      });

      // Samme sletning fra browserens stopknap: skrivebordsenheden skal høre
      // om den, ellers står posten stadig i appens lokale db.
      await recordDeletionTombstones(ctx.db, {
        entityType: "time_entry",
        rows: [existing],
      });
      void publishDataChanged(userId, orgId, TIME_ENTRY_DOMAINS);

      return { success: true };
    }),
});
