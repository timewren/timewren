import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { isUniqueViolation } from "@/lib/db/pg-errors";
import {
  clients,
  invoiceTemplates,
  prepaidPackages,
  projects,
  recurringInvoiceRuns,
  recurringInvoices,
} from "@/lib/db/schema";
import {
  anchorDayOf,
  fixedLinesTotal,
  isRecurringInvoiceInterval,
  RECURRING_INVOICE_INTERVALS,
  RECURRING_INVOICE_MODES,
  rollForwardRunDate,
} from "@/lib/recurring-invoices/schedule";
import {
  copenhagenToday,
  isDateStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import { badRequest, Errors, notFound } from "../errors";
import { moduleReadProcedure, moduleWriteProcedure, router } from "../trpc";
import { assertClientAccess, getAccessibleClientIds } from "./clientAccess";

// Gentagne fakturaer / retainere (#198). Skabelonerne opretter KLADDER via
// cron (/api/cron/recurring-invoices) eller via klippekort-fornyelsen, når
// skabelonen er koblet til et periodisk klippekort. Kun planer med
// fakturering (Selvstændig+) — moduleWriteProcedure("invoices") gater.

const decimalString = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .refine(
    (v) => {
      const n = Number(v);
      return Number.isFinite(n) && Math.abs(n) < 100_000_000;
    },
    { error: () => st("zod.invalidNumber") },
  );

const lineSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, { error: () => st("zod.descriptionMissing") })
    .max(500),
  quantity: decimalString,
  unitPrice: decimalString,
});

const dateStr = z
  .string()
  .refine((v) => isDateStr(v), { error: () => st("zod.invalidDateFormat") });

const templateInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => st("zod.nameMissing") })
    .max(255),
  clientId: z.string().uuid({ error: () => st("zod.selectClient") }),
  projectId: z.string().uuid().nullable().optional(),
  prepaidPackageId: z.string().uuid().nullable().optional(),
  billingMode: z.enum(RECURRING_INVOICE_MODES),
  lines: z.array(lineSchema).max(50),
  invoiceTemplateId: z.string().uuid().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  interval: z.enum(RECURRING_INVOICE_INTERVALS),
  /** Første (næste) kørselsdato. Ignoreres ved kobling til klippekort. */
  nextRunDate: dateStr,
});

type TemplateInput = z.infer<typeof templateInput>;

interface ScopeCtx {
  db: typeof import("@/lib/db").db;
  orgId: string | null;
  userId: string;
}

function scopeFilter(ctx: { orgId: string | null; userId: string }) {
  return ctx.orgId
    ? eq(recurringInvoices.organizationId, ctx.orgId)
    : eq(recurringInvoices.userId, ctx.userId);
}

/**
 * Valider og normalisér input mod brugerens scope. Returnerer de felter der
 * skal skrives — inkl. interval/næste dato afledt af et koblet klippekort.
 */
async function resolveTemplateFields(ctx: ScopeCtx, input: TemplateInput) {
  const client = await ctx.db.query.clients.findFirst({
    where: and(
      eq(clients.id, input.clientId),
      ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, ctx.userId),
    ),
    columns: { id: true, isArchived: true },
  });
  if (!client) throw Errors.clientNotFound();
  if (client.isArchived) {
    throw badRequest(
      await tr("serverErrors", "recurringInvoices.clientArchived"),
    );
  }
  await assertClientAccess(ctx.db, ctx.userId, ctx.orgId, input.clientId);

  const projectId = input.projectId ?? null;
  if (projectId) {
    const project = await ctx.db.query.projects.findFirst({
      where: and(
        eq(projects.id, projectId),
        eq(projects.clientId, input.clientId),
        ctx.orgId
          ? eq(projects.organizationId, ctx.orgId)
          : eq(projects.userId, ctx.userId),
      ),
      columns: { id: true },
    });
    if (!project) throw Errors.projectNotFound();
  }

  const invoiceTemplateId = input.invoiceTemplateId ?? null;
  if (invoiceTemplateId) {
    const tpl = await ctx.db.query.invoiceTemplates.findFirst({
      where: and(
        eq(invoiceTemplates.id, invoiceTemplateId),
        ctx.orgId
          ? eq(invoiceTemplates.organizationId, ctx.orgId)
          : eq(invoiceTemplates.userId, ctx.userId),
      ),
      columns: { id: true },
    });
    if (!tpl)
      throw badRequest(await tr("serverErrors", "invoices.templateNotFound"));
  }

  const prepaidPackageId = input.prepaidPackageId ?? null;
  let interval: string = input.interval;
  let nextRunDate = input.nextRunDate;
  if (prepaidPackageId) {
    if (input.billingMode === "time") {
      throw badRequest(
        await tr("serverErrors", "recurringInvoices.prepaidFixedAmount"),
      );
    }
    const pkg = await ctx.db.query.prepaidPackages.findFirst({
      where: and(
        eq(prepaidPackages.id, prepaidPackageId),
        eq(prepaidPackages.clientId, input.clientId),
        eq(prepaidPackages.isActive, true),
        ctx.orgId
          ? eq(prepaidPackages.organizationId, ctx.orgId)
          : eq(prepaidPackages.userId, ctx.userId),
      ),
      columns: { renewalInterval: true, renewalNextAt: true },
    });
    if (!pkg) throw Errors.prepaidNotFound();
    if (
      !pkg.renewalInterval ||
      !pkg.renewalNextAt ||
      !isRecurringInvoiceInterval(pkg.renewalInterval)
    ) {
      throw badRequest(
        await tr("serverErrors", "recurringInvoices.prepaidNoRenewal"),
      );
    }
    // Kalenderen følger klippekortet; fornyelsen opretter kladden
    interval = pkg.renewalInterval;
    nextRunDate = toCopenhagenDateStr(pkg.renewalNextAt);
  } else if (input.billingMode === "fixed") {
    if (input.lines.length === 0 || fixedLinesTotal(input.lines) <= 0) {
      throw badRequest(await tr("serverErrors", "recurringInvoices.needLine"));
    }
  }

  return {
    name: input.name,
    clientId: input.clientId,
    projectId: input.billingMode === "time" ? projectId : null,
    prepaidPackageId,
    billingMode: input.billingMode,
    lines: input.lines,
    invoiceTemplateId,
    paymentTermsDays: input.paymentTermsDays ?? null,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    interval,
    anchorDay: anchorDayOf(nextRunDate),
    nextRunDate,
  };
}

function rethrowPrepaidConflict(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw badRequest(st("recurringInvoices.prepaidAlreadyRecurring"));
  }
  throw err;
}

export const recurringInvoicesRouter = router({
  /** Aktive (ikke-slettede) skabeloner, sorteret efter næste kørselsdato. */
  list: moduleReadProcedure("invoices")
    .input(z.object({ clientId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId ?? null;
      const accessible = orgId
        ? await getAccessibleClientIds(ctx.db, userId, orgId)
        : null;
      if (accessible && accessible.length === 0) return [];

      const rows = await ctx.db.query.recurringInvoices.findMany({
        where: and(
          scopeFilter({ orgId, userId }),
          eq(recurringInvoices.isArchived, false),
          input?.clientId
            ? eq(recurringInvoices.clientId, input.clientId)
            : undefined,
          accessible
            ? inArray(recurringInvoices.clientId, accessible)
            : undefined,
        ),
        orderBy: [asc(recurringInvoices.nextRunDate)],
        with: {
          client: { columns: { id: true, name: true } },
          project: { columns: { id: true, name: true } },
          prepaidPackage: {
            columns: {
              id: true,
              name: true,
              renewalNextAt: true,
              hourlyRate: true,
              renewalBaseHours: true,
              totalHours: true,
            },
          },
        },
      });
      if (rows.length === 0) return [];

      // Seneste kladde pr. skabelon — til "Sidst oprettet" i listen
      const runs = await ctx.db.query.recurringInvoiceRuns.findMany({
        where: inArray(
          recurringInvoiceRuns.recurringInvoiceId,
          rows.map((r) => r.id),
        ),
        columns: {
          recurringInvoiceId: true,
          periodStart: true,
          periodEnd: true,
          invoiceId: true,
          createdAt: true,
        },
      });
      const lastRun = new Map<string, (typeof runs)[number]>();
      for (const run of runs) {
        const prev = lastRun.get(run.recurringInvoiceId);
        if (!prev || run.periodStart > prev.periodStart) {
          lastRun.set(run.recurringInvoiceId, run);
        }
      }

      return rows.map((r) => ({
        ...r,
        lastRun: lastRun.get(r.id) ?? null,
      }));
    }),

  create: moduleWriteProcedure("invoices")
    .input(templateInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId ?? null;
      const fields = await resolveTemplateFields(
        { db: ctx.db, orgId, userId },
        input,
      );
      if (!fields.prepaidPackageId && fields.nextRunDate < copenhagenToday()) {
        throw badRequest(
          await tr("serverErrors", "recurringInvoices.firstDateInPast"),
        );
      }
      try {
        const [row] = await ctx.db
          .insert(recurringInvoices)
          .values({ ...fields, userId, organizationId: orgId })
          .returning();
        return row;
      } catch (err) {
        rethrowPrepaidConflict(err);
      }
    }),

  update: moduleWriteProcedure("invoices")
    .input(templateInput.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId ?? null;
      const existing = await ctx.db.query.recurringInvoices.findFirst({
        where: and(
          eq(recurringInvoices.id, input.id),
          scopeFilter({ orgId, userId }),
          eq(recurringInvoices.isArchived, false),
        ),
      });
      if (!existing)
        throw notFound(await tr("serverErrors", "recurringInvoices.notFound"));
      await assertClientAccess(ctx.db, userId, orgId, existing.clientId);

      const fields = await resolveTemplateFields(
        { db: ctx.db, orgId, userId },
        input,
      );
      if (
        !fields.prepaidPackageId &&
        fields.nextRunDate !== existing.nextRunDate &&
        fields.nextRunDate < copenhagenToday()
      ) {
        throw badRequest(
          await tr("serverErrors", "recurringInvoices.nextDateInPast"),
        );
      }
      // Uændret dato: bevar ankerdagen. En aftale fra den 31. hvis næste
      // kørsel er 28/2 må ikke blive til "den 28." ved fx en omdøbning.
      if (fields.nextRunDate === existing.nextRunDate) {
        fields.anchorDay = existing.anchorDay;
      }
      try {
        const [row] = await ctx.db
          .update(recurringInvoices)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(recurringInvoices.id, existing.id))
          .returning();
        return row;
      } catch (err) {
        rethrowPrepaidConflict(err);
      }
    }),

  /**
   * Pause/genoptag. Ved genoptagelse springes perioder der lå i pausen over:
   * næste dato rykkes frem til første dato i rytmen fra og med i dag.
   */
  setPaused: moduleWriteProcedure("invoices")
    .input(z.object({ id: z.string().uuid(), paused: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId ?? null;
      const existing = await ctx.db.query.recurringInvoices.findFirst({
        where: and(
          eq(recurringInvoices.id, input.id),
          scopeFilter({ orgId, userId }),
          eq(recurringInvoices.isArchived, false),
        ),
      });
      if (!existing)
        throw notFound(await tr("serverErrors", "recurringInvoices.notFound"));
      await assertClientAccess(ctx.db, userId, orgId, existing.clientId);

      let nextRunDate = existing.nextRunDate;
      if (
        !input.paused &&
        !existing.prepaidPackageId &&
        isRecurringInvoiceInterval(existing.interval)
      ) {
        nextRunDate = rollForwardRunDate(
          existing.nextRunDate,
          existing.interval,
          existing.anchorDay,
          copenhagenToday(),
        );
      }
      const [row] = await ctx.db
        .update(recurringInvoices)
        .set({ isPaused: input.paused, nextRunDate, updatedAt: new Date() })
        .where(eq(recurringInvoices.id, existing.id))
        .returning();
      return row;
    }),

  /**
   * Slet skabelonen. Arkiveres (data slettes aldrig hårdt); allerede
   * oprettede kladder og fakturaer røres ikke.
   */
  delete: moduleWriteProcedure("invoices")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId ?? null;
      const existing = await ctx.db.query.recurringInvoices.findFirst({
        where: and(
          eq(recurringInvoices.id, input.id),
          scopeFilter({ orgId, userId }),
          eq(recurringInvoices.isArchived, false),
        ),
        columns: { id: true, clientId: true },
      });
      if (!existing)
        throw notFound(await tr("serverErrors", "recurringInvoices.notFound"));
      await assertClientAccess(ctx.db, userId, orgId, existing.clientId);
      await ctx.db
        .update(recurringInvoices)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(eq(recurringInvoices.id, existing.id));
      return { success: true };
    }),
});
