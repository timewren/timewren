import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { taskComments, tasks } from "@/lib/db/schema";
import { deleteTaskImageByUrl } from "@/lib/upload/s3";
import { moduleWriteProcedure, protectedProcedure, router } from "../trpc";

export const taskCommentsRouter = router({
  list: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, input.taskId),
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, ctx.session.user.id),
        ),
        columns: { id: true },
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.query.taskComments.findMany({
        where: eq(taskComments.taskId, input.taskId),
        orderBy: [asc(taskComments.createdAt)],
        with: {
          user: {
            columns: { id: true, name: true, image: true },
          },
        },
      });
    }),

  create: moduleWriteProcedure("tasks")
    .input(
      z.object({
        taskId: z.string().uuid(),
        content: z.record(z.string(), z.unknown()),
        contentHtml: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, input.taskId),
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, ctx.session.user.id),
        ),
        columns: { id: true },
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      const cleanHtml = sanitizeHtml(input.contentHtml, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "span"]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ["src", "alt", "width", "height"],
          span: ["class", "data-type", "data-id", "data-label"],
        },
        allowedSchemes: ["http", "https"],
      });

      const [comment] = await ctx.db
        .insert(taskComments)
        .values({
          taskId: input.taskId,
          userId: ctx.session.user.id,
          organizationId: ctx.orgId ?? null,
          content: input.content,
          contentHtml: cleanHtml,
        })
        .returning();

      return comment;
    }),

  update: moduleWriteProcedure("tasks")
    .input(
      z.object({
        id: z.string().uuid(),
        content: z.record(z.string(), z.unknown()),
        contentHtml: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.taskComments.findFirst({
        where: and(
          eq(taskComments.id, input.id),
          eq(taskComments.userId, ctx.session.user.id),
        ),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const cleanHtml = sanitizeHtml(input.contentHtml, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "span"]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ["src", "alt", "width", "height"],
          span: ["class", "data-type", "data-id", "data-label"],
        },
        allowedSchemes: ["http", "https"],
      });

      const [updated] = await ctx.db
        .update(taskComments)
        .set({
          content: input.content,
          contentHtml: cleanHtml,
          updatedAt: new Date(),
        })
        .where(eq(taskComments.id, input.id))
        .returning();

      return updated;
    }),

  delete: moduleWriteProcedure("tasks")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.taskComments.findFirst({
        where: and(
          eq(taskComments.id, input.id),
          eq(taskComments.userId, ctx.session.user.id),
        ),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      // Clean up S3 images from comment content
      if (existing.content && typeof existing.content === "object") {
        type ContentNode = {
          type?: string;
          attrs?: { src?: string };
          content?: ContentNode[];
        };
        const extractImages = (node: ContentNode): string[] => {
          const urls: string[] = [];
          if (node?.type === "image" && node?.attrs?.src)
            urls.push(node.attrs.src);
          if (node?.content)
            for (const child of node.content)
              urls.push(...extractImages(child));
          return urls;
        };
        const imageUrls = extractImages(existing.content as ContentNode);
        await Promise.all(
          imageUrls.map(async (url) => {
            try {
              await deleteTaskImageByUrl(url, ctx.session.user.id);
            } catch (err) {
              console.error("[TaskComments] Kunne ikke slette billede:", err);
            }
          }),
        );
      }

      await ctx.db.delete(taskComments).where(eq(taskComments.id, input.id));
      return { success: true };
    }),
});
