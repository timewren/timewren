import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { supportReplyTemplates } from "@/lib/db/schema";
import { router, supporterProcedure } from "../../trpc";
import { logAdminAction } from "./shared";

function extractVariables(body: string): string[] {
  const matches = body.match(/\{(\w+)\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}

export const adminSupportTemplatesRouter = router({
  listTemplates: supporterProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    return ctx.db.query.supportReplyTemplates.findMany({
      where: or(
        eq(supportReplyTemplates.scope, "system"),
        and(
          eq(supportReplyTemplates.scope, "personal"),
          eq(supportReplyTemplates.createdBy, userId),
        ),
      ),
      orderBy: [supportReplyTemplates.scope, supportReplyTemplates.name],
    });
  }),

  createTemplate: supporterProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        subject: z.string().max(200).optional(),
        body: z.string().min(1),
        scope: z.enum(["system", "personal"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scope === "system" && ctx.userRole !== "admin") {
        throw new Error("Kun admins kan oprette system-skabeloner");
      }

      const variables = extractVariables(input.body);

      const [template] = await ctx.db
        .insert(supportReplyTemplates)
        .values({
          name: input.name,
          subject: input.subject,
          body: input.body,
          variables,
          scope: input.scope,
          createdBy: ctx.session.user.id,
        })
        .returning();

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "create_reply_template",
        null,
        { templateId: template.id, name: input.name, scope: input.scope },
        ctx.headers,
      );

      return template;
    }),

  updateTemplate: supporterProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        subject: z.string().max(200).optional(),
        body: z.string().min(1).optional(),
        scope: z.enum(["system", "personal"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const existing = await ctx.db.query.supportReplyTemplates.findFirst({
        where: eq(supportReplyTemplates.id, id),
      });
      if (!existing) throw new Error("Skabelon ikke fundet");

      if (existing.scope === "system" && ctx.userRole !== "admin") {
        throw new Error("Kun admins kan redigere system-skabeloner");
      }
      if (
        existing.scope === "personal" &&
        existing.createdBy !== ctx.session.user.id
      ) {
        throw new Error("Du kan kun redigere dine egne skabeloner");
      }

      const variables = patch.body ? extractVariables(patch.body) : undefined;

      const [updated] = await ctx.db
        .update(supportReplyTemplates)
        .set({
          ...patch,
          ...(variables ? { variables } : {}),
          updatedAt: new Date(),
        })
        .where(eq(supportReplyTemplates.id, id))
        .returning();

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "update_reply_template",
        null,
        { templateId: id },
        ctx.headers,
      );

      return updated;
    }),

  deleteTemplate: supporterProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.supportReplyTemplates.findFirst({
        where: eq(supportReplyTemplates.id, input.id),
      });
      if (!existing) throw new Error("Skabelon ikke fundet");

      if (existing.scope === "system" && ctx.userRole !== "admin") {
        throw new Error("Kun admins kan slette system-skabeloner");
      }
      if (
        existing.scope === "personal" &&
        existing.createdBy !== ctx.session.user.id
      ) {
        throw new Error("Du kan kun slette dine egne skabeloner");
      }

      await ctx.db
        .delete(supportReplyTemplates)
        .where(eq(supportReplyTemplates.id, input.id));

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "delete_reply_template",
        null,
        { templateId: input.id },
        ctx.headers,
      );

      return { ok: true };
    }),
});
