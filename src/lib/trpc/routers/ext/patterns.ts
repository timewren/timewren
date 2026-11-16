import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { orglessForbiddenMessage } from "@/lib/auth/orgless";
import { clients, deviceLearnedPatterns, projects } from "@/lib/db/schema";
import { publishDataChanged } from "@/lib/realtime";
import { router } from "../../trpc";
import { deviceProcedure } from "./device-procedure";
import { RULES_DOMAIN, SINCE_OVERLAP_MS } from "./rules";

/**
 * Lærte mønstre fra desktop-detektionen (tt-matcher `PatternStore`), så de
 * følger brugeren mellem enheder. Formen er præcis tt-matchers
 * `LearnedPattern` (camelCase): en generaliseret nøgle og stemmerne på den.
 * Nøglen indeholder aldrig en rå titel (D3). Serveren fletter ikke: den
 * gemmer det sidst sendte pr. nøgle; klienten fletter (`PatternStore::merge`)
 * før den sender. Tomme `votes` rydder et mønster.
 */

const keyText = z.string().min(1).max(500);

const patternKey = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("repo"), remote: keyText }),
  z.object({ kind: z.literal("path"), path: keyText }),
  z.object({ kind: z.literal("domain"), domain: keyText }),
  z.object({ kind: z.literal("appKeyword"), app: keyText, keyword: keyText }),
  z.object({
    kind: z.literal("titleTemplate"),
    app: keyText,
    template: keyText,
  }),
]);

const count = z.number().int().min(0).max(1_000_000).default(0);

const vote = z.object({
  /** Tomt mål = "ikke arbejde". */
  target: z.object({
    clientId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
  }),
  weight: z.number().finite().min(0).max(1_000_000),
  confirmations: count,
  corrections: count,
  aiAnswers: count,
});

export const learnedPatternInput = z.object({
  key: patternKey,
  votes: z.array(vote).max(50),
});

type PatternKey = z.infer<typeof patternKey>;

/** Nøglens identitet: sha256 af JSON med sorterede felter. */
export function patternKeyHash(key: PatternKey): string {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(key).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

function requireOrg(orgId: string | null): string {
  if (!orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: orglessForbiddenMessage(),
    });
  }
  return orgId;
}

export const extPatternsRouter = router({
  /** Alle mønstre, eller med `since` (serverTime fra sidste svar) kun ændrede. */
  list: deviceProcedure
    .input(
      z.object({ since: z.string().datetime({ offset: true }).optional() }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.device.orgId);
      const serverTime = new Date();
      const rows = await ctx.db
        .select({
          pattern: deviceLearnedPatterns.pattern,
          votes: deviceLearnedPatterns.votes,
          updatedAt: deviceLearnedPatterns.updatedAt,
        })
        .from(deviceLearnedPatterns)
        .where(
          and(
            eq(deviceLearnedPatterns.userId, ctx.device.userId),
            eq(deviceLearnedPatterns.organizationId, orgId),
            input.since
              ? gte(
                  deviceLearnedPatterns.updatedAt,
                  new Date(Date.parse(input.since) - SINCE_OVERLAP_MS),
                )
              : undefined,
          ),
        )
        .orderBy(deviceLearnedPatterns.updatedAt);
      return {
        serverTime: serverTime.toISOString(),
        patterns: rows.map((r) => ({
          key: r.pattern as PatternKey,
          votes: r.votes as z.infer<typeof vote>[],
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    }),

  /**
   * Gem mønstre (erstatter pr. nøgle). Projekter og kunder i stemmerne skal
   * være org'ens egne.
   */
  upsert: deviceProcedure
    .input(z.object({ patterns: z.array(learnedPatternInput).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.device.orgId);
      const userId = ctx.device.userId;

      const projectIds = new Set<string>();
      const clientIds = new Set<string>();
      for (const p of input.patterns) {
        for (const v of p.votes) {
          if (v.target.projectId) projectIds.add(v.target.projectId);
          if (v.target.clientId) clientIds.add(v.target.clientId);
        }
      }
      const [ownProjects, ownClients] = await Promise.all([
        projectIds.size
          ? ctx.db
              .select({ id: projects.id })
              .from(projects)
              .where(
                and(
                  inArray(projects.id, [...projectIds]),
                  eq(projects.organizationId, orgId),
                ),
              )
          : [],
        clientIds.size
          ? ctx.db
              .select({ id: clients.id })
              .from(clients)
              .where(
                and(
                  inArray(clients.id, [...clientIds]),
                  eq(clients.organizationId, orgId),
                ),
              )
          : [],
      ]);
      if (
        ownProjects.length !== projectIds.size ||
        ownClients.length !== clientIds.size
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "ext.projectOrClientNotFound"),
        });
      }

      const now = new Date();
      // Samme nøgle to gange i ét kald: sidste vinder.
      const byKey = new Map<
        string,
        typeof deviceLearnedPatterns.$inferInsert
      >();
      for (const p of input.patterns) {
        const keyHash = patternKeyHash(p.key);
        byKey.set(keyHash, {
          userId,
          organizationId: orgId,
          keyHash,
          pattern: p.key,
          votes: p.votes,
          createdAt: now,
          updatedAt: now,
        });
      }
      const rows = await ctx.db
        .insert(deviceLearnedPatterns)
        .values([...byKey.values()])
        .onConflictDoUpdate({
          target: [
            deviceLearnedPatterns.userId,
            deviceLearnedPatterns.organizationId,
            deviceLearnedPatterns.keyHash,
          ],
          set: {
            pattern: sql`excluded.pattern`,
            votes: sql`excluded.votes`,
            updatedAt: now,
          },
        })
        .returning({ id: deviceLearnedPatterns.id });

      void publishDataChanged(userId, orgId, [RULES_DOMAIN]);
      return { upserted: rows.length };
    }),
});
