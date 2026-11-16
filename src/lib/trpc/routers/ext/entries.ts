import { z } from "zod";
import { router } from "../../trpc";
import { deviceProcedure, type WebInputs, webInput } from "./device-procedure";

/**
 * Tidsposter via web's time-router. Til desktop frem for de ældre
 * `extension.createTimeEntry/updateTimeEntry`: web's `time.create` sætter
 * timeprisen efter hierarkiet (projekt → kunde → bruger), trækker klippekort,
 * håndhæver låste perioder og er idempotent med `clientEntryId`.
 */
export const extEntriesRouter = router({
  /** Samme filtre som web (periode, projekt, kunde, opgave, faktureret …). */
  list: deviceProcedure
    .input(
      z.object({ filter: webInput<WebInputs["time"]["list"]>().optional() }),
    )
    .query(({ ctx, input }) => ctx.web.time.list(input.filter)),

  get: deviceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => ctx.web.time.getById({ id: input.id })),

  /**
   * Send `clientEntryId` (eller `idempotencyKey`, som bruges som
   * `clientEntryId`), så et gentaget kald ikke giver en dublet.
   */
  create: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["time"]["create"]>(),
        idempotencyKey: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.time.create({
        ...input.data,
        clientEntryId: input.data.clientEntryId ?? input.idempotencyKey,
      }),
    ),

  update: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: webInput<WebInputs["time"]["update"]["data"]>(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.time.update({ id: input.id, data: input.data }),
    ),

  delete: deviceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => ctx.web.time.delete({ id: input.id })),
});
