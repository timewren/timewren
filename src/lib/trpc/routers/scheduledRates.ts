import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { normalizeBillableRate } from "@/lib/api/time-entry-input";
import { clients, projects, scheduledRateChanges } from "@/lib/db/schema";
import {
  copenhagenToday,
  toScheduledRateChangeLite,
} from "@/lib/rates/scheduled";
import { restampForScheduledChange } from "@/lib/rates/scheduled-service";
import { badRequest, conflict, Errors, notFound } from "../errors";
import { protectedProcedure, router, subscribedProcedure } from "../trpc";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export type ScheduledRateStatus = "planned" | "applied" | "cancelled";

function statusOf(row: {
  appliedAt: Date | null;
  cancelledAt: Date | null;
}): ScheduledRateStatus {
  if (row.cancelledAt) return "cancelled";
  if (row.appliedAt) return "applied";
  return "planned";
}

export const scheduledRatesRouter = router({
  // Én ændring (bruges af REST-sletningen til at tjekke scope)
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.scheduledRateChanges.findFirst({
        where: and(
          eq(scheduledRateChanges.id, input.id),
          ctx.orgId
            ? eq(scheduledRateChanges.organizationId, ctx.orgId)
            : eq(scheduledRateChanges.userId, ctx.session.user.id),
        ),
      });
      if (!row)
        throw notFound(await tr("serverErrors", "scheduledRates.notFound"));
      return { ...row, status: statusOf(row) };
    }),

  // Planlagte (og evt. anvendte/annullerede) satsændringer for en klient
  // eller et projekt, sorteret efter ikrafttrædelse.
  list: protectedProcedure
    .input(
      z
        .object({
          clientId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          includeInactive: z.boolean().optional(),
        })
        .refine((v) => !!v.clientId !== !!v.projectId, {
          error: () => st("zod.clientOrProject"),
        }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const rows = await ctx.db.query.scheduledRateChanges.findMany({
        where: and(
          ctx.orgId
            ? eq(scheduledRateChanges.organizationId, ctx.orgId)
            : eq(scheduledRateChanges.userId, userId),
          input.projectId
            ? eq(scheduledRateChanges.projectId, input.projectId)
            : eq(scheduledRateChanges.clientId, input.clientId as string),
          input.includeInactive
            ? undefined
            : and(
                isNull(scheduledRateChanges.appliedAt),
                isNull(scheduledRateChanges.cancelledAt),
              ),
        ),
        orderBy: [
          asc(scheduledRateChanges.effectiveDate),
          asc(scheduledRateChanges.createdAt),
        ],
        limit: 100,
      });
      return rows.map((row) => ({ ...row, status: statusOf(row) }));
    }),

  // Planlæg en ny timepris fra en dato. Ikke-fakturerede poster dateret
  // på/efter datoen genstemples straks (manuelle overrides røres ikke).
  create: subscribedProcedure
    .input(
      z
        .object({
          clientId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          newRate: z.union([z.string(), z.number()]),
          effectiveDate: z.string(),
        })
        .refine((v) => !!v.clientId !== !!v.projectId, {
          error: () => st("zod.clientOrProject"),
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const newRate = normalizeBillableRate(input.newRate);
      if (newRate === undefined) {
        throw badRequest(await tr("serverErrors", "scheduledRates.rateFormat"));
      }
      if (!isValidDateString(input.effectiveDate)) {
        throw badRequest(await tr("serverErrors", "scheduledRates.dateFormat"));
      }

      // Ejerskab — samme mønster som clients.update / projects.update
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
          columns: { id: true },
        });
        if (!project) throw Errors.projectNotFound();
      } else {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId as string),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) throw Errors.clientNotFound();
      }

      const targetFilter = input.projectId
        ? eq(scheduledRateChanges.projectId, input.projectId)
        : eq(scheduledRateChanges.clientId, input.clientId as string);

      // En ændring kan ikke lægges før en allerede anvendt ændring — så ville
      // tidslinjen for satserne blive tvetydig.
      const laterApplied = await ctx.db.query.scheduledRateChanges.findFirst({
        where: and(
          targetFilter,
          isNotNull(scheduledRateChanges.appliedAt),
          isNull(scheduledRateChanges.cancelledAt),
          gt(scheduledRateChanges.effectiveDate, input.effectiveDate),
        ),
        columns: { effectiveDate: true },
      });
      if (laterApplied) {
        throw conflict(
          await tr("serverErrors", "scheduledRates.laterApplied", {
            date: laterApplied.effectiveDate,
          }),
        );
      }

      // Ændring og genstempling i én transaktion: fejler genstemplingen,
      // findes ændringen heller ikke, så et nyt forsøg starter forfra.
      const { created, restamped } = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(scheduledRateChanges)
          .values({
            userId,
            organizationId: ctx.orgId ?? null,
            clientId: input.projectId ? null : (input.clientId as string),
            projectId: input.projectId ?? null,
            newRate,
            effectiveDate: input.effectiveDate,
          })
          .returning();
        const count = await restampForScheduledChange(
          tx as unknown as typeof ctx.db,
          {
            orgId: ctx.orgId,
            userId,
            clientId: row.clientId,
            projectId: row.projectId,
            effectiveDate: row.effectiveDate,
          },
          { change: toScheduledRateChangeLite(row), existedBefore: false },
        );
        return { created: row, restamped: count };
      });

      return {
        change: { ...created, status: statusOf(created) },
        restamped,
        // Ligger datoen i dag eller tidligere, skrives satsen ind på
        // klienten/projektet ved næste daglige kørsel.
        appliesImmediately: created.effectiveDate <= copenhagenToday(),
      };
    }),

  // Annullér en planlagt (ikke-anvendt) ændring. Poster der blev
  // genstemplet af den, får satsen fra før ændringen igen.
  cancel: subscribedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const existing = await ctx.db.query.scheduledRateChanges.findFirst({
        where: and(
          eq(scheduledRateChanges.id, input.id),
          ctx.orgId
            ? eq(scheduledRateChanges.organizationId, ctx.orgId)
            : eq(scheduledRateChanges.userId, userId),
        ),
      });
      if (!existing)
        throw notFound(await tr("serverErrors", "scheduledRates.notFound"));
      if (existing.cancelledAt) {
        return { success: true, restamped: 0 };
      }
      if (existing.appliedAt) {
        throw conflict(
          await tr("serverErrors", "scheduledRates.alreadyApplied"),
        );
      }

      // Annullering og tilbage-stempling i én transaktion, så en fejl ikke
      // efterlader en annulleret ændring med poster på den nye sats.
      const restamped = await ctx.db.transaction(async (tx) => {
        const [cancelled] = await tx
          .update(scheduledRateChanges)
          .set({ cancelledAt: new Date() })
          .where(
            and(
              eq(scheduledRateChanges.id, existing.id),
              isNull(scheduledRateChanges.appliedAt),
              isNull(scheduledRateChanges.cancelledAt),
            ),
          )
          .returning();
        if (!cancelled) {
          // Cron-jobbet nåede at anvende den imens
          throw conflict(
            await tr("serverErrors", "scheduledRates.appliedMeanwhile"),
          );
        }
        return restampForScheduledChange(
          tx as unknown as typeof ctx.db,
          {
            orgId: ctx.orgId,
            userId,
            clientId: cancelled.clientId,
            projectId: cancelled.projectId,
            effectiveDate: cancelled.effectiveDate,
          },
          { change: toScheduledRateChangeLite(cancelled), existedBefore: true },
        );
      });

      return { success: true, restamped };
    }),
});
