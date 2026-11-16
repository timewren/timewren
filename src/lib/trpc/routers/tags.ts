import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import {
  clients,
  clientTags,
  projects,
  projectTags,
  tags,
  timeEntries,
  timeEntryTags,
} from "@/lib/db/schema";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";
import { getAccessibleClientIds } from "./clientAccess";

const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const tagsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const userTags = await ctx.db.query.tags.findMany({
      where: ctx.orgId
        ? eq(tags.organizationId, ctx.orgId)
        : eq(tags.userId, userId),
      orderBy: [tags.name],
    });

    if (userTags.length === 0) return [];

    const tagIds = userTags.map((t) => t.id);

    // Count usage across all three junction tables
    const entryCounts = await ctx.db
      .select({
        tagId: timeEntryTags.tagId,
        count: sql<number>`count(*)::int`,
      })
      .from(timeEntryTags)
      .where(inArray(timeEntryTags.tagId, tagIds))
      .groupBy(timeEntryTags.tagId);

    const projectCounts = await ctx.db
      .select({
        tagId: projectTags.tagId,
        count: sql<number>`count(*)::int`,
      })
      .from(projectTags)
      .where(inArray(projectTags.tagId, tagIds))
      .groupBy(projectTags.tagId);

    const clientCounts = await ctx.db
      .select({
        tagId: clientTags.tagId,
        count: sql<number>`count(*)::int`,
      })
      .from(clientTags)
      .where(inArray(clientTags.tagId, tagIds))
      .groupBy(clientTags.tagId);

    const entryMap = new Map(entryCounts.map((c) => [c.tagId, c.count]));
    const projectMap = new Map(projectCounts.map((c) => [c.tagId, c.count]));
    const clientMap = new Map(clientCounts.map((c) => [c.tagId, c.count]));

    return userTags.map((t) => ({
      ...t,
      usage: {
        entries: entryMap.get(t.id) ?? 0,
        projects: projectMap.get(t.id) ?? 0,
        clients: clientMap.get(t.id) ?? 0,
      },
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50),
        color: z
          .string()
          .regex(COLOR_REGEX, { error: () => st("zod.invalidHexColor") }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const trimmedName = input.name.trim();

      // Check for existing tag with same name (avoids raw PG error)
      const existing = await ctx.db.query.tags.findFirst({
        where: and(
          ctx.orgId
            ? eq(tags.organizationId, ctx.orgId)
            : eq(tags.userId, ctx.session.user.id),
          eq(tags.name, trimmedName),
        ),
        columns: { id: true },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr("serverErrors", "tags.nameExists", {
            name: trimmedName,
          }),
        });
      }

      const [tag] = await ctx.db
        .insert(tags)
        .values({
          userId: ctx.session.user.id,
          organizationId: ctx.orgId,
          name: trimmedName,
          color: input.color,
        })
        .returning();
      return tag;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(50).optional(),
        color: z.string().regex(COLOR_REGEX).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.name !== undefined) updateData.name = data.name.trim();
      if (data.color !== undefined) updateData.color = data.color;

      // Check for name conflict if renaming
      if (data.name !== undefined) {
        const trimmedName = data.name.trim();
        const conflict = await ctx.db.query.tags.findFirst({
          where: and(
            ctx.orgId
              ? eq(tags.organizationId, ctx.orgId)
              : eq(tags.userId, ctx.session.user.id),
            eq(tags.name, trimmedName),
          ),
          columns: { id: true },
        });
        if (conflict && conflict.id !== id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr("serverErrors", "tags.nameExists", {
              name: trimmedName,
            }),
          });
        }
      }

      const [tag] = await ctx.db
        .update(tags)
        .set(updateData)
        .where(
          and(
            eq(tags.id, id),
            ctx.orgId
              ? eq(tags.organizationId, ctx.orgId)
              : eq(tags.userId, ctx.session.user.id),
          ),
        )
        .returning();
      return tag;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(tags)
        .where(
          and(
            eq(tags.id, input.id),
            ctx.orgId
              ? eq(tags.organizationId, ctx.orgId)
              : eq(tags.userId, ctx.session.user.id),
          ),
        );
      return { success: true };
    }),

  setForEntry: protectedProcedure
    .input(
      z.object({
        entryId: z.string().uuid(),
        tagIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership — a member may only tag their OWN time entries, never
      // a colleague's (consistent with the time-mutation model: members modify
      // only their own entries).
      const entry = await ctx.db.query.timeEntries.findFirst({
        where: and(
          eq(timeEntries.id, input.entryId),
          eq(timeEntries.userId, ctx.session.user.id),
        ),
      });
      if (!entry)
        throw new Error(await tr("serverErrors", "tags.timeEntryNotFound"));

      // Verify all provided tags belong to the caller
      if (input.tagIds.length > 0) {
        const ownedTags = await ctx.db.query.tags.findMany({
          where: and(
            inArray(tags.id, input.tagIds),
            ctx.orgId
              ? eq(tags.organizationId, ctx.orgId)
              : eq(tags.userId, ctx.session.user.id),
          ),
          columns: { id: true },
        });
        if (ownedTags.length !== input.tagIds.length) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "tags.notYours"),
          });
        }
      }

      // Load currently inherited tags so we can avoid PK violations when
      // the user manually selects a tag that is already inherited.
      const inherited = await ctx.db.query.timeEntryTags.findMany({
        where: and(
          eq(timeEntryTags.entryId, input.entryId),
          eq(timeEntryTags.inherited, true),
        ),
        columns: { tagId: true },
      });
      const inheritedIds = new Set(inherited.map((r) => r.tagId));

      // Filter out tags that already exist as inherited — they're already
      // on the entry, no need to insert them again as manual.
      const newManualTagIds = input.tagIds.filter(
        (id) => !inheritedIds.has(id),
      );

      // Atomic: delete existing manual + insert new manual in one transaction
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(timeEntryTags)
          .where(
            and(
              eq(timeEntryTags.entryId, input.entryId),
              eq(timeEntryTags.inherited, false),
            ),
          );

        if (newManualTagIds.length > 0) {
          await tx.insert(timeEntryTags).values(
            newManualTagIds.map((tagId) => ({
              entryId: input.entryId,
              tagId,
              inherited: false,
            })),
          );
        }
      });

      return { success: true };
    }),

  setForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        tagIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, ctx.session.user.id),
        ),
      });
      if (!project)
        throw new Error(await tr("serverErrors", "tags.projectNotFound"));

      // Verify all provided tags belong to the caller
      if (input.tagIds.length > 0) {
        const ownedTags = await ctx.db.query.tags.findMany({
          where: and(
            inArray(tags.id, input.tagIds),
            ctx.orgId
              ? eq(tags.organizationId, ctx.orgId)
              : eq(tags.userId, ctx.session.user.id),
          ),
          columns: { id: true },
        });
        if (ownedTags.length !== input.tagIds.length) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "tags.notYours"),
          });
        }
      }

      await ctx.db
        .delete(projectTags)
        .where(eq(projectTags.projectId, input.projectId));

      if (input.tagIds.length > 0) {
        await ctx.db.insert(projectTags).values(
          input.tagIds.map((tagId) => ({
            projectId: input.projectId,
            tagId,
          })),
        );
      }

      return { success: true };
    }),

  /**
   * Sæt tags på FLERE projekter (projektlistens bulk-bar). mode "add" lægger
   * de valgte oveni de eksisterende, "replace" sætter præcis de valgte.
   * Kun projekter og tags der tilhører kalderen røres.
   */
  setForProjectsBulk: orgAdminProcedure
    .input(
      z.object({
        projectIds: z.array(z.string().uuid()).min(1).max(500),
        tagIds: z.array(z.string().uuid()).max(50),
        mode: z.enum(["add", "replace"]).default("add"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // Dubletter ville ellers få ejerskabstjekket nedenfor til at fejle
      const tagIds = [...new Set(input.tagIds)];
      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      const ownedProjects = await ctx.db.query.projects.findMany({
        where: and(inArray(projects.id, input.projectIds), ownershipFilter),
        columns: { id: true, clientId: true },
      });
      // Klient-begrænsede medlemmer må kun røre projekter for de kunder de
      // har adgang til — samme regel som resten af projects-routeren.
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, userId, ctx.orgId)
        : null;
      const allowedProjects =
        accessibleIds === null
          ? ownedProjects
          : ownedProjects.filter(
              (p) => p.clientId === null || accessibleIds.includes(p.clientId),
            );
      if (allowedProjects.length !== input.projectIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "tags.projectsNotFound"),
        });
      }
      if (tagIds.length > 0) {
        const ownedTags = await ctx.db.query.tags.findMany({
          where: and(
            inArray(tags.id, tagIds),
            ctx.orgId
              ? eq(tags.organizationId, ctx.orgId)
              : eq(tags.userId, userId),
          ),
          columns: { id: true },
        });
        if (ownedTags.length !== tagIds.length) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "tags.notYours"),
          });
        }
      }
      const ids = allowedProjects.map((p) => p.id);
      await ctx.db.transaction(async (tx) => {
        if (input.mode === "replace") {
          await tx
            .delete(projectTags)
            .where(inArray(projectTags.projectId, ids));
        } else if (tagIds.length > 0) {
          // Undgå dubletter i junction-tabellen ved "tilføj"
          await tx
            .delete(projectTags)
            .where(
              and(
                inArray(projectTags.projectId, ids),
                inArray(projectTags.tagId, tagIds),
              ),
            );
        }
        if (input.tagIds.length > 0) {
          await tx
            .insert(projectTags)
            .values(
              ids.flatMap((projectId) =>
                input.tagIds.map((tagId) => ({ projectId, tagId })),
              ),
            );
        }
      });
      return { success: true, count: ids.length };
    }),

  setForClient: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        tagIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, ctx.session.user.id),
        ),
      });
      if (!client)
        throw new Error(await tr("serverErrors", "tags.clientNotFound"));

      // Verify all provided tags belong to the caller
      if (input.tagIds.length > 0) {
        const ownedTags = await ctx.db.query.tags.findMany({
          where: and(
            inArray(tags.id, input.tagIds),
            ctx.orgId
              ? eq(tags.organizationId, ctx.orgId)
              : eq(tags.userId, ctx.session.user.id),
          ),
          columns: { id: true },
        });
        if (ownedTags.length !== input.tagIds.length) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "tags.notYours"),
          });
        }
      }

      await ctx.db
        .delete(clientTags)
        .where(eq(clientTags.clientId, input.clientId));

      if (input.tagIds.length > 0) {
        await ctx.db.insert(clientTags).values(
          input.tagIds.map((tagId) => ({
            clientId: input.clientId,
            tagId,
          })),
        );
      }

      return { success: true };
    }),
});
