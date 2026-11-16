import { and, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { toIntlLocale } from "@/i18n/format-locale";
import { activeLocale, st, tr } from "@/i18n/server-text";
import {
  loadInvoiceNudges,
  loadInvoicePreview,
} from "@/lib/adoption/nudge-data";
import {
  clients,
  companyProfiles,
  emailPreferences,
  invoiceLines,
  invoices,
  invoiceTemplates,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { sendFirstInvoiceEmail } from "@/lib/email/engagement";
import { sendInvoiceEmail } from "@/lib/email/invoice";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { roundMoney, sumMoney } from "@/lib/format";
import {
  buildInvoicePdfProps,
  renderInvoicePdfBuffer,
} from "@/lib/invoice-pdf";
import {
  draftInvoiceNumber,
  isDraftInvoiceNumber,
} from "@/lib/invoices/draft-number";
import { lockInvoiceStatus } from "@/lib/invoices/lock-status";
import { INVOICE_PREVIEW_PERIODS } from "@/lib/invoicing/invoice-preview";
import { RESOLVED_CLIENT_ID } from "@/lib/invoicing/unbilled";
import { logOrgAudit } from "@/lib/org-audit";
import { formatDanishDate } from "@/lib/recurring-invoices/schedule";
import { trackEvent } from "@/lib/telemetry/track";
import { copenhagenToday, entryDateFromStr } from "@/lib/time/copenhagen";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { badRequest, Errors } from "../errors";
import { moduleReadProcedure, moduleWriteProcedure, router } from "../trpc";
import { assertClientAccess, getAccessibleClientIds } from "./clientAccess";

/**
 * Compute the next "INV-NNN" invoice number for a given user or org.
 *
 * When `orgId` is provided the sequence is scoped to the organization so all
 * members share one sequential numbering. Falls back to per-user scope.
 *
 * Finds the maximum trailing integer across all existing invoice numbers
 * (regardless of prefix: "INV-042", "2025-042" and "0042" all contribute 42).
 * This is robust to:
 * - Backdated imports: ordering is by numeric suffix, not createdAt.
 * - Custom formats in imports: regex extracts any trailing digits.
 * - Garbage values: rows without trailing digits contribute 0.
 *
 * Concurrency is handled by a per-user/org transaction advisory lock plus the
 * existing unique constraint as a last-resort collision guard. Callers must
 * already be inside a transaction.
 */
export async function computeNextInvoiceNumber(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx typing is complex
  tx: any,
  userId: string,
  orgId?: string | null,
): Promise<string> {
  // Serialize concurrent invoice creation for this user/org inside the current
  // transaction. hashtextextended returns a stable bigint for any text.
  const scopeKey = orgId || userId;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`,
  );

  // When orgId is available, scope exclusively to the org so each organization
  // gets its own independent invoice number sequence. Pre-org invoices
  // (organization_id = null) are excluded — they belong to a different scope.
  // When there is no org, fall back to per-user scope (backwards compatible).
  const result = orgId
    ? await tx.execute(sql`
        SELECT COALESCE(
          MAX(CAST(SUBSTRING(invoice_number FROM '(\\d+)$') AS INTEGER)),
          0
        )::int AS max_num
        FROM invoices
        WHERE organization_id = ${orgId}
          AND invoice_number NOT LIKE 'UDKAST-%'
      `)
    : await tx.execute(sql`
        SELECT COALESCE(
          MAX(CAST(SUBSTRING(invoice_number FROM '(\\d+)$') AS INTEGER)),
          0
        )::int AS max_num
        FROM invoices
        WHERE user_id = ${userId}
          AND invoice_number NOT LIKE 'UDKAST-%'
      `);

  // postgres-js returns rows directly as an array
  const rows = result as { max_num: number }[];
  const maxNumber = rows[0]?.max_num ?? 0;
  return `INV-${(maxNumber + 1).toString().padStart(3, "0")}`;
}

/**
 * Tildel det rigtige, fortlobende fakturanummer ved udstedelse (#196).
 * Kladder baerer et UDKAST-placeholder; forst her forbruges et nummer af
 * serien. No-op for fakturaer der allerede har et rigtigt nummer
 * (grandfathered kladder / gensend). Skal koeres i en transaktion.
 */
export async function ensureRealInvoiceNumber(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx typing is complex
  tx: any,
  invoice: { id: string; invoiceNumber: string },
  userId: string,
  orgId?: string | null,
): Promise<string> {
  if (!isDraftInvoiceNumber(invoice.invoiceNumber)) {
    return invoice.invoiceNumber;
  }
  const invoiceNumber = await computeNextInvoiceNumber(tx, userId, orgId);
  await tx
    .update(invoices)
    .set({ invoiceNumber, updatedAt: new Date() })
    .where(eq(invoices.id, invoice.id));
  return invoiceNumber;
}

/**
 * Forfaldsdato-fallback (#201): kunde-betingelser -> templatens
 * paymentTermsDays -> 14 dage. Bruges når dueDate ikke angives eksplicit.
 */
function addDays(base: Date, days: number): Date {
  // UTC-aritmetik: fakturadatoer gemmes som UTC-midnat, så resultatet må
  // ikke afhænge af processens TZ eller sommertid (#649)
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Custom validator for monetary amounts
const monetaryAmount = z
  .string()
  .min(1, { error: () => st("zod.amountRequired") })
  .refine(
    (val) => {
      const num = parseFloat(val);
      return !Number.isNaN(num) && num > 0;
    },
    { error: () => st("zod.amountPositive") },
  )
  .refine(
    (val) => {
      const num = parseFloat(val);
      return num <= 100_000_000; // Max 100 million
    },
    { error: () => st("zod.amountTooLarge") },
  )
  .refine(
    (val) => {
      // Max 2 decimal places
      const parts = val.split(".");
      return parts.length === 1 || (parts[1] && parts[1].length <= 2);
    },
    { error: () => st("zod.amountDecimals") },
  );

const invoiceInput = z.object({
  clientId: z.string().uuid({ error: () => st("zod.selectClient") }),
  amount: monetaryAmount,
  status: z
    .enum(["draft", "sent", "paid", "overdue"])
    .default("draft")
    .optional(),
  issueDate: z
    .string()
    .min(1, { error: () => st("zod.issueDateRequired") })
    .max(30),
  dueDate: z.string().max(30).optional(),
  templateId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
  timeEntryIds: z.array(z.string().uuid()).optional(),
});

const updateInvoiceInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "sent", "paid", "overdue"]).optional(),
  amount: monetaryAmount.optional(),
  templateId: z.string().uuid().nullable().optional(),
  dueDate: z.string().max(30).optional(),
  paidDate: z.string().max(30).optional(),
  notes: z.string().max(5000).optional(),
  // Billy-faktura der allerede findes (fx oprettet i Billy), så betalingssync
  // kan følge den. Metadata — tilladt også på udstedte fakturaer.
  billyInvoiceId: z.string().min(1).max(255).nullable().optional(),
});

// Invoice state machine - defines valid status transitions
type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "deleted";

const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "deleted"], // Draft can be sent or deleted
  // En udstedt faktura er laast (#195) — sent kan IKKE trakkes tilbage til
  // kladde; rettelser sker via kreditnota (dansk momskrav).
  sent: ["paid", "overdue"],
  overdue: ["paid", "sent"], // Overdue can be paid or extended (back to sent)
  paid: [], // Paid is a final state - no further transitions
  deleted: [], // Deleted is a final state - no further transitions
};

function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from]?.includes(to) ?? false;
}

function getTransitionError(from: InvoiceStatus, to: InvoiceStatus): string {
  const statusNames: Record<InvoiceStatus, string> = {
    draft: st("invoices.status.draft"),
    sent: st("invoices.status.sent"),
    paid: st("invoices.status.paid"),
    overdue: st("invoices.status.overdue"),
    deleted: st("invoices.status.deleted"),
  };

  if (from === "paid") {
    return st("invoices.transition.paid");
  }
  if (from === "deleted") {
    return st("invoices.transition.deleted");
  }
  return st("invoices.transition.generic", {
    from: statusNames[from],
    to: statusNames[to],
  });
}

// Recompute an invoice's stored total from its current lines. saveLines does
// this inline; the granular line ops (createLine/updateLine/deleteLine) must
// too, or invoice.amount drifts out of sync with the visible line sum.
export async function recalcInvoiceTotal(
  tx: Parameters<Parameters<typeof import("@/lib/db").db.transaction>[0]>[0],
  invoiceId: string,
) {
  const lines = await tx.query.invoiceLines.findMany({
    where: eq(invoiceLines.invoiceId, invoiceId),
    columns: { amount: true },
  });
  const total = sumMoney(lines.map((l) => l.amount));
  await tx
    .update(invoices)
    .set({ amount: total.toFixed(2), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
}

type InvoiceTx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

// The billed-invariant in one place: a time entry is isBilled ⟺ it has an
// active invoice line. Every path that adds/removes a line must go through
// these so the invariant can't drift (cf. the bugs fixed across it.52/55/56/57).

// Mark time entries billed against an invoice. Tenant-scoped; silently skips
// ineligible entries (already billed, prepaid, or belonging to another tenant).
// Returns how many were actually marked so callers can validate.
// Eksporteres til desktop-sync'en, der opretter fakturalinjer ad samme vej.
// `clientId` er fakturaens kunde: poster for en anden kunde springes over.
export async function markEntriesBilled(
  tx: InvoiceTx,
  entryIds: string[],
  invoiceId: string,
  orgId: string | null | undefined,
  userId: string,
  clientId: string,
): Promise<number> {
  if (entryIds.length === 0) return 0;
  const marked = await tx
    .update(timeEntries)
    .set({ isBilled: true, invoiceId })
    .where(
      and(
        inArray(timeEntries.id, entryIds),
        orgId
          ? eq(timeEntries.organizationId, orgId)
          : eq(timeEntries.userId, userId),
        eq(timeEntries.isBilled, false),
        eq(timeEntries.isPrepaid, false),
        // Never bill time that's awaiting approval or was rejected.
        notInArray(timeEntries.approvalStatus, ["pending", "rejected"]),
        sql`${RESOLVED_CLIENT_ID} = ${clientId}`,
      ),
    )
    .returning({ id: timeEntries.id });
  return marked.length;
}

// Release time entries (un-bill) so they can be invoiced again.
// Eksporteres fordi desktop-sync'en rører de samme rækker og skal frigive
// tidsposterne på samme måde — ellers forblev en slettet linje faktureret.
export async function releaseEntries(tx: InvoiceTx, entryIds: string[]) {
  if (entryIds.length === 0) return;
  await tx
    .update(timeEntries)
    .set({ isBilled: false, invoiceId: null })
    .where(inArray(timeEntries.id, entryIds));
}

export const invoicesRouter = router({
  // Get all invoices for the current user
  list: moduleReadProcedure("invoices")
    .input(
      z
        .object({
          clientId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // Bounded payload (#186 fase 2): default 500 nyeste; widgets scoper
      // med clientId + lav limit i stedet for at filtrere i klienten.
      const limit = input?.limit ?? 500;

      // Per-medlem klientadgang skubbes ned i SQL (#186) — før blev ALLE
      // fakturaer hentet (med client-join) og filtreret i JS.
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, ctx.session.user.id, ctx.orgId)
        : null;

      if (accessibleIds !== null && accessibleIds.length === 0) {
        return [];
      }
      if (
        input?.clientId &&
        accessibleIds !== null &&
        !accessibleIds.includes(input.clientId)
      ) {
        return [];
      }

      return ctx.db.query.invoices.findMany({
        where: and(
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
          input?.clientId ? eq(invoices.clientId, input.clientId) : undefined,
          accessibleIds !== null && !input?.clientId
            ? inArray(invoices.clientId, accessibleIds)
            : undefined,
        ),
        orderBy: [desc(invoices.createdAt)],
        limit,
        with: {
          client: {
            columns: { id: true, name: true, company: true, email: true },
          },
        },
      });
    }),

  // Side-baseret liste til REST-API'et og MCP (#573). `list` har en default
  // på 500 og returnerer et array, så GET /api/v1/invoices stoppede tavst ved
  // faktura nummer 500 og rapporterede 500 som total. Her pagineres, filtreres
  // og sorteres i databasen, og totalen tælles med de samme betingelser.
  // `list` er uændret, så dashboardets kaldere ikke berøres.
  listPage: moduleReadProcedure("invoices")
    .input(
      z.object({
        clientId: z.string().uuid().optional(),
        status: z.string().max(50).optional(),
        limit: z.number().int().min(1).max(500).default(25),
        offset: z.number().int().min(0).default(0),
        sortBy: z
          .enum(["createdAt", "status", "amount", "issueDate", "dueDate"])
          .default("createdAt"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Samme adgangsregel som getByClient: en kunde man ikke har adgang til,
      // er en fejl — ikke en tom liste.
      if (input.clientId) {
        await assertClientAccess(ctx.db, userId, ctx.orgId, input.clientId);
      }
      const accessibleIds =
        ctx.orgId && !input.clientId
          ? await getAccessibleClientIds(ctx.db, userId, ctx.orgId)
          : null;
      if (accessibleIds !== null && accessibleIds.length === 0) {
        return { invoices: [], total: 0 };
      }

      const where = and(
        ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
        input.clientId ? eq(invoices.clientId, input.clientId) : undefined,
        accessibleIds !== null
          ? inArray(invoices.clientId, accessibleIds)
          : undefined,
        input.status ? eq(invoices.status, input.status) : undefined,
      );

      const sortColumn = {
        createdAt: invoices.createdAt,
        status: invoices.status,
        amount: invoices.amount,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
      }[input.sortBy];

      const [totalRow] = await ctx.db
        .select({ value: count() })
        .from(invoices)
        .where(where);

      const rows = await ctx.db.query.invoices.findMany({
        where,
        // id som sidste nøgle, så rækker med samme sorteringsværdi ikke
        // skifter side mellem to kald.
        // NULLS LAST i begge retninger, som den tidligere sortering i
        // hukommelsen: fakturaer uden forfaldsdato skal ikke stå øverst.
        orderBy: [
          input.sortOrder === "asc"
            ? sql`${sortColumn} asc nulls last`
            : sql`${sortColumn} desc nulls last`,
          desc(invoices.createdAt),
          desc(invoices.id),
        ],
        limit: input.limit,
        offset: input.offset,
        with: {
          client: {
            columns: { id: true, name: true, company: true, email: true },
          },
        },
      });

      return { invoices: rows, total: totalRow?.value ?? 0 };
    }),

  // Get invoices by client
  getByClient: moduleReadProcedure("invoices")
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertClientAccess(ctx.db, userId, ctx.orgId, input.clientId);

      const clientInvoices = await ctx.db.query.invoices.findMany({
        where: and(
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
          eq(invoices.clientId, input.clientId),
        ),
        orderBy: [desc(invoices.createdAt)],
      });

      return clientInvoices;
    }),

  // Get a single invoice by ID
  getById: moduleReadProcedure("invoices")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.id),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
        with: {
          client: true,
          timeEntries: {
            columns: {
              id: true,
              date: true,
              description: true,
              hours: true,
              billableRate: true,
            },
            with: {
              project: { columns: { id: true, name: true } },
            },
            orderBy: [desc(timeEntries.date)],
            limit: 500,
          },
        },
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }
      // Respect per-member client access on direct id lookup.
      await assertClientAccess(ctx.db, userId, ctx.orgId, invoice.clientId);

      return invoice;
    }),

  // Get next invoice number (preview only — actual number assigned inside
  // create transaction). Uses the same computeNextInvoiceNumber helper as
  // the actual create path so preview matches the final value.
  getNextInvoiceNumber: moduleReadProcedure("invoices").query(
    async ({ ctx }) => {
      const userId = ctx.session.user.id;
      return ctx.db.transaction((tx) =>
        computeNextInvoiceNumber(tx, userId, ctx.orgId),
      );
    },
  ),

  // Get uninvoiced time entries for a client
  getUninvoicedTimeEntries: moduleWriteProcedure("invoices")
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify client belongs to user/org first
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw Errors.clientNotFound();
      }

      // Get all time entries for this client that haven't been invoiced
      const entries = await ctx.db.query.timeEntries.findMany({
        where: and(
          ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
          eq(timeEntries.clientId, input.clientId),
          eq(timeEntries.isBilled, false),
          // Prepaid time is already paid via klippekort — never invoice it
          // again (consistent with getUninvoicedSummary).
          eq(timeEntries.isPrepaid, false),
          // Don't offer time that's awaiting approval or was rejected.
          notInArray(timeEntries.approvalStatus, ["pending", "rejected"]),
        ),
        orderBy: [desc(timeEntries.date)],
        with: {
          project: true,
        },
      });

      return entries;
    }),

  // Create a new invoice
  create: moduleWriteProcedure("invoices")
    .input(invoiceInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check if this is the user's/org's first invoice (before creating)
      const existingInvoices = await ctx.db.query.invoices.findMany({
        where: ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
        limit: 1,
      });
      const isFirstInvoice = existingInvoices.length === 0;

      // Timer-first (#91): virksomhedsoplysninger er ikke længere et
      // onboarding-trin — de kræves først her, når de skal stå på fakturaen.
      if (isFirstInvoice) {
        const profile = await ctx.db.query.companyProfiles.findFirst({
          where: ctx.orgId
            ? eq(companyProfiles.organizationId, ctx.orgId)
            : eq(companyProfiles.userId, userId),
          columns: { id: true },
        });
        if (!profile) {
          throw badRequest(
            await tr("serverErrors", "invoices.companyProfileMissing"),
          );
        }
      }

      // Use transaction to ensure atomicity
      const newInvoice = await ctx.db.transaction(async (tx) => {
        // Verify client belongs to user/org
        const client = await tx.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });

        if (!client) {
          throw Errors.clientNotFound();
        }

        // Template pr. faktura (#201): valgfri, skal tilhøre scope
        if (input.templateId) {
          const tpl = await tx.query.invoiceTemplates.findFirst({
            where: and(
              eq(invoiceTemplates.id, input.templateId),
              ctx.orgId
                ? eq(invoiceTemplates.organizationId, ctx.orgId)
                : eq(invoiceTemplates.userId, userId),
            ),
            columns: { id: true },
          });
          if (!tpl) {
            throw badRequest(
              await tr("serverErrors", "invoices.templateNotFound"),
            );
          }
        }

        // Forfaldsdato-fallback (#201): kunde -> template -> 14 dage
        const issueDateParsed = new Date(input.issueDate);
        let dueDate = input.dueDate ? new Date(input.dueDate) : null;
        if (!dueDate) {
          let terms: number | null = client.paymentTermsDays ?? null;
          if (terms == null) {
            const templateScope = ctx.orgId
              ? eq(invoiceTemplates.organizationId, ctx.orgId)
              : eq(invoiceTemplates.userId, userId);
            const tpl = await tx.query.invoiceTemplates.findFirst({
              where: input.templateId
                ? and(eq(invoiceTemplates.id, input.templateId), templateScope)
                : and(templateScope, eq(invoiceTemplates.isDefault, true)),
              columns: { paymentTermsDays: true },
            });
            terms = tpl?.paymentTermsDays ?? null;
          }
          dueDate = addDays(issueDateParsed, terms ?? 14);
        }

        // Kladder forbruger ikke numre af den fortlobende serie (#196) —
        // det rigtige nummer tildeles forst ved udstedelse.
        const status = input.status || "draft";
        const invoiceNumber =
          status === "draft"
            ? draftInvoiceNumber()
            : await computeNextInvoiceNumber(tx, userId, ctx.orgId);

        // Create the invoice
        const [invoice] = await tx
          .insert(invoices)
          .values({
            invoiceNumber,
            clientId: input.clientId,
            userId,
            organizationId: ctx.orgId,
            amount: input.amount,
            status,
            issueDate: issueDateParsed,
            dueDate,
            templateId: input.templateId || null,
            notes: input.notes || null,
          })
          .returning();

        // If time entries are specified, mark them billed (ineligible ones —
        // already billed / prepaid — are skipped by the helper).
        if (input.timeEntryIds && input.timeEntryIds.length > 0) {
          await markEntriesBilled(
            tx,
            input.timeEntryIds,
            invoice.id,
            ctx.orgId,
            userId,
            input.clientId,
          );
        }

        return { invoice, clientName: client.name };
      });

      // Send first invoice milestone email
      if (isFirstInvoice) {
        try {
          const user = await ctx.db.query.users.findFirst({
            where: eq(users.id, userId),
          });
          const prefs = await ctx.db.query.emailPreferences.findFirst({
            where: eq(emailPreferences.userId, userId),
          });

          // Only send if user has onboarding milestones enabled (default: true)
          if (user && prefs?.onboardingMilestones !== false) {
            // Format amount for Danish locale
            const formattedAmount = new Intl.NumberFormat(
              toIntlLocale(await getRecipientLocale({ userId })),
              {
                style: "currency",
                currency: "DKK",
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              },
            ).format(parseFloat(input.amount));

            await sendFirstInvoiceEmail({
              to: user.email,
              userName: user.name || "der",
              invoiceNumber: newInvoice.invoice.invoiceNumber,
              amount: formattedAmount,
              clientName: newInvoice.clientName,
              userId,
            });
          }
        } catch (error) {
          // Don't fail the create operation if email fails
          console.error("Failed to send first invoice email:", error);
        }
      }

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "invoice.created",
        eventId: newInvoice.invoice.id,
        data: { invoice: newInvoice.invoice },
        clientId: newInvoice.invoice.clientId,
      });

      trackEvent({
        userId,
        orgId: ctx.orgId,
        event: "invoice.created",
      });

      return newInvoice.invoice;
    }),

  // Update an invoice
  update: moduleWriteProcedure("invoices")
    .input(updateInvoiceInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify invoice belongs to user/org
      const ownershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.id), ownershipFilter),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }

      // Validate status transition using state machine
      if (input.status && input.status !== invoice.status) {
        const currentStatus = invoice.status as InvoiceStatus;
        const newStatus = input.status as InvoiceStatus;

        if (!canTransition(currentStatus, newStatus)) {
          throw badRequest(getTransitionError(currentStatus, newStatus));
        }
      }

      // Laas udstedte fakturaer (#195): pa sent/overdue tillades kun
      // notes, statusovergange (jf. statemaskinen) og betalingsregistrering
      // (paidDate). amount/dueDate pa en udstedt faktura er et lovbrud —
      // rettelser sker via kreditnota.
      if (invoice.status === "sent" || invoice.status === "overdue") {
        if (
          input.amount !== undefined ||
          input.dueDate !== undefined ||
          input.templateId !== undefined
        ) {
          throw badRequest(
            await tr("serverErrors", "invoices.issuedCannotChange"),
          );
        }
      }

      // Prevent editing paid or deleted invoices (except notes)
      if (invoice.status === "paid" || invoice.status === "deleted") {
        // Only allow notes update for paid invoices
        if (
          invoice.status === "paid" &&
          input.notes !== undefined &&
          !input.status &&
          !input.amount &&
          !input.dueDate &&
          !input.paidDate
        ) {
          const [updatedInvoice] = await ctx.db
            .update(invoices)
            .set({ notes: input.notes, updatedAt: new Date() })
            .where(eq(invoices.id, input.id))
            .returning();
          return updatedInvoice;
        }
        throw badRequest(
          invoice.status === "deleted"
            ? await tr("serverErrors", "invoices.deletedCannotEdit")
            : await tr("serverErrors", "invoices.paidNotesOnly"),
        );
      }

      // Prepare update data
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.status) updateData.status = input.status;
      if (input.amount) updateData.amount = input.amount;
      if (input.templateId !== undefined) {
        if (input.templateId) {
          const tpl = await ctx.db.query.invoiceTemplates.findFirst({
            where: and(
              eq(invoiceTemplates.id, input.templateId),
              ctx.orgId
                ? eq(invoiceTemplates.organizationId, ctx.orgId)
                : eq(invoiceTemplates.userId, userId),
            ),
            columns: { id: true },
          });
          if (!tpl) {
            throw badRequest(
              await tr("serverErrors", "invoices.templateNotFound"),
            );
          }
        }
        updateData.templateId = input.templateId;
      }
      if (input.dueDate) updateData.dueDate = new Date(input.dueDate);
      if (input.paidDate) updateData.paidDate = new Date(input.paidDate);
      if (input.notes !== undefined) updateData.notes = input.notes;
      if (input.billyInvoiceId !== undefined) {
        updateData.billyInvoiceId = input.billyInvoiceId;
      }

      // If status is changing to "paid", set paidDate if not already set
      if (input.status === "paid" && !invoice.paidDate && !input.paidDate) {
        updateData.paidDate = new Date();
      }

      const [updatedInvoice] = await ctx.db.transaction(async (tx) => {
        // Valideringen ovenfor er laest uden for transaktionen: laas raekken
        // og afvis hvis statussen er skiftet i mellemtiden (#1110).
        const locked = await lockInvoiceStatus(tx, input.id, invoice.status);
        // Udstedelse: kladdens UDKAST-nummer erstattes af naeste nummer i
        // den fortlobende serie, atomisk med statusskiftet (#196).
        if (input.status === "sent" && invoice.status === "draft") {
          await ensureRealInvoiceNumber(tx, locked, userId, ctx.orgId);
        }
        return tx
          .update(invoices)
          .set(updateData)
          .where(eq(invoices.id, input.id))
          .returning();
      });

      if (input.status && input.status !== invoice.status) {
        const statusEvent =
          input.status === "paid"
            ? ("invoice.paid" as const)
            : input.status === "sent"
              ? ("invoice.sent" as const)
              : input.status === "overdue"
                ? ("invoice.overdue" as const)
                : null;
        if (statusEvent) {
          emitWebhookEvent({
            userId,
            orgId: ctx.orgId,
            eventType: statusEvent,
            eventId: updatedInvoice.id,
            data: { invoice: updatedInvoice, previousStatus: invoice.status },
            clientId: updatedInvoice.clientId,
          });
        }
      }

      return updatedInvoice;
    }),

  // Delete an invoice (soft delete)
  delete: moduleWriteProcedure("invoices")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify invoice belongs to user/org
      const ownershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.id), ownershipFilter),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }

      // Only allow deletion of draft invoices
      if (invoice.status !== "draft") {
        throw badRequest(await tr("serverErrors", "invoices.draftsOnlyDelete"));
      }

      // Soft delete + release the invoice's time entries so they can be
      // re-invoiced. Without this, entries stay isBilled=true against a deleted
      // invoice — invisible to "uninvoiced" lists, i.e. silently lost revenue.
      await ctx.db.transaction(async (tx) => {
        // Laas kladden: en samtidig udstedelse maa ikke faa sine nu
        // fakturerede tidsposter frigivet af sletningen (#1110).
        await lockInvoiceStatus(tx, input.id, "draft");

        await tx
          .update(timeEntries)
          .set({ isBilled: false, invoiceId: null })
          .where(eq(timeEntries.invoiceId, input.id));

        await tx
          .update(invoices)
          .set({
            status: "deleted",
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, input.id));
      });

      return { success: true };
    }),

  // Get invoice stats
  getStats: moduleReadProcedure("invoices").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // PERF: Aggregate in SQL. Previously loaded every invoice row for the
    // user and iterated 7 times in JavaScript.
    const scopeFilter = ctx.orgId
      ? eq(invoices.organizationId, ctx.orgId)
      : eq(invoices.userId, userId);
    const rows = await ctx.db
      .select({
        status: invoices.status,
        count: sql<number>`COUNT(*)::int`,
        totalAmount: sql<string>`COALESCE(SUM(CAST(${invoices.amount} AS DECIMAL)), 0)`,
      })
      .from(invoices)
      .where(scopeFilter)
      .groupBy(invoices.status);

    let total = 0;
    let totalInvoiced = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let draft = 0;
    let sent = 0;
    let paid = 0;
    let overdue = 0;
    for (const r of rows) {
      const amount = parseFloat(r.totalAmount as unknown as string);
      total += r.count;
      totalInvoiced += amount;
      if (r.status === "paid") {
        paid = r.count;
        totalPaid += amount;
      } else if (r.status === "sent") {
        sent = r.count;
        totalPending += amount;
      } else if (r.status === "overdue") {
        overdue = r.count;
        totalPending += amount;
      } else if (r.status === "draft") {
        draft = r.count;
      }
    }

    return {
      total,
      totalInvoiced: totalInvoiced.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalPending: totalPending.toFixed(2),
      draft,
      sent,
      paid,
      overdue,
    };
  }),

  // Get uninvoiced summary by client/project
  getUninvoicedSummary: moduleWriteProcedure("invoices").query(
    async ({ ctx }) => {
      const userId = ctx.session.user.id;

      // Get all unbilled, non-prepaid time entries
      // Kolonne-trim (#186): kun felterne aggregeringen bruger — før blev
      // fulde rækker + fulde client-rækker (2 joins) loadet i hukommelsen.
      const entries = await ctx.db.query.timeEntries.findMany({
        where: and(
          ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
          eq(timeEntries.isBilled, false),
          eq(timeEntries.isPrepaid, false),
          // Never bill time awaiting approval or rejected by a manager.
          notInArray(timeEntries.approvalStatus, ["pending", "rejected"]),
        ),
        columns: {
          id: true,
          hours: true,
          billableRate: true,
          projectId: true,
          clientId: true,
        },
        with: {
          project: {
            columns: { id: true, name: true, clientId: true },
            with: {
              client: { columns: { id: true, name: true } },
            },
          },
          client: { columns: { id: true, name: true } },
        },
      });

      // Group by client
      const clientSummary = new Map<
        string,
        {
          client: { id: string; name: string };
          entries: typeof entries;
          totalHours: number;
          totalAmount: number;
          projects: Map<
            string,
            { name: string; hours: number; amount: number }
          >;
        }
      >();

      for (const entry of entries) {
        const clientId = entry.project?.clientId || entry.clientId;
        const clientName = entry.project?.client?.name || entry.client?.name;

        if (!clientId || !clientName) continue;

        let summary = clientSummary.get(clientId);
        if (!summary) {
          summary = {
            client: { id: clientId, name: clientName },
            entries: [],
            totalHours: 0,
            totalAmount: 0,
            projects: new Map(),
          };
          clientSummary.set(clientId, summary);
        }
        summary.entries.push(entry);

        const hours = parseFloat(entry.hours || "0");
        const rate = entry.billableRate ? parseFloat(entry.billableRate) : 0;
        const amount = hours * rate;

        summary.totalHours += hours;
        summary.totalAmount += amount;

        // Track per project
        if (entry.projectId && entry.project) {
          const projectKey = entry.projectId;
          let projectSummary = summary.projects.get(projectKey);
          if (!projectSummary) {
            projectSummary = { name: entry.project.name, hours: 0, amount: 0 };
            summary.projects.set(projectKey, projectSummary);
          }
          projectSummary.hours += hours;
          projectSummary.amount += amount;
        }
      }

      // Convert to array format
      return Array.from(clientSummary.values()).map((summary) => ({
        client: summary.client,
        entryCount: summary.entries.length,
        totalHours: roundMoney(summary.totalHours),
        totalAmount: roundMoney(summary.totalAmount),
        projects: Array.from(summary.projects.entries()).map(([id, data]) => ({
          id,
          ...data,
          hours: roundMoney(data.hours),
          amount: roundMoney(data.amount),
        })),
        entryIds: summary.entries.map((e) => e.id),
      }));
    },
  ),

  // "Fakturér nu" (#89): kunder med nok ufaktureret tid og lang tid siden
  // sidste faktura. Afviste (snoozede) kunder er filtreret fra.
  nudgeCandidates: moduleWriteProcedure("invoices")
    .input(
      z
        .object({
          clientId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(10).default(1),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return loadInvoiceNudges(
        ctx.db,
        { userId: ctx.session.user.id, orgId: ctx.orgId },
        { clientId: input?.clientId, limit: input?.limit ?? 1 },
      );
    }),

  // "Fakturér nu" (#89): forhåndsvisning af periodens ufakturerede tid for
  // én kunde, grupperet pr. projekt. entryIds sendes uændret videre til
  // generateFromTimeEntries.
  previewFromTimeEntries: moduleWriteProcedure("invoices")
    .input(
      z.object({
        clientId: z.string().uuid(),
        period: z.enum(INVOICE_PREVIEW_PERIODS).default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const preview = await loadInvoicePreview(
        ctx.db,
        { userId: ctx.session.user.id, orgId: ctx.orgId },
        input,
      );
      if (!preview) throw Errors.clientNotFound();
      return preview;
    }),

  // Generate invoice from selected time entries
  generateFromTimeEntries: moduleWriteProcedure("invoices")
    .input(
      z.object({
        clientId: z.string().uuid(),
        timeEntryIds: z.array(z.string().uuid()).min(1),
        notes: z.string().optional(),
        dueDate: z.string().optional(),
        // Måling (#89): hvorfra kladden blev lavet — kun til product_events.
        origin: z
          .enum(["invoice_nudge", "client_page", "dashboard", "invoices_page"])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify client belongs to user/org
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw Errors.clientNotFound();
      }
      await assertClientAccess(ctx.db, userId, ctx.orgId, client.id);

      // Get the time entries and verify they belong to this user/org and
      // client. Exclude already-billed and prepaid entries — billing either
      // would double-charge (prepaid is already paid via klippekort). The count
      // check below then rejects the whole request if any id was ineligible.
      const entries = await ctx.db.query.timeEntries.findMany({
        where: and(
          inArray(timeEntries.id, input.timeEntryIds),
          ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
          eq(timeEntries.isBilled, false),
          eq(timeEntries.isPrepaid, false),
          // Never bill time awaiting approval or rejected by a manager.
          notInArray(timeEntries.approvalStatus, ["pending", "rejected"]),
        ),
        with: {
          project: {
            with: { client: true },
          },
        },
      });

      // En kladde til kunde A må aldrig få poster fra kunde B. Postens kunde
      // er dens egen eller projektets (RESOLVED_CLIENT_ID, som preview).
      if (
        entries.length !== input.timeEntryIds.length ||
        entries.some(
          (e) => (e.clientId ?? e.project?.clientId) !== input.clientId,
        )
      ) {
        throw Errors.timeEntriesNotFound();
      }
      // Linjerne i datoorden (ældste først), som på en timeseddel.
      entries.sort(
        (a, b) =>
          a.date.getTime() - b.date.getTime() ||
          input.timeEntryIds.indexOf(a.id) - input.timeEntryIds.indexOf(b.id),
      );

      // Én fakturalinje pr. post (som tilbagevendende fakturaer): så holder
      // invarianten "faktureret ⟺ har en linje", linje-editoren starter med
      // posterne, og beløbet er summen af de afrundede linjer.
      const invoiceLineRows = entries.map((entry, i) => {
        const hours = parseFloat(entry.hours || "0");
        const rate = entry.billableRate ? parseFloat(entry.billableRate) : 0;
        const dateStr = entry.date.toISOString().slice(0, 10);
        const projectPrefix = entry.project?.name
          ? `${entry.project.name}: `
          : "";
        return {
          description: `${formatDanishDate(dateStr)} – ${projectPrefix}${entry.description || "Tidsregistrering"}`,
          quantity: hours.toFixed(2),
          unitPrice: rate.toFixed(2),
          amount: roundMoney(hours * rate).toFixed(2),
          timeEntryId: entry.id,
          sortOrder: i,
        };
      });

      // Calculate total amount
      const totalAmount = sumMoney(invoiceLineRows.map((l) => l.amount));
      const lineItems: Array<{
        description: string;
        hours: number;
        rate: number;
        amount: number;
        date: Date;
        projectName?: string;
      }> = [];

      for (const entry of entries) {
        const hours = parseFloat(entry.hours || "0");
        const rate = entry.billableRate ? parseFloat(entry.billableRate) : 0;
        const amount = hours * rate;

        lineItems.push({
          description: entry.description || "Tidsregistrering",
          hours,
          rate,
          amount,
          date: entry.date,
          projectName: entry.project?.name,
        });
      }

      // Check if this is the user's/org's first invoice
      const existingInvoices = await ctx.db.query.invoices.findMany({
        where: ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
        limit: 1,
      });
      const isFirstInvoice = existingInvoices.length === 0;

      // Create invoice with transaction
      const created = await ctx.db.transaction(async (tx) => {
        // Genereres altid som kladde — nummer tildeles ved udstedelse (#196)
        const invoiceNumber = draftInvoiceNumber();

        // Forfaldsdato-fallback (#201)
        let generatedDueDate = input.dueDate ? new Date(input.dueDate) : null;
        if (!generatedDueDate) {
          let terms: number | null = client.paymentTermsDays ?? null;
          if (terms == null) {
            const tpl = await tx.query.invoiceTemplates.findFirst({
              where: and(
                ctx.orgId
                  ? eq(invoiceTemplates.organizationId, ctx.orgId)
                  : eq(invoiceTemplates.userId, userId),
                eq(invoiceTemplates.isDefault, true),
              ),
              columns: { paymentTermsDays: true },
            });
            terms = tpl?.paymentTermsDays ?? null;
          }
          generatedDueDate = addDays(
            entryDateFromStr(copenhagenToday()),
            terms ?? 14,
          );
        }

        // Build notes with line items
        const formattedLineItems = lineItems
          .map((item) =>
            st("invoices.specLine", {
              date: item.date.toLocaleDateString(toIntlLocale(activeLocale()), {
                timeZone: "Europe/Copenhagen",
              }),
              project: item.projectName || st("invoices.directTime"),
              description: item.description,
              hours: item.hours.toFixed(1),
              rate: item.rate.toFixed(0),
              amount: item.amount.toFixed(0),
            }),
          )
          .join("\n");

        const fullNotes = input.notes
          ? `${input.notes}\n\n${st("invoices.specHeading")}\n${formattedLineItems}`
          : `${st("invoices.specHeading")}\n${formattedLineItems}`;

        // Create invoice
        const [invoice] = await tx
          .insert(invoices)
          .values({
            invoiceNumber,
            clientId: input.clientId,
            userId,
            organizationId: ctx.orgId,
            amount: totalAmount.toFixed(2),
            status: "draft",
            issueDate: new Date(),
            dueDate: generatedDueDate,
            notes: fullNotes,
          })
          .returning();

        // Mark time entries billed and link to invoice (entries were already
        // filtered to eligible ones above; the helper re-asserts the invariant).
        // Fik en samtidig kladde nogle af posterne først, rulles alt tilbage.
        const marked = await markEntriesBilled(
          tx,
          input.timeEntryIds,
          invoice.id,
          ctx.orgId,
          userId,
          input.clientId,
        );
        if (marked !== entries.length) throw Errors.timeEntriesNotFound();
        const lines = await tx
          .insert(invoiceLines)
          .values(invoiceLineRows.map((l) => ({ ...l, invoiceId: invoice.id })))
          .returning();

        return { invoice, lines };
      });
      const result = created.invoice;

      // Send first invoice milestone email
      if (isFirstInvoice) {
        try {
          const user = await ctx.db.query.users.findFirst({
            where: eq(users.id, userId),
          });
          const prefs = await ctx.db.query.emailPreferences.findFirst({
            where: eq(emailPreferences.userId, userId),
          });

          if (user && prefs?.onboardingMilestones !== false) {
            const formattedAmount = new Intl.NumberFormat(
              toIntlLocale(await getRecipientLocale({ userId })),
              {
                style: "currency",
                currency: "DKK",
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              },
            ).format(totalAmount);

            await sendFirstInvoiceEmail({
              to: user.email,
              userName: user.name || "der",
              invoiceNumber: result.invoiceNumber,
              amount: formattedAmount,
              clientName: client.name,
              userId,
            });
          }
        } catch (error) {
          console.error("Failed to send first invoice email:", error);
        }
      }

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "invoice.created",
        eventId: result.id,
        data: { invoice: result, lineItems, totalAmount },
        clientId: result.clientId,
      });

      trackEvent({
        userId,
        orgId: ctx.orgId,
        event: "invoice.created",
        metadata: {
          via: "time_entries",
          origin: input.origin ?? null,
          clientId: input.clientId,
          entryCount: entries.length,
        },
      });

      return {
        invoice: result,
        lineItems,
        totalAmount,
        lines: created.lines,
      };
    }),

  // Kreditnota (#195): foerste-klasses objekt i samme nummerserie.
  // Fuld kreditering: negativt belob (aggregeringer netter automatisk),
  // negerede linjer, originalen udlignes, tidsposter frigives valgfrit.
  createCreditNote: moduleWriteProcedure("invoices")
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        releaseTimeEntries: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);

      const original = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.invoiceId), ownershipFilter),
        with: { lines: true },
      });

      if (!original) {
        throw Errors.invoiceNotFound();
      }
      if (original.kind === "credit_note") {
        throw badRequest(
          await tr("serverErrors", "invoices.creditNoteNotCreditable"),
        );
      }
      if (original.status === "draft") {
        throw badRequest(
          await tr("serverErrors", "invoices.draftNotCreditable"),
        );
      }
      if (original.status === "deleted") {
        throw badRequest(
          await tr("serverErrors", "invoices.deletedNotCreditable"),
        );
      }

      const existingCredit = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.relatedInvoiceId, original.id),
          eq(invoices.kind, "credit_note"),
        ),
        columns: { invoiceNumber: true },
      });
      if (existingCredit) {
        throw badRequest(
          await tr("serverErrors", "invoices.alreadyCredited", {
            number: existingCredit.invoiceNumber,
          }),
        );
      }

      const creditNote = await ctx.db.transaction(async (tx) => {
        // Row-lock originalen: serialiserer samtidige krediteringer af samme
        // faktura (TOCTOU) og giver friske notes/paidDate til udligningen.
        const [lockedOriginal] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.id, original.id), ownershipFilter))
          .for("update");
        if (!lockedOriginal) {
          throw Errors.invoiceNotFound();
        }
        const dup = await tx.query.invoices.findFirst({
          where: and(
            eq(invoices.relatedInvoiceId, original.id),
            eq(invoices.kind, "credit_note"),
          ),
          columns: { invoiceNumber: true },
        });
        if (dup) {
          throw badRequest(
            await tr("serverErrors", "invoices.alreadyCredited", {
              number: dup.invoiceNumber,
            }),
          );
        }

        const invoiceNumber = await computeNextInvoiceNumber(
          tx,
          userId,
          ctx.orgId,
        );
        const now = new Date();

        const [cn] = await tx
          .insert(invoices)
          .values({
            invoiceNumber,
            clientId: original.clientId,
            userId,
            organizationId: original.organizationId,
            // Negativt belob: SUM-baserede statistikker netter automatisk
            amount: (-Number.parseFloat(original.amount)).toFixed(2),
            status: "paid", // en kreditnota er udlignet ved udstedelse
            kind: "credit_note",
            relatedInvoiceId: original.id,
            // Dansk dato som UTC-midnat — samme konvention som fakturaer (#649)
            issueDate: entryDateFromStr(copenhagenToday(now)),
            paidDate: now,
            notes: await tr("serverErrors", "invoices.creditNoteNotes", {
              number: original.invoiceNumber,
              date: original.issueDate.toLocaleDateString(
                toIntlLocale(activeLocale()),
                { timeZone: "Europe/Copenhagen" },
              ),
            }),
          })
          .returning();

        // Kopier linjer negeret (unitPrice + amount; antal bevares)
        const lines = original.lines ?? [];
        if (lines.length > 0) {
          await tx.insert(invoiceLines).values(
            lines.map((l) => ({
              invoiceId: cn.id,
              description: l.description,
              quantity: l.quantity,
              unitPrice: (-Number.parseFloat(l.unitPrice)).toFixed(2),
              amount: (-Number.parseFloat(l.amount)).toFixed(2),
              sortOrder: l.sortOrder,
            })),
          );
        }

        // Originalen udlignes — den forsvinder fra udestaende/forfaldne,
        // og faktura+kreditnota netter til 0 i omsaetningen.
        await tx
          .update(invoices)
          .set({
            status: "paid",
            paidDate: lockedOriginal.paidDate ?? now,
            notes: lockedOriginal.notes
              ? `${lockedOriginal.notes}\n\nUdlignet af kreditnota ${invoiceNumber}`
              : `Udlignet af kreditnota ${invoiceNumber}`,
            updatedAt: now,
          })
          .where(eq(invoices.id, original.id));

        // Frigiv tidsposterne saa de kan faktureres igen
        if (input.releaseTimeEntries) {
          await tx
            .update(timeEntries)
            .set({ isBilled: false, invoiceId: null })
            .where(eq(timeEntries.invoiceId, original.id));
        }

        return cn;
      });

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "invoice.created",
        eventId: creditNote.id,
        data: {
          invoice: creditNote,
          creditNoteFor: original.invoiceNumber,
        },
        clientId: creditNote.clientId,
      });

      if (ctx.orgId) {
        logOrgAudit(ctx.db, ctx.orgId, userId, "credit_note_created", {
          metadata: { originalInvoiceId: input.invoiceId },
        });
      }

      return creditNote;
    }),

  // Nummerserie-tjek (#196): dokumentér evt. huller i den fortløbende
  // serie (arv fra den gamle adfærd hvor kladder forbrugte numre). Slettede
  // fakturaer beholder deres nummer og tæller som brugt — serien er intakt.
  numberSeriesAudit: moduleReadProcedure("invoices").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const rows = await ctx.db.query.invoices.findMany({
      where: ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId),
      columns: { invoiceNumber: true },
    });

    const nums = rows
      .filter((r) => !isDraftInvoiceNumber(r.invoiceNumber))
      .map((r) => {
        const m = r.invoiceNumber.match(/(\d+)$/);
        return m ? Number.parseInt(m[1], 10) : null;
      })
      .filter((n): n is number => n !== null);

    if (nums.length === 0) {
      return { total: 0, min: null, max: null, gaps: [], gapCount: 0 };
    }

    const seen = new Set(nums);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const range = max - min + 1;
    const gapCount = range - seen.size;

    // Bizarre serier (fx årstal-numre) kan spænde enormt — rapportér kun
    // antallet, ikke listen, når rangen er urimelig stor.
    const gaps: number[] = [];
    if (range <= 100_000) {
      for (let i = min; i <= max && gaps.length < 50; i++) {
        if (!seen.has(i)) gaps.push(i);
      }
    }

    return { total: nums.length, min, max, gaps, gapCount };
  }),

  // Send invoice email to client
  sendEmail: moduleWriteProcedure("invoices")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Udstedelse ved afsendelse: en kladde skal have sit rigtige nummer
      // FOER PDF/email renderes (#196).
      const preInvoice = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.id),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
        columns: { id: true, invoiceNumber: true },
      });
      if (preInvoice && isDraftInvoiceNumber(preInvoice.invoiceNumber)) {
        await ctx.db.transaction(async (tx) => {
          await ensureRealInvoiceNumber(tx, preInvoice, userId, ctx.orgId);
        });
      }

      // Load invoice + PDF props via the shared helper so this path attaches
      // the same complete PDF (VAT, logo, bank info, lines) as the REST route.
      const pdfData = await buildInvoicePdfProps({
        invoiceId: input.id,
        userId,
        orgId: ctx.orgId ?? null,
      });

      if (!pdfData) {
        throw Errors.invoiceNotFound();
      }

      const { invoice, client, user, companyProfile, pdfProps } = pdfData;

      if (!client.email) {
        throw badRequest(await tr("serverErrors", "invoices.clientHasNoEmail"));
      }

      const pdfBuffer = await renderInvoicePdfBuffer(pdfProps);

      // Send email — sender identity prefers the org's company profile so the
      // client sees a consistent company (matching the PDF) regardless of
      // which team member sends it.
      await sendInvoiceEmail({
        to: client.email,
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        dueDate:
          invoice.dueDate?.toISOString() || invoice.issueDate.toISOString(),
        senderName: companyProfile?.name || user.name,
        senderEmail: companyProfile?.email || user.email,
        notes: invoice.notes,
        userId,
        invoiceId: invoice.id,
        clientId: client.id,
        attachments: [
          {
            filename: `Faktura_${invoice.invoiceNumber}.pdf`,
            content: pdfBuffer,
          },
        ],
      });

      // Update invoice status to "sent" if it's still a draft. The webhook
      // only fires on this draft->sent transition — a resend of an already
      // sent/paid invoice must not re-announce (or misreport) its status.
      if (invoice.status === "draft") {
        await ctx.db
          .update(invoices)
          .set({ status: "sent", updatedAt: new Date() })
          .where(eq(invoices.id, input.id));

        emitWebhookEvent({
          userId,
          orgId: ctx.orgId,
          eventType: "invoice.sent",
          eventId: invoice.id,
          data: {
            invoice: { ...invoice, status: "sent" },
            sentTo: client.email,
          },
          clientId: invoice.clientId,
        });

        trackEvent({
          userId,
          orgId: ctx.orgId,
          event: "invoice.sent",
        });

        if (ctx.orgId) {
          logOrgAudit(ctx.db, ctx.orgId, userId, "invoice_status_changed", {
            metadata: { invoiceId: input.id, to: "sent" },
          });
        }
      }

      return { success: true };
    }),

  // Transition invoice to a new status (uses state machine validation)
  transition: moduleWriteProcedure("invoices")
    .input(
      z.object({
        id: z.string().uuid(),
        newStatus: z.enum(["draft", "sent", "paid", "overdue", "deleted"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.id),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }

      const currentStatus = invoice.status as InvoiceStatus;
      const newStatus = input.newStatus as InvoiceStatus;

      // No change needed
      if (currentStatus === newStatus) {
        return invoice;
      }

      // Validate transition
      if (!canTransition(currentStatus, newStatus)) {
        throw badRequest(getTransitionError(currentStatus, newStatus));
      }

      // Prepare update data
      const updateData: Record<string, unknown> = {
        status: newStatus,
        updatedAt: new Date(),
      };

      // Auto-set paidDate when transitioning to paid
      if (newStatus === "paid" && !invoice.paidDate) {
        updateData.paidDate = new Date();
      }

      const [updatedInvoice] = await ctx.db.transaction(async (tx) => {
        // canTransition blev tjekket mod en laesning uden for transaktionen:
        // laas raekken og afvis hvis statussen er skiftet siden (#1110).
        const locked = await lockInvoiceStatus(tx, input.id, invoice.status);
        // Udstedelse via transition: tildel rigtigt nummer atomisk (#196)
        if (newStatus === "sent" && invoice.status === "draft") {
          await ensureRealInvoiceNumber(tx, locked, userId, ctx.orgId);
        }
        // Deleting via transition must release the invoice's time entries too
        // (same as delete()), or they stay billed against a dead invoice and
        // can never be re-invoiced.
        if (newStatus === "deleted") {
          await tx
            .update(timeEntries)
            .set({ isBilled: false, invoiceId: null })
            .where(eq(timeEntries.invoiceId, input.id));
        }

        return tx
          .update(invoices)
          .set(updateData)
          .where(eq(invoices.id, input.id))
          .returning();
      });

      const transitionEvent =
        newStatus === "paid"
          ? ("invoice.paid" as const)
          : newStatus === "sent"
            ? ("invoice.sent" as const)
            : newStatus === "overdue"
              ? ("invoice.overdue" as const)
              : null;
      if (transitionEvent) {
        emitWebhookEvent({
          userId,
          orgId: ctx.orgId,
          eventType: transitionEvent,
          eventId: updatedInvoice.id,
          data: { invoice: updatedInvoice, previousStatus: invoice.status },
          clientId: updatedInvoice.clientId,
        });
      }

      return updatedInvoice;
    }),

  // ========== Invoice Lines CRUD ==========

  // Get invoice lines for an invoice
  getLines: moduleReadProcedure("invoices")
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify invoice belongs to user/org
      const invoiceOwnershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.invoiceId), invoiceOwnershipFilter),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }
      // Samme per-medlem klientadgang som getById og linesByInvoice (#186).
      await assertClientAccess(ctx.db, userId, ctx.orgId, invoice.clientId);

      const lines = await ctx.db.query.invoiceLines.findMany({
        where: eq(invoiceLines.invoiceId, input.invoiceId),
        orderBy: [invoiceLines.sortOrder],
      });

      return lines;
    }),

  // Linjer for mange fakturaer i ét kald (desktop-listen). Svar: fakturaens
  // id → linjer i sortOrder. Fakturaer uden for brugerens/org'ens findes
  // ikke i svaret; en faktura uden linjer giver en tom liste.
  linesByInvoice: moduleReadProcedure("invoices")
    .input(z.object({ ids: z.array(z.string().uuid()).max(500) }))
    .query(async ({ ctx, input }) => {
      const result: Record<string, (typeof invoiceLines.$inferSelect)[]> = {};
      if (input.ids.length === 0) return result;
      // Samme per-medlem klientadgang som `list` (#186).
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, ctx.session.user.id, ctx.orgId)
        : null;
      if (accessibleIds !== null && accessibleIds.length === 0) return result;
      const owned = await ctx.db.query.invoices.findMany({
        where: and(
          inArray(invoices.id, input.ids),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, ctx.session.user.id),
          accessibleIds !== null
            ? inArray(invoices.clientId, accessibleIds)
            : undefined,
        ),
        columns: { id: true },
      });
      if (owned.length === 0) return result;
      for (const inv of owned) result[inv.id] = [];
      const lines = await ctx.db.query.invoiceLines.findMany({
        where: inArray(
          invoiceLines.invoiceId,
          owned.map((i) => i.id),
        ),
        orderBy: [invoiceLines.sortOrder],
      });
      for (const line of lines) result[line.invoiceId].push(line);
      return result;
    }),

  // Create invoice line
  createLine: moduleWriteProcedure("invoices")
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        description: z
          .string()
          .min(1, { error: () => st("zod.descriptionRequired") }),
        quantity: z.string().default("1"),
        unitPrice: z.string(),
        amount: z.string(),
        timeEntryId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
        sortOrder: z.number().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify invoice belongs to user/org
      const invoiceOwnershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.invoiceId), invoiceOwnershipFilter),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }

      // Only allow editing draft invoices
      if (invoice.status !== "draft") {
        throw badRequest(
          await tr("serverErrors", "invoices.draftOnlyAddLines"),
        );
      }

      const line = await ctx.db.transaction(async (tx) => {
        // If the line links a time entry, mark it billed (tenant-scoped; throws
        // if it's ineligible or another tenant's).
        if (input.timeEntryId) {
          const n = await markEntriesBilled(
            tx,
            [input.timeEntryId],
            input.invoiceId,
            ctx.orgId,
            userId,
            invoice.clientId,
          );
          if (n === 0) {
            throw badRequest(
              await tr("serverErrors", "invoices.timeEntryNotFound"),
            );
          }
        }

        const [inserted] = await tx
          .insert(invoiceLines)
          .values({
            invoiceId: input.invoiceId,
            description: input.description,
            quantity: input.quantity,
            unitPrice: input.unitPrice,
            amount: input.amount,
            timeEntryId: input.timeEntryId || null,
            taskId: input.taskId || null,
            sortOrder: input.sortOrder,
          })
          .returning();
        await recalcInvoiceTotal(tx, input.invoiceId);
        return inserted;
      });

      return line;
    }),

  // Update invoice line
  updateLine: moduleWriteProcedure("invoices")
    .input(
      z.object({
        id: z.string().uuid(),
        description: z.string().min(1).optional(),
        quantity: z.string().optional(),
        unitPrice: z.string().optional(),
        amount: z.string().optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get line with invoice to verify ownership
      const line = await ctx.db.query.invoiceLines.findFirst({
        where: eq(invoiceLines.id, input.id),
      });

      if (!line) {
        throw badRequest(await tr("serverErrors", "invoices.lineNotFound"));
      }

      // Verify invoice belongs to user/org
      const invoiceOwnershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, line.invoiceId), invoiceOwnershipFilter),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }

      // Only allow editing draft invoices
      if (invoice.status !== "draft") {
        throw badRequest(
          await tr("serverErrors", "invoices.draftOnlyEditLines"),
        );
      }

      const updateData: Record<string, unknown> = {};
      if (input.description !== undefined)
        updateData.description = input.description;
      if (input.quantity !== undefined) updateData.quantity = input.quantity;
      if (input.unitPrice !== undefined) updateData.unitPrice = input.unitPrice;
      if (input.amount !== undefined) updateData.amount = input.amount;
      if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;

      const updatedLine = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(invoiceLines)
          .set(updateData)
          .where(eq(invoiceLines.id, input.id))
          .returning();
        // Only the amount affects the total, but recalc is cheap and safe.
        if (input.amount !== undefined) {
          await recalcInvoiceTotal(tx, line.invoiceId);
        }
        return updated;
      });

      return updatedLine;
    }),

  // Delete invoice line
  deleteLine: moduleWriteProcedure("invoices")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get line with invoice to verify ownership
      const line = await ctx.db.query.invoiceLines.findFirst({
        where: eq(invoiceLines.id, input.id),
      });

      if (!line) {
        throw badRequest(await tr("serverErrors", "invoices.lineNotFound"));
      }

      // Verify invoice belongs to user/org
      const invoiceOwnershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, line.invoiceId), invoiceOwnershipFilter),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }

      // Only allow editing draft invoices
      if (invoice.status !== "draft") {
        throw badRequest(
          await tr("serverErrors", "invoices.draftOnlyDeleteLines"),
        );
      }

      await ctx.db.transaction(async (tx) => {
        // Release the line's time entry so it can be re-invoiced.
        if (line.timeEntryId) {
          await releaseEntries(tx, [line.timeEntryId]);
        }
        await tx.delete(invoiceLines).where(eq(invoiceLines.id, input.id));
        await recalcInvoiceTotal(tx, line.invoiceId);
      });

      return { success: true };
    }),

  // Bulk update invoice lines (for reordering)
  updateLinesOrder: moduleWriteProcedure("invoices")
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        lines: z.array(
          z.object({
            id: z.string().uuid(),
            sortOrder: z.number(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify invoice belongs to user/org
      const invoiceOwnershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.invoiceId), invoiceOwnershipFilter),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }

      // Only allow editing draft invoices
      if (invoice.status !== "draft") {
        throw badRequest(await tr("serverErrors", "invoices.draftOnlyReorder"));
      }

      // Update each line's sort order — scope to invoiceId so an attacker
      // cannot pass another invoice's line ids and mutate their ordering.
      await ctx.db.transaction(async (tx) => {
        for (const line of input.lines) {
          await tx
            .update(invoiceLines)
            .set({ sortOrder: line.sortOrder })
            .where(
              and(
                eq(invoiceLines.id, line.id),
                eq(invoiceLines.invoiceId, input.invoiceId),
              ),
            );
        }
      });

      return { success: true };
    }),

  // Save all lines for an invoice (bulk upsert)
  saveLines: moduleWriteProcedure("invoices")
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        lines: z.array(
          z.object({
            id: z.string().optional(),
            description: z.string().min(1),
            quantity: z.string(),
            unitPrice: z.string(),
            amount: z.string(),
            timeEntryId: z.string().uuid().optional().nullable(),
            sortOrder: z.number(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify invoice belongs to user/org
      const invoiceOwnershipFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.invoiceId), invoiceOwnershipFilter),
      });

      if (!invoice) {
        throw Errors.invoiceNotFound();
      }

      // Only allow editing draft invoices
      if (invoice.status !== "draft") {
        throw badRequest(
          await tr("serverErrors", "invoices.draftOnlyEditLines"),
        );
      }

      await ctx.db.transaction(async (tx) => {
        // Get existing lines
        const existingLines = await tx.query.invoiceLines.findMany({
          where: eq(invoiceLines.invoiceId, input.invoiceId),
        });

        const existingIds = new Set(existingLines.map((l) => l.id));
        const newIds = new Set(
          input.lines
            .filter((l) => l.id && !l.id.startsWith("temp-"))
            .map((l) => l.id),
        );

        // Delete lines that are no longer present — release their time entries
        // so they're invoiceable again (cf. deleteLine).
        for (const existingLine of existingLines) {
          if (!newIds.has(existingLine.id)) {
            if (existingLine.timeEntryId) {
              await releaseEntries(tx, [existingLine.timeEntryId]);
            }
            await tx
              .delete(invoiceLines)
              .where(eq(invoiceLines.id, existingLine.id));
          }
        }

        // Update or insert lines
        for (const line of input.lines) {
          if (line.id && existingIds.has(line.id)) {
            // Update existing line
            await tx
              .update(invoiceLines)
              .set({
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                amount: line.amount,
                sortOrder: line.sortOrder,
              })
              .where(eq(invoiceLines.id, line.id));
          } else {
            // Insert new line — mark a linked time entry billed (tenant-scoped)
            // so it can't be invoiced twice (cf. createLine).
            if (line.timeEntryId) {
              const n = await markEntriesBilled(
                tx,
                [line.timeEntryId],
                input.invoiceId,
                ctx.orgId,
                userId,
                invoice.clientId,
              );
              if (n === 0) {
                throw badRequest(
                  await tr("serverErrors", "invoices.timeEntryNotFound"),
                );
              }
            }
            await tx.insert(invoiceLines).values({
              invoiceId: input.invoiceId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: line.amount,
              timeEntryId: line.timeEntryId || null,
              sortOrder: line.sortOrder,
            });
          }
        }

        // Update invoice total from lines — sumMoney rounds consistently
        // so stored total matches the visible sum of lines.
        const totalAmount = sumMoney(input.lines.map((l) => l.amount));

        await tx
          .update(invoices)
          .set({
            amount: totalAmount.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, input.invoiceId));
      });

      return { success: true };
    }),
});
