import { z } from "zod";
import { router } from "../../trpc";
import { deviceProcedure, type WebInputs, webInput } from "./device-procedure";
import { idempotencyKeyInput, withIdempotencyKey } from "./idempotency";

/**
 * Fakturaer for token-klienter. Ingen ny forretningslogik: kladde fra
 * ufaktureret tid, linjer, rettelser, afsendelse, betalt-markering og
 * eksport til Billy/Dinero/e-conomic er web's procedurer, med web's
 * abonnementsvagt (alle planer, kapacitet er den eneste grænse), rolle og
 * modul-vagt. PDF'en hentes fra `/api/ext/invoices/<id>/pdf` med tokenet.
 */

const id = z.object({ id: z.string().uuid() });

export const extInvoicesRouter = router({
  list: deviceProcedure
    .input(
      z.object({
        filter: webInput<WebInputs["invoices"]["list"]>().optional(),
      }),
    )
    .query(({ ctx, input }) => ctx.web.invoices.list(input.filter)),

  get: deviceProcedure
    .input(id)
    .query(({ ctx, input }) => ctx.web.invoices.getById({ id: input.id })),

  /** Ufaktureret tid pr. kunde (til "lav faktura"-oversigten). */
  uninvoicedSummary: deviceProcedure.query(({ ctx }) =>
    ctx.web.invoices.getUninvoicedSummary(),
  ),

  /** Ufakturerede poster for én kunde. */
  uninvoicedEntries: deviceProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      ctx.web.invoices.getUninvoicedTimeEntries({ clientId: input.clientId }),
    ),

  /** Forhåndsvisning af en kladde fra ufaktureret tid (periode som web). */
  previewDraft: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["invoices"]["previewFromTimeEntries"]>(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.web.invoices.previewFromTimeEntries(input.data),
    ),

  /**
   * Kladde fra valgte ufakturerede poster (web's generateFromTimeEntries).
   * `idempotencyKey`: samme nøgle inden for 24 timer = samme kladde
   * (gentaget svar: `invoice` og `lines` frisk, `lineItems` tom).
   */
  createDraft: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["invoices"]["generateFromTimeEntries"]>(),
        idempotencyKey: idempotencyKeyInput,
      }),
    )
    .mutation(({ ctx, input }) =>
      withIdempotencyKey(
        ctx.db,
        ctx.device,
        "invoices.createDraft",
        input.idempotencyKey,
        {
          create: () => ctx.web.invoices.generateFromTimeEntries(input.data),
          idOf: (d) => d.invoice.id,
          replay: async (id) => {
            const invoice = await ctx.web.invoices.getById({ id });
            const lines = await ctx.web.invoices.getLines({ invoiceId: id });
            return {
              invoice,
              lineItems: [],
              totalAmount: Number(invoice.amount),
              lines,
            };
          },
        },
      ),
    ),

  update: deviceProcedure
    .input(z.object({ data: webInput<WebInputs["invoices"]["update"]>() }))
    .mutation(({ ctx, input }) => ctx.web.invoices.update(input.data)),

  lines: deviceProcedure
    .input(id)
    .query(({ ctx, input }) =>
      ctx.web.invoices.getLines({ invoiceId: input.id }),
    ),

  /** Linjer for mange fakturaer i ét kald: fakturaens id → linjer. */
  linesByInvoice: deviceProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).max(500) }))
    .query(({ ctx, input }) =>
      ctx.web.invoices.linesByInvoice({ ids: input.ids }),
    ),

  /** Gem alle linjer på én gang (som web's linje-editor). */
  saveLines: deviceProcedure
    .input(z.object({ data: webInput<WebInputs["invoices"]["saveLines"]>() }))
    .mutation(({ ctx, input }) => ctx.web.invoices.saveLines(input.data)),

  /** Udsted (rigtigt fakturanummer) og send til kundens mail med PDF. */
  send: deviceProcedure
    .input(id)
    .mutation(({ ctx, input }) => ctx.web.invoices.sendEmail({ id: input.id })),

  /** Markér betalt som REST v1 (status "paid", valgfri betalingsdato). */
  markPaid: deviceProcedure
    .input(z.object({ id: z.string().uuid(), paidDate: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      ctx.web.invoices.update({
        id: input.id,
        status: "paid",
        paidDate: input.paidDate,
      }),
    ),

  /** Eksport til regnskabsprogrammet, opsat i web (samme input som web). */
  exportToBilly: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["integrations"]["exportInvoiceToBilly"]>(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.integrations.exportInvoiceToBilly(input.data),
    ),
  exportToDinero: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["integrations"]["exportInvoiceToDinero"]>(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.integrations.exportInvoiceToDinero(input.data),
    ),
  exportToEconomic: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["integrations"]["exportInvoiceToEconomic"]>(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.integrations.exportInvoiceToEconomic(input.data),
    ),

  /**
   * Sti til PDF'en. Hentes med `Authorization: Bearer <token>` (samme org-
   * parameter som kaldet), så tokenet aldrig står i en URL.
   */
  pdfLink: deviceProcedure.input(id).query(async ({ ctx, input }) => {
    // Kaster NOT_FOUND, hvis fakturaen ikke findes i org'en.
    await ctx.web.invoices.getById({ id: input.id });
    const query = ctx.device.orgId
      ? `?organizationId=${encodeURIComponent(ctx.device.orgId)}`
      : "";
    return { path: `/api/ext/invoices/${input.id}/pdf${query}` };
  }),
});
