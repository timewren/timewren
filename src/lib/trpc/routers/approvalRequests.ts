import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { PENDING_ELIGIBLE, periodLabel } from "@/lib/approval/eligibility";
import { getMarketingUrl } from "@/lib/config";
import {
  clientPortalAccess,
  clients,
  invoices,
  timeApprovalRequests,
  timeEntries,
} from "@/lib/db/schema";
import { sendApprovalRequestEmail } from "@/lib/email/approval-request";
import { readPortalAccessToken } from "@/lib/portal/access-token";
import { moduleReadProcedure, moduleWriteProcedure, router } from "../trpc";
import { assertClientAccess } from "./clientAccess";

export const approvalRequestsRouter = router({
  /** Freelancer/teamets oversigt over sendte godkendelsesanmodninger. */
  list: moduleReadProcedure("invoices")
    .input(
      z
        .object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
          clientId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgFilter = ctx.orgId
        ? eq(timeApprovalRequests.organizationId, ctx.orgId)
        : eq(timeApprovalRequests.userId, userId);

      const rows = await ctx.db.query.timeApprovalRequests.findMany({
        where: and(
          orgFilter,
          input?.status
            ? eq(timeApprovalRequests.status, input.status)
            : undefined,
          input?.clientId
            ? eq(timeApprovalRequests.clientId, input.clientId)
            : undefined,
        ),
        with: { client: { columns: { id: true, name: true } } },
        orderBy: [desc(timeApprovalRequests.createdAt)],
      });

      return rows.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        clientName: r.client?.name ?? null,
        type: r.type,
        status: r.status,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        invoiceId: r.invoiceId,
        entryCount: (r.entryIds ?? []).length,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt,
        responseNote: r.responseNote,
      }));
    }),

  /** Bundt tidsposter og send dem til klienten for godkendelse. */
  create: moduleWriteProcedure("invoices")
    .input(
      z
        .object({
          clientId: z.string().uuid(),
          type: z.enum(["period", "invoice_draft"]),
          periodStart: z.string().optional(),
          periodEnd: z.string().optional(),
          invoiceId: z.string().uuid().optional(),
        })
        .refine(
          (v) =>
            v.type === "period"
              ? !!v.periodStart && !!v.periodEnd
              : !!v.invoiceId,
          {
            error: () => st("zod.approvalScope"),
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Klient skal tilhøre org'en og være tilgængelig for medlemmet.
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
        columns: { id: true, name: true },
      });
      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.clientNotFound"),
        });
      }
      await assertClientAccess(
        ctx.db,
        userId,
        ctx.orgId ?? null,
        input.clientId,
      );

      // Fælles ejerskabsfilter (org-bredt, ellers egen bruger).
      const ownership = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);

      // Byg eligibility-filteret pr. type. invoice_draft-poster ER fakturerede
      // (isBilled=true mod udkastet), så dér filtreres KUN på prepaid +
      // approval-status; periode-poster skal være ufakturerede. Begge udelukker
      // prepaid (allerede betalt) og poster der allerede afventer/er godkendt.
      let eligibilityWhere: ReturnType<typeof and>;
      if (input.type === "invoice_draft" && input.invoiceId) {
        // Fakturaudkast skal tilhøre org'en + samme klient.
        const invoice = await ctx.db.query.invoices.findFirst({
          where: and(
            eq(invoices.id, input.invoiceId),
            eq(invoices.clientId, input.clientId),
            ctx.orgId
              ? eq(invoices.organizationId, ctx.orgId)
              : eq(invoices.userId, userId),
          ),
          columns: { id: true },
        });
        if (!invoice) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "approval.invoiceDraftNotFound"),
          });
        }
        eligibilityWhere = and(
          ownership,
          eq(timeEntries.invoiceId, input.invoiceId),
          eq(timeEntries.isPrepaid, false),
          inArray(timeEntries.approvalStatus, PENDING_ELIGIBLE),
        );
      } else {
        // UTC-grænser, inklusiv hele slutdagen (codebase gemmer date som
        // timestamp; date-only ISO parses som UTC — undgå lokal-tz-drift).
        const start = new Date(`${input.periodStart}T00:00:00.000Z`);
        const end = new Date(`${input.periodEnd}T23:59:59.999Z`);
        eligibilityWhere = and(
          ownership,
          eq(timeEntries.clientId, input.clientId),
          gte(timeEntries.date, start),
          lte(timeEntries.date, end),
          eq(timeEntries.isBilled, false),
          eq(timeEntries.isPrepaid, false),
          inArray(timeEntries.approvalStatus, PENDING_ELIGIBLE),
        );
      }

      // Atomisk: lås + flip eligible poster til "pending" OG opret anmodningen
      // i samme transaktion. UPDATE...WHERE tager row-locks og re-evaluerer
      // filteret efter låsning, så to samtidige kald får disjunkte sæt — samme
      // post kan ikke bundtes i to anmodninger (lukker race + dobbelt-send).
      const result = await ctx.db.transaction(async (tx) => {
        const locked = await tx
          .update(timeEntries)
          .set({
            approvalStatus: "pending",
            approvedAt: null,
            approvedBy: null,
            rejectedAt: null,
            rejectionReason: null,
          })
          .where(eligibilityWhere)
          .returning({ id: timeEntries.id, hours: timeEntries.hours });

        if (locked.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "approval.noEntries"),
          });
        }

        const ids = locked.map((e) => e.id);
        const [row] = await tx
          .insert(timeApprovalRequests)
          .values({
            userId,
            organizationId: ctx.orgId ?? null,
            clientId: input.clientId,
            type: input.type,
            periodStart: input.periodStart ?? null,
            periodEnd: input.periodEnd ?? null,
            invoiceId: input.invoiceId ?? null,
            status: "pending",
            entryIds: ids,
          })
          .returning();

        return {
          row,
          entryIds: ids,
          totalHours: locked.reduce((sum, e) => sum + Number(e.hours ?? 0), 0),
        };
      });

      const { row: request, entryIds, totalHours } = result;

      // Notificér klientens portal-kontakter der må godkende tid. Org-scopet
      // (clientPortalAccess.organizationId) for konsistens med it.38.
      const portalAccesses = await ctx.db.query.clientPortalAccess.findMany({
        where: and(
          eq(clientPortalAccess.clientId, input.clientId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
          eq(clientPortalAccess.isActive, true),
          eq(clientPortalAccess.canApproveTime, true),
        ),
        columns: {
          email: true,
          accessType: true,
          accessTokenEncrypted: true,
        },
      });

      // Portal-links skal pege på marketing-hosten — /portal bor der efter
      // subdomæne-splittet (app.* redirecter bare tilbage).
      const baseUrl = getMarketingUrl();
      const freelancerName = ctx.session.user.name ?? "En freelancer";
      const label = periodLabel(
        input.type,
        input.periodStart ?? null,
        input.periodEnd ?? null,
      );

      let notified = 0;
      for (const pa of portalAccesses) {
        if (!pa.email) continue;
        const accessToken = readPortalAccessToken(pa);
        const portalUrl =
          pa.accessType === "token" && accessToken
            ? `${baseUrl}/portal/t/${accessToken}`
            : `${baseUrl}/portal/login`;
        try {
          await sendApprovalRequestEmail({
            to: pa.email,
            recipientName: pa.email,
            freelancerName,
            periodLabel: label,
            totalHours,
            entryCount: entryIds.length,
            portalUrl,
            userId,
          });
          notified++;
        } catch (err) {
          // Best-effort: en fejlet mail må ikke rulle anmodningen tilbage.
          console.error(
            "[approvalRequests] Portal-notifikation fejlede:",
            pa.email,
            err,
          );
        }
      }

      return {
        id: request.id,
        entryCount: entryIds.length,
        totalHours,
        notified,
        hasPortalContact: portalAccesses.some((p) => !!p.email),
      };
    }),

  /** Annullér en endnu ubehandlet anmodning og frigiv posterne igen. */
  cancel: moduleWriteProcedure("invoices")
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Atomisk: slet KUN hvis anmodningen stadig er pending + tilhører tenant.
      // DELETE...WHERE status='pending' RETURNING lukker TOCTOU mod en samtidig
      // portal-godkendelse/afvisning (ellers kunne cancel slette en netop
      // godkendt anmodning og frigive dens poster igen).
      const deleted = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .delete(timeApprovalRequests)
          .where(
            and(
              eq(timeApprovalRequests.id, input.requestId),
              eq(timeApprovalRequests.status, "pending"),
              ctx.orgId
                ? eq(timeApprovalRequests.organizationId, ctx.orgId)
                : eq(timeApprovalRequests.userId, userId),
            ),
          )
          .returning();

        if (!row) return null;

        const entryIds = row.entryIds ?? [];
        if (entryIds.length > 0) {
          // Frigiv kun poster der stadig er låst (pending) — og kun inden for
          // anmodningens eget ejerskab (defense-in-depth mod fremmede ids).
          const entryOwnership = row.organizationId
            ? eq(timeEntries.organizationId, row.organizationId)
            : eq(timeEntries.userId, row.userId);
          await tx
            .update(timeEntries)
            .set({ approvalStatus: "not_required" })
            .where(
              and(
                inArray(timeEntries.id, entryIds),
                eq(timeEntries.approvalStatus, "pending"),
                entryOwnership,
              ),
            );
        }
        return row;
      });

      if (!deleted) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "approval.requestNotFound"),
        });
      }

      return { success: true };
    }),
});
