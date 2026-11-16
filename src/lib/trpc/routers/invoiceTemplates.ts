import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { DEFAULT_INVOICE_PRIMARY_COLOR } from "@/lib/brand/tokens";
import { invoiceTemplates } from "@/lib/db/schema";
import {
  moduleReadProcedure,
  moduleWriteProcedure,
  protectedProcedure,
  router,
} from "../trpc";

const templateInput = z.object({
  name: z.string().min(2, { error: () => st("zod.nameMin2") }),
  description: z.string().optional(),
  paymentTermsDays: z.number().min(1).max(365).default(14),
  vatRate: z.string().default("25.00"),
  currency: z.string().default("DKK"),
  headerText: z.string().optional(),
  footerText: z.string().optional(),
  termsText: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankRegNumber: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  // Ingen zod-default: ved opdatering skal en udeladt farve bevare den
  // eksisterende, ikke nulstille den. Nye skabeloner får brandets default.
  primaryColor: z.string().optional(),
  isDefault: z.boolean().default(false),
});

export const invoiceTemplatesRouter = router({
  // Get all templates for the current user
  list: moduleReadProcedure("templates").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const templates = await ctx.db.query.invoiceTemplates.findMany({
      where: ctx.orgId
        ? eq(invoiceTemplates.organizationId, ctx.orgId)
        : eq(invoiceTemplates.userId, userId),
      orderBy: [
        desc(invoiceTemplates.isDefault),
        desc(invoiceTemplates.usageCount),
      ],
    });

    return templates;
  }),

  // Get single template by ID
  getById: moduleReadProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const template = await ctx.db.query.invoiceTemplates.findFirst({
        where: and(
          eq(invoiceTemplates.id, input.id),
          ctx.orgId
            ? eq(invoiceTemplates.organizationId, ctx.orgId)
            : eq(invoiceTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      return template;
    }),

  // Get default template
  getDefault: moduleReadProcedure("templates").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const template = await ctx.db.query.invoiceTemplates.findFirst({
      where: and(
        ctx.orgId
          ? eq(invoiceTemplates.organizationId, ctx.orgId)
          : eq(invoiceTemplates.userId, userId),
        eq(invoiceTemplates.isDefault, true),
      ),
    });

    return template || null;
  }),

  // Create new template
  create: moduleWriteProcedure("templates")
    .input(templateInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // If this is set as default, unset all other defaults
      if (input.isDefault) {
        await ctx.db
          .update(invoiceTemplates)
          .set({ isDefault: false })
          .where(
            ctx.orgId
              ? eq(invoiceTemplates.organizationId, ctx.orgId)
              : eq(invoiceTemplates.userId, userId),
          );
      }

      const [newTemplate] = await ctx.db
        .insert(invoiceTemplates)
        .values({
          userId,
          organizationId: ctx.orgId,
          name: input.name,
          description: input.description || null,
          paymentTermsDays: input.paymentTermsDays,
          vatRate: input.vatRate,
          currency: input.currency,
          headerText: input.headerText || null,
          footerText: input.footerText || null,
          termsText: input.termsText || null,
          bankName: input.bankName || null,
          bankAccount: input.bankAccount || null,
          bankRegNumber: input.bankRegNumber || null,
          logoUrl: input.logoUrl || null,
          primaryColor: input.primaryColor ?? DEFAULT_INVOICE_PRIMARY_COLOR,
          isDefault: input.isDefault,
        })
        .returning();

      return newTemplate;
    }),

  // Update template
  update: moduleWriteProcedure("templates")
    .input(
      z.object({
        id: z.string().uuid(),
        data: templateInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify template belongs to user
      const existingTemplate = await ctx.db.query.invoiceTemplates.findFirst({
        where: and(
          eq(invoiceTemplates.id, input.id),
          ctx.orgId
            ? eq(invoiceTemplates.organizationId, ctx.orgId)
            : eq(invoiceTemplates.userId, userId),
        ),
      });

      if (!existingTemplate) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      // If this is set as default, unset all other defaults
      if (input.data.isDefault && !existingTemplate.isDefault) {
        await ctx.db
          .update(invoiceTemplates)
          .set({ isDefault: false })
          .where(
            ctx.orgId
              ? eq(invoiceTemplates.organizationId, ctx.orgId)
              : eq(invoiceTemplates.userId, userId),
          );
      }

      const [updatedTemplate] = await ctx.db
        .update(invoiceTemplates)
        .set({
          name: input.data.name,
          description: input.data.description || null,
          paymentTermsDays: input.data.paymentTermsDays,
          vatRate: input.data.vatRate,
          currency: input.data.currency,
          headerText: input.data.headerText || null,
          footerText: input.data.footerText || null,
          termsText: input.data.termsText || null,
          bankName: input.data.bankName || null,
          bankAccount: input.data.bankAccount || null,
          bankRegNumber: input.data.bankRegNumber || null,
          logoUrl: input.data.logoUrl || null,
          primaryColor: input.data.primaryColor,
          isDefault: input.data.isDefault,
          updatedAt: new Date(),
        })
        .where(eq(invoiceTemplates.id, input.id))
        .returning();

      return updatedTemplate;
    }),

  // Delete template
  delete: moduleWriteProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify template belongs to user
      const existingTemplate = await ctx.db.query.invoiceTemplates.findFirst({
        where: and(
          eq(invoiceTemplates.id, input.id),
          ctx.orgId
            ? eq(invoiceTemplates.organizationId, ctx.orgId)
            : eq(invoiceTemplates.userId, userId),
        ),
      });

      if (!existingTemplate) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      await ctx.db
        .delete(invoiceTemplates)
        .where(eq(invoiceTemplates.id, input.id));

      return { success: true };
    }),

  // Set template as default
  setDefault: moduleWriteProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify template belongs to user
      const existingTemplate = await ctx.db.query.invoiceTemplates.findFirst({
        where: and(
          eq(invoiceTemplates.id, input.id),
          ctx.orgId
            ? eq(invoiceTemplates.organizationId, ctx.orgId)
            : eq(invoiceTemplates.userId, userId),
        ),
      });

      if (!existingTemplate) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      // Unset all other defaults
      await ctx.db
        .update(invoiceTemplates)
        .set({ isDefault: false })
        .where(
          ctx.orgId
            ? eq(invoiceTemplates.organizationId, ctx.orgId)
            : eq(invoiceTemplates.userId, userId),
        );

      // Set this one as default
      const [updatedTemplate] = await ctx.db
        .update(invoiceTemplates)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(invoiceTemplates.id, input.id))
        .returning();

      return updatedTemplate;
    }),

  // Increment usage count
  incrementUsage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify template belongs to user
      const existingTemplate = await ctx.db.query.invoiceTemplates.findFirst({
        where: and(
          eq(invoiceTemplates.id, input.id),
          ctx.orgId
            ? eq(invoiceTemplates.organizationId, ctx.orgId)
            : eq(invoiceTemplates.userId, userId),
        ),
      });

      if (!existingTemplate) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      await ctx.db
        .update(invoiceTemplates)
        .set({
          usageCount: (existingTemplate.usageCount || 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(invoiceTemplates.id, input.id));

      return { success: true };
    }),
});
