import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { emailTemplates } from "@/lib/db/schema";
import {
  moduleReadProcedure,
  moduleWriteNoSubProcedure,
  protectedProcedure,
  router,
} from "../trpc";

// Email block schema for visual editor
const emailBlockSchema = z.object({
  id: z.string(),
  type: z.enum([
    "header",
    "text",
    "button",
    "divider",
    "image",
    "table",
    "spacer",
    "columns",
    "footer",
  ]),
  content: z.object({
    // Header
    logoUrl: z.string().optional(),
    title: z.string().optional(),
    // Text
    text: z.string().optional(),
    // Button
    buttonText: z.string().optional(),
    buttonUrl: z.string().optional(),
    // Image
    imageUrl: z.string().optional(),
    altText: z.string().optional(),
    // Table
    columns: z.array(z.string()).optional(),
    rows: z.array(z.array(z.string())).optional(),
    // Columns
    columnCount: z.number().min(2).max(3).optional(),
    columnContent: z.array(z.any()).optional(),
  }),
  styles: z
    .object({
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
      padding: z.string().optional(),
      alignment: z.enum(["left", "center", "right"]).optional(),
      fontSize: z.enum(["small", "medium", "large"]).optional(),
    })
    .optional(),
});

const templateTypeEnum = z.enum([
  "invoice",
  "invoice_reminder",
  "portal_welcome",
  "portal_invitation",
  "project_update",
  "prepaid_alert",
  "prepaid_expiry",
  "time_approval",
  "custom",
]);

// Organisationens mailskabeloner: rollens adgang til "templates" (#1116).
// Uden abonnementsvagt, så kun rolleadgangen er ny.
const templatesWriteProcedure = moduleWriteNoSubProcedure("templates");

export const emailTemplatesRouter = router({
  // List all templates for user
  list: moduleReadProcedure("templates")
    .input(
      z.object({
        type: templateTypeEnum.optional(),
        includeInactive: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const templates = await ctx.db.query.emailTemplates.findMany({
        where: input.includeInactive
          ? input.type
            ? and(
                ctx.orgId
                  ? eq(emailTemplates.organizationId, ctx.orgId)
                  : eq(emailTemplates.userId, userId),
                eq(emailTemplates.type, input.type),
              )
            : ctx.orgId
              ? eq(emailTemplates.organizationId, ctx.orgId)
              : eq(emailTemplates.userId, userId)
          : input.type
            ? and(
                ctx.orgId
                  ? eq(emailTemplates.organizationId, ctx.orgId)
                  : eq(emailTemplates.userId, userId),
                eq(emailTemplates.type, input.type),
                eq(emailTemplates.isActive, true),
              )
            : and(
                ctx.orgId
                  ? eq(emailTemplates.organizationId, ctx.orgId)
                  : eq(emailTemplates.userId, userId),
                eq(emailTemplates.isActive, true),
              ),
        orderBy: [desc(emailTemplates.updatedAt)],
      });

      return templates;
    }),

  // Get a specific template
  getById: moduleReadProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const template = await ctx.db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.id, input.id),
          ctx.orgId
            ? eq(emailTemplates.organizationId, ctx.orgId)
            : eq(emailTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "emailTemplates.notFound"));
      }

      return template;
    }),

  // Get default template for a type
  getDefault: moduleReadProcedure("templates")
    .input(z.object({ type: templateTypeEnum }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // First try to find user's default
      let template = await ctx.db.query.emailTemplates.findFirst({
        where: and(
          ctx.orgId
            ? eq(emailTemplates.organizationId, ctx.orgId)
            : eq(emailTemplates.userId, userId),
          eq(emailTemplates.type, input.type),
          eq(emailTemplates.isDefault, true),
          eq(emailTemplates.isActive, true),
        ),
      });

      // If no default found, return first active template of that type
      if (!template) {
        template = await ctx.db.query.emailTemplates.findFirst({
          where: and(
            ctx.orgId
              ? eq(emailTemplates.organizationId, ctx.orgId)
              : eq(emailTemplates.userId, userId),
            eq(emailTemplates.type, input.type),
            eq(emailTemplates.isActive, true),
          ),
          orderBy: [desc(emailTemplates.createdAt)],
        });
      }

      return template;
    }),

  // Create a new template
  create: templatesWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        type: templateTypeEnum,
        subject: z.string().min(1).max(255),
        content: z.array(emailBlockSchema),
        isDefault: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // If this is set as default, unset other defaults for this type
      if (input.isDefault) {
        await ctx.db
          .update(emailTemplates)
          .set({ isDefault: false })
          .where(
            and(
              ctx.orgId
                ? eq(emailTemplates.organizationId, ctx.orgId)
                : eq(emailTemplates.userId, userId),
              eq(emailTemplates.type, input.type),
            ),
          );
      }

      const [created] = await ctx.db
        .insert(emailTemplates)
        .values({
          userId,
          organizationId: ctx.orgId,
          name: input.name,
          type: input.type,
          subject: input.subject,
          content: input.content,
          isDefault: input.isDefault,
        })
        .returning();

      return created;
    }),

  // Update a template
  update: templatesWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        subject: z.string().min(1).max(255).optional(),
        content: z.array(emailBlockSchema).optional(),
        isDefault: z.boolean().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { id, ...updateData } = input;

      // Verify template belongs to user and is not system
      const existing = await ctx.db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.id, id),
          ctx.orgId
            ? eq(emailTemplates.organizationId, ctx.orgId)
            : eq(emailTemplates.userId, userId),
        ),
      });

      if (!existing) {
        throw new Error(await tr("serverErrors", "emailTemplates.notFound"));
      }

      if (existing.isSystem) {
        throw new Error(
          await tr("serverErrors", "emailTemplates.systemNoEdit"),
        );
      }

      // If setting as default, unset others
      if (input.isDefault) {
        await ctx.db
          .update(emailTemplates)
          .set({ isDefault: false })
          .where(
            and(
              ctx.orgId
                ? eq(emailTemplates.organizationId, ctx.orgId)
                : eq(emailTemplates.userId, userId),
              eq(emailTemplates.type, existing.type),
            ),
          );
      }

      const [updated] = await ctx.db
        .update(emailTemplates)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(emailTemplates.id, id))
        .returning();

      return updated;
    }),

  // Duplicate a template
  duplicate: templatesWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const original = await ctx.db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.id, input.id),
          ctx.orgId
            ? eq(emailTemplates.organizationId, ctx.orgId)
            : eq(emailTemplates.userId, userId),
        ),
      });

      if (!original) {
        throw new Error(await tr("serverErrors", "emailTemplates.notFound"));
      }

      const [created] = await ctx.db
        .insert(emailTemplates)
        .values({
          userId,
          organizationId: ctx.orgId,
          name: `${original.name} (kopi)`,
          type: original.type,
          subject: original.subject,
          content: original.content,
          isDefault: false,
          isSystem: false,
        })
        .returning();

      return created;
    }),

  // Delete a template
  delete: templatesWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify template belongs to user and is not system
      const template = await ctx.db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.id, input.id),
          ctx.orgId
            ? eq(emailTemplates.organizationId, ctx.orgId)
            : eq(emailTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "emailTemplates.notFound"));
      }

      if (template.isSystem) {
        throw new Error(
          await tr("serverErrors", "emailTemplates.systemNoDelete"),
        );
      }

      await ctx.db
        .delete(emailTemplates)
        .where(eq(emailTemplates.id, input.id));

      return { success: true };
    }),

  // Set template as default
  setDefault: templatesWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const template = await ctx.db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.id, input.id),
          ctx.orgId
            ? eq(emailTemplates.organizationId, ctx.orgId)
            : eq(emailTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "emailTemplates.notFound"));
      }

      // Unset other defaults for this type
      await ctx.db
        .update(emailTemplates)
        .set({ isDefault: false })
        .where(
          and(
            ctx.orgId
              ? eq(emailTemplates.organizationId, ctx.orgId)
              : eq(emailTemplates.userId, userId),
            eq(emailTemplates.type, template.type),
          ),
        );

      // Set this as default
      const [updated] = await ctx.db
        .update(emailTemplates)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(emailTemplates.id, input.id))
        .returning();

      return updated;
    }),

  // Update usage count (called when template is used)
  incrementUsage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const template = await ctx.db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.id, input.id),
          ctx.orgId
            ? eq(emailTemplates.organizationId, ctx.orgId)
            : eq(emailTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "emailTemplates.notFound"));
      }

      const [updated] = await ctx.db
        .update(emailTemplates)
        .set({
          usageCount: (template.usageCount || 0) + 1,
          lastUsedAt: new Date(),
        })
        .where(eq(emailTemplates.id, input.id))
        .returning();

      return updated;
    }),

  // Get available variables for a template type
  getAvailableVariables: moduleReadProcedure("templates")
    .input(z.object({ type: templateTypeEnum }))
    .query(({ input }) => {
      // Base variables available for all templates
      const baseVariables = {
        "{{firmanavn}}": st("emailTemplates.vars.companyName"),
        "{{dit_navn}}": st("emailTemplates.vars.yourName"),
        "{{din_email}}": st("emailTemplates.vars.yourEmail"),
        "{{din_telefon}}": st("emailTemplates.vars.yourPhone"),
        "{{klientnavn}}": st("emailTemplates.vars.clientFullName"),
        "{{klientfirma}}": st("emailTemplates.vars.clientCompany"),
        "{{klientemail}}": st("emailTemplates.vars.clientEmail"),
        "{{portal_link}}": st("emailTemplates.vars.portalLink"),
      };

      // Type-specific variables
      const typeVariables: Record<string, Record<string, string>> = {
        invoice: {
          "{{fakturanummer}}": st("emailTemplates.vars.invoiceNumber"),
          "{{fakturabeløb}}": st("emailTemplates.vars.totalInclVat"),
          "{{fakturabeløb_uden_moms}}": st("emailTemplates.vars.amountExclVat"),
          "{{fakturadato}}": st("emailTemplates.vars.issueDate"),
          "{{forfaldsdato}}": st("emailTemplates.vars.paymentDeadline"),
          "{{fakturastatus}}": st("emailTemplates.vars.invoiceStatus"),
          "{{faktura_link}}": st("emailTemplates.vars.invoiceLink"),
        },
        invoice_reminder: {
          "{{fakturanummer}}": st("emailTemplates.vars.invoiceNumber"),
          "{{fakturabeløb}}": st("emailTemplates.vars.totalInclVat"),
          "{{forfaldsdato}}": st("emailTemplates.vars.paymentDeadline"),
          "{{dage_forsinket}}": st("emailTemplates.vars.daysLate"),
          "{{faktura_link}}": st("emailTemplates.vars.invoiceLink"),
        },
        project_update: {
          "{{projektnavn}}": st("emailTemplates.vars.projectName"),
          "{{projektstatus}}": st("emailTemplates.vars.projectStatus"),
          "{{projekttimer}}": st("emailTemplates.vars.hoursUsed"),
          "{{projekt_link}}": st("emailTemplates.vars.projectLink"),
        },
        prepaid_alert: {
          "{{klippekort_navn}}": st("emailTemplates.vars.prepaidName"),
          "{{klippekort_saldo}}": st("emailTemplates.vars.hoursRemaining"),
          "{{klippekort_brugt}}": st("emailTemplates.vars.hoursUsed"),
          "{{klippekort_total}}": st("emailTemplates.vars.hoursTotal"),
          "{{klippekort_procent}}": st("emailTemplates.vars.percentUsed"),
        },
        prepaid_expiry: {
          "{{klippekort_navn}}": st("emailTemplates.vars.prepaidName"),
          "{{klippekort_saldo}}": st("emailTemplates.vars.hoursRemaining"),
          "{{klippekort_udløb}}": st("emailTemplates.vars.expiryDate"),
          "{{dage_til_udløb}}": st("emailTemplates.vars.daysToExpiry"),
        },
        time_approval: {
          "{{timer_total}}": st("emailTemplates.vars.hoursForApproval"),
          "{{timer_antal}}": st("emailTemplates.vars.entryCount"),
          "{{periode}}": st("emailTemplates.vars.period"),
          "{{godkend_link}}": st("emailTemplates.vars.approvalLink"),
        },
        portal_welcome: {
          "{{login_link}}": st("emailTemplates.vars.loginLink"),
        },
        portal_invitation: {
          "{{invitation_link}}": st("emailTemplates.vars.invitationLink"),
          "{{udløbsdato}}": st("emailTemplates.vars.invitationExpiry"),
        },
        custom: {},
      };

      return {
        ...baseVariables,
        ...(typeVariables[input.type] || {}),
      };
    }),

  // Create default system templates for new users
  createDefaults: templatesWriteProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Check if user already has templates
    const existing = await ctx.db.query.emailTemplates.findFirst({
      where: ctx.orgId
        ? eq(emailTemplates.organizationId, ctx.orgId)
        : eq(emailTemplates.userId, userId),
    });

    if (existing) {
      return {
        created: 0,
        message: await tr("serverErrors", "emailTemplates.alreadyExist"),
      };
    }

    // Create default templates (tekst på brugerens sprog; pladsholdernøglerne er faste)
    const d = (key: string, values?: Record<string, string>) =>
      tr("serverMisc", `emailTemplates.defaults.${key}`, values);
    const defaultTemplates = [
      {
        name: await d("invoice.name"),
        type: "invoice" as const,
        subject: await d("invoice.subject", {
          number: "{{fakturanummer}}",
          company: "{{firmanavn}}",
        }),
        content: [
          {
            id: "header-1",
            type: "header" as const,
            content: {
              title: await d("invoice.title", { number: "{{fakturanummer}}" }),
            },
            styles: { alignment: "center" as const },
          },
          {
            id: "text-1",
            type: "text" as const,
            content: {
              text: await d("invoice.text", {
                client: "{{klientnavn}}",
                amount: "{{fakturabeløb}}",
                dueDate: "{{forfaldsdato}}",
              }),
            },
            styles: {},
          },
          {
            id: "button-1",
            type: "button" as const,
            content: {
              buttonText: await d("invoice.button"),
              buttonUrl: "{{faktura_link}}",
            },
            styles: { alignment: "center" as const },
          },
          {
            id: "footer-1",
            type: "footer" as const,
            content: {
              text: await d("invoice.footer", {
                yourName: "{{dit_navn}}",
                company: "{{firmanavn}}",
              }),
            },
            styles: {},
          },
        ],
        isDefault: true,
      },
      {
        name: await d("portal.name"),
        type: "portal_invitation" as const,
        subject: await d("portal.subject", { company: "{{firmanavn}}" }),
        content: [
          {
            id: "header-1",
            type: "header" as const,
            content: { title: await d("portal.title") },
            styles: { alignment: "center" as const },
          },
          {
            id: "text-1",
            type: "text" as const,
            content: {
              text: await d("portal.text", {
                client: "{{klientnavn}}",
                company: "{{firmanavn}}",
              }),
            },
            styles: {},
          },
          {
            id: "button-1",
            type: "button" as const,
            content: {
              buttonText: await d("portal.button"),
              buttonUrl: "{{invitation_link}}",
            },
            styles: { alignment: "center" as const },
          },
        ],
        isDefault: true,
      },
    ];

    const created = await ctx.db
      .insert(emailTemplates)
      .values(
        defaultTemplates.map((t) => ({
          userId,
          organizationId: ctx.orgId,
          ...t,
          isSystem: false,
        })),
      )
      .returning();

    return { created: created.length, templates: created };
  }),
});
