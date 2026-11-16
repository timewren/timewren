import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { orglessForbiddenMessage } from "@/lib/auth/orgless";
import { CLIENT_HEADER, parseClientHeader } from "@/lib/client-version";
import { clients, deviceMatchRules, projects } from "@/lib/db/schema";
import { publishDataChanged } from "@/lib/realtime";
import { router } from "../../trpc";
import { type DeviceAuth, deviceProcedure } from "./device-procedure";

/**
 * Regler og mønstre til desktop-detektionen (spec D3/D11). To kilder:
 *  - projekternes `urlPatterns` fra web (sat på projektet), og
 *  - bekræftede koblinger fra udvidelsen og desktop (domæne, URL, repo,
 *    app, titel → projekt/kunde) i `device_match_rules`.
 * Matchningen sker på klienten; rå aktivitet sendes aldrig hertil.
 */

/** Realtime-domæne for reglerne (strømmens område "rules"). */
export const RULES_DOMAIN = "extension.rules";

/**
 * Delta-opslag med `since` går så meget tilbage, så en regel, der blev
 * gemt i en transaktion, som først blev synlig efter sidste svar, ikke
 * mistes. Klienten upserter idempotent, så gentagne regler er ufarlige.
 */
export const SINCE_OVERLAP_MS = 60_000;

export const RULE_KINDS = ["domain", "url", "repo", "app", "title"] as const;

export const ruleInput = z
  .object({
    kind: z.enum(RULE_KINDS),
    pattern: z.string().trim().min(1).max(500),
    projectId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    /** "Ikke arbejde": aktiviteten foreslås aldrig. Uden projekt og kunde. */
    notWork: z.boolean().optional(),
    source: z.enum(["extension", "desktop", "mobile"]).optional(),
    usageCount: z.number().int().min(0).max(1_000_000).optional(),
    lastUsedAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((r, ctx) => {
    const hasTarget = !!(r.projectId || r.clientId);
    if (r.notWork && hasTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: st("ext.import.noWorkRuleNoTarget"),
      });
    } else if (!r.notWork && !hasTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: st("ext.import.ruleNeedsTarget"),
      });
    }
  });

/** Domæner sammenlignes uden store bogstaver og uden "www.". */
export function normalizeRulePattern(
  kind: (typeof RULE_KINDS)[number],
  pattern: string,
): string {
  const trimmed = pattern.trim();
  if (kind === "domain") return trimmed.toLowerCase().replace(/^www\./, "");
  return trimmed;
}

function requireOrg(device: DeviceAuth): string {
  if (!device.orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: orglessForbiddenMessage(),
    });
  }
  return device.orgId;
}

/**
 * Gem bekræftede regler (idempotent pr. bruger, org, type og mønster). Delt
 * af `rules.upsert` og importen. Projekter og kunder skal være org'ens egne.
 */
export async function upsertDeviceRules(
  database: typeof import("@/lib/db").db,
  device: DeviceAuth,
  rules: z.infer<typeof ruleInput>[],
): Promise<{ id: string }[]> {
  const orgId = requireOrg(device);
  const userId = device.userId;

  const projectIds = [
    ...new Set(rules.map((r) => r.projectId).filter(Boolean)),
  ] as string[];
  const clientIds = [
    ...new Set(rules.map((r) => r.clientId).filter(Boolean)),
  ] as string[];
  const ownProjects = projectIds.length
    ? await database
        .select({ id: projects.id, clientId: projects.clientId })
        .from(projects)
        .where(
          and(
            inArray(projects.id, projectIds),
            eq(projects.organizationId, orgId),
          ),
        )
    : [];
  const ownClients = clientIds.length
    ? await database
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            inArray(clients.id, clientIds),
            eq(clients.organizationId, orgId),
          ),
        )
    : [];
  const projectClient = new Map(ownProjects.map((p) => [p.id, p.clientId]));
  const clientSet = new Set(ownClients.map((c) => c.id));
  if (
    projectIds.some((id) => !projectClient.has(id)) ||
    clientIds.some((id) => !clientSet.has(id))
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "ext.projectOrClientNotFound"),
    });
  }

  const now = new Date();
  // Samme regel to gange i ét kald: sidste vinder (ON CONFLICT kan ikke
  // ramme samme række to gange i én sætning).
  const byKey = new Map<string, typeof deviceMatchRules.$inferInsert>();
  for (const r of rules) {
    const pattern = normalizeRulePattern(r.kind, r.pattern);
    const projectId = r.projectId ?? null;
    byKey.set(`${r.kind}\u0000${pattern}`, {
      userId,
      organizationId: orgId,
      kind: r.kind,
      pattern,
      projectId,
      clientId:
        r.clientId ??
        (projectId ? (projectClient.get(projectId) ?? null) : null),
      notWork: r.notWork ?? false,
      source: r.source ?? "desktop",
      usageCount: r.usageCount ?? 0,
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt) : null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  const rows = await database
    .insert(deviceMatchRules)
    .values([...byKey.values()])
    .onConflictDoUpdate({
      target: [
        deviceMatchRules.userId,
        deviceMatchRules.organizationId,
        deviceMatchRules.kind,
        deviceMatchRules.pattern,
      ],
      set: {
        projectId: sql`excluded.project_id`,
        clientId: sql`excluded.client_id`,
        notWork: sql`excluded.not_work`,
        source: sql`excluded.source`,
        usageCount: sql`greatest(${deviceMatchRules.usageCount}, excluded.usage_count)`,
        lastUsedAt: sql`greatest(${deviceMatchRules.lastUsedAt}, excluded.last_used_at)`,
        deletedAt: null,
        updatedAt: now,
      },
    })
    .returning({ id: deviceMatchRules.id });
  return rows;
}

export const extRulesRouter = router({
  /**
   * Alt, klienten skal matche med. `since` (serverTime fra sidste svar)
   * giver kun ændrede regler, inkl. fjernede (`deletedAt` sat).
   *
   * "Ikke arbejde"-regler (`notWork`) går kun til klienter, der forstår
   * dem: desktop (klient-headeren) eller `includeNotWork: true`. Andre
   * (udvidelsen) ville tage dem for en almindelig kobling. For dem er en
   * notWork-regel udeladt, og i et delta sendes den som fjernet, så en
   * regel, der skiftede til notWork, forsvinder fra klienten.
   */
  getMatchingRules: deviceProcedure
    .input(
      z.object({
        since: z.string().datetime({ offset: true }).optional(),
        includeNotWork: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.device);
      const serverTime = new Date();
      const includeNotWork =
        input.includeNotWork === true ||
        parseClientHeader(ctx.headers?.get(CLIENT_HEADER))?.kind === "desktop";

      // Via web, så medlemmers kundeadgang og projekt-modulet gælder.
      const projectList = await ctx.web.projects.list();
      const projectPatterns = projectList
        .filter(
          (p) =>
            p.status === "active" &&
            Array.isArray(p.urlPatterns) &&
            p.urlPatterns.length > 0,
        )
        .map((p) => {
          const client = Array.isArray(p.client) ? p.client[0] : p.client;
          return {
            projectId: p.id,
            projectName: p.name,
            clientId: p.clientId,
            clientName: client?.name ?? null,
            patterns: p.urlPatterns as string[],
          };
        });

      const rules = await ctx.db
        .select({
          id: deviceMatchRules.id,
          kind: deviceMatchRules.kind,
          pattern: deviceMatchRules.pattern,
          projectId: deviceMatchRules.projectId,
          clientId: deviceMatchRules.clientId,
          notWork: deviceMatchRules.notWork,
          source: deviceMatchRules.source,
          usageCount: deviceMatchRules.usageCount,
          lastUsedAt: deviceMatchRules.lastUsedAt,
          deletedAt: deviceMatchRules.deletedAt,
          updatedAt: deviceMatchRules.updatedAt,
        })
        .from(deviceMatchRules)
        .where(
          and(
            eq(deviceMatchRules.userId, ctx.device.userId),
            eq(deviceMatchRules.organizationId, orgId),
            input.since
              ? gte(
                  deviceMatchRules.updatedAt,
                  new Date(Date.parse(input.since) - SINCE_OVERLAP_MS),
                )
              : isNull(deviceMatchRules.deletedAt),
            input.since || includeNotWork
              ? undefined
              : eq(deviceMatchRules.notWork, false),
          ),
        )
        .orderBy(deviceMatchRules.updatedAt);

      return {
        serverTime: serverTime.toISOString(),
        projectPatterns,
        rules: includeNotWork
          ? rules
          : rules.map((r) =>
              r.notWork && !r.deletedAt ? { ...r, deletedAt: r.updatedAt } : r,
            ),
      };
    }),

  /**
   * Gem bekræftede regler (idempotent pr. bruger, org, type og mønster).
   * En fjernet regel genopstår, hvis den bekræftes igen.
   */
  upsert: deviceProcedure
    .input(z.object({ rules: z.array(ruleInput).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.device);
      const rows = await upsertDeviceRules(ctx.db, ctx.device, input.rules);
      void publishDataChanged(ctx.device.userId, orgId, [RULES_DOMAIN]);
      return { upserted: rows.length, ids: rows.map((r) => r.id) };
    }),

  /** Fjern regler (tombstone, så andre enheder ser fjernelsen). */
  remove: deviceProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.device);
      const now = new Date();
      const rows = await ctx.db
        .update(deviceMatchRules)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(deviceMatchRules.id, input.ids),
            eq(deviceMatchRules.userId, ctx.device.userId),
            eq(deviceMatchRules.organizationId, orgId),
            isNull(deviceMatchRules.deletedAt),
          ),
        )
        .returning({ id: deviceMatchRules.id });
      if (rows.length > 0) {
        void publishDataChanged(ctx.device.userId, orgId, [RULES_DOMAIN]);
      }
      return { removed: rows.length };
    }),
});

/**
 * Udvidelsens site-koblinger (domæne → projekt/kunde) set fra web: de
 * bekræftede domæne-regler i `device_match_rules`. Skrives med
 * `rules.upsert` (`kind: "domain"`); "ikke arbejde"-domæner er ikke med.
 */
export const extSiteMappingsRouter = router({
  list: deviceProcedure.query(async ({ ctx }) => {
    const orgId = requireOrg(ctx.device);
    const rows = await ctx.db
      .select({
        domain: deviceMatchRules.pattern,
        projectId: deviceMatchRules.projectId,
        clientId: deviceMatchRules.clientId,
        usageCount: deviceMatchRules.usageCount,
        lastUsedAt: deviceMatchRules.lastUsedAt,
      })
      .from(deviceMatchRules)
      .where(
        and(
          eq(deviceMatchRules.userId, ctx.device.userId),
          eq(deviceMatchRules.organizationId, orgId),
          eq(deviceMatchRules.kind, "domain"),
          eq(deviceMatchRules.notWork, false),
          isNull(deviceMatchRules.deletedAt),
        ),
      )
      .orderBy(deviceMatchRules.pattern);
    return rows.map((r) => ({
      domain: r.domain,
      projectId: r.projectId,
      clientId: r.clientId,
      usageCount: r.usageCount,
      lastUsed: r.lastUsedAt?.toISOString() ?? null,
    }));
  }),
});
