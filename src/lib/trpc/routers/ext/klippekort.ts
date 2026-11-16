import { z } from "zod";
import { router } from "../../trpc";
import { deviceProcedure, type WebInputs, webInput } from "./device-procedure";
import { idempotencyKeyInput, withIdempotencyKey } from "./idempotency";

/**
 * Klippekort via web's prepaid-router. Modul-vagten ("klippekort"),
 * erhvervs-tier og rolle er web's egne, fordi kaldet går gennem
 * createWebCaller. Saldo og træk beregnes altid på serveren; desktop viser
 * kun det, web svarer.
 */
export const extKlippekortRouter = router({
  /** Samme filtre som web (kunde, kun aktive, med arkiverede). */
  list: deviceProcedure
    .input(
      z.object({
        filter:
          webInput<NonNullable<WebInputs["prepaid"]["list"]>>().optional(),
      }),
    )
    .query(({ ctx, input }) => ctx.web.prepaid.list(input.filter)),

  get: deviceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => ctx.web.prepaid.getById({ id: input.id })),

  /** `idempotencyKey`: samme nøgle inden for 24 timer = samme kort. */
  create: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["prepaid"]["create"]>(),
        idempotencyKey: idempotencyKeyInput,
      }),
    )
    .mutation(({ ctx, input }) =>
      withIdempotencyKey(
        ctx.db,
        ctx.device,
        "klippekort.create",
        input.idempotencyKey,
        {
          create: () => ctx.web.prepaid.create(input.data),
          idOf: (p) => p.id,
          replay: (id) => ctx.web.prepaid.getById({ id }),
        },
      ),
    ),

  update: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: webInput<WebInputs["prepaid"]["update"]["data"]>(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.prepaid.update({ id: input.id, data: input.data }),
    ),

  /**
   * Fyld timer på et eksisterende kort. `idempotencyKey`: samme nøgle inden
   * for 24 timer fylder kun på én gang (gentaget svar: kortet frisk).
   */
  topUp: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        hours: z.number(),
        note: z.string().optional(),
        idempotencyKey: idempotencyKeyInput,
      }),
    )
    .mutation(({ ctx, input }) =>
      withIdempotencyKey(
        ctx.db,
        ctx.device,
        "klippekort.topUp",
        input.idempotencyKey,
        {
          create: () =>
            ctx.web.prepaid.topUp({
              packageId: input.id,
              hours: input.hours,
              note: input.note,
            }),
          idOf: (p) => p.id,
          replay: (id) => ctx.web.prepaid.getById({ id }),
        },
      ),
    ),

  archive: deviceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => ctx.web.prepaid.archive({ id: input.id })),
});
