import { z } from "zod";
import { router } from "../../trpc";
import { deviceProcedure, type WebInputs, webInput } from "./device-procedure";
import { idempotencyKeyInput, withIdempotencyKey } from "./idempotency";

/**
 * Kunder og projekter for token-klienter. Alt går til web's egne
 * procedurer: arkivering bruger de samme felter som web (`isArchived` på
 * kunder, `status` på projekter), og timepris, budget og afrunding er web's
 * felter i `data` (samme input som `clients.create` / `projects.update` …).
 */

const id = z.object({ id: z.string().uuid() });

export const extClientsRouter = router({
  list: deviceProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }))
    .query(({ ctx, input }) =>
      ctx.web.clients.list({ includeArchived: input.includeArchived ?? false }),
    ),

  get: deviceProcedure
    .input(id)
    .query(({ ctx, input }) => ctx.web.clients.getById({ id: input.id })),

  /** `idempotencyKey`: samme nøgle inden for 24 timer = samme kunde. */
  create: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["clients"]["create"]>(),
        idempotencyKey: idempotencyKeyInput,
      }),
    )
    .mutation(({ ctx, input }) =>
      withIdempotencyKey(
        ctx.db,
        ctx.device,
        "clients.create",
        input.idempotencyKey,
        {
          create: () => ctx.web.clients.create(input.data),
          idOf: (c) => c.id,
          replay: (id) => ctx.web.clients.getById({ id }),
        },
      ),
    ),

  update: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: webInput<WebInputs["clients"]["update"]["data"]>(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.clients.update({ id: input.id, data: input.data }),
    ),

  archive: deviceProcedure
    .input(id)
    .mutation(({ ctx, input }) => ctx.web.clients.archive({ id: input.id })),

  unarchive: deviceProcedure
    .input(id)
    .mutation(({ ctx, input }) => ctx.web.clients.unarchive({ id: input.id })),
});

export const extProjectsRouter = router({
  /** Alle projekter i org'en inkl. arkiverede; filtrér på `status`. */
  list: deviceProcedure.query(({ ctx }) => ctx.web.projects.list()),

  get: deviceProcedure
    .input(id)
    .query(({ ctx, input }) => ctx.web.projects.getById({ id: input.id })),

  /** `idempotencyKey`: samme nøgle inden for 24 timer = samme projekt. */
  create: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["projects"]["create"]>(),
        idempotencyKey: idempotencyKeyInput,
      }),
    )
    .mutation(({ ctx, input }) =>
      withIdempotencyKey(
        ctx.db,
        ctx.device,
        "projects.create",
        input.idempotencyKey,
        {
          create: () => ctx.web.projects.create(input.data),
          idOf: (p) => p.id,
          replay: (id) => ctx.web.projects.getById({ id }),
        },
      ),
    ),

  update: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: webInput<WebInputs["projects"]["update"]["data"]>(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.projects.update({ id: input.id, data: input.data }),
    ),

  /** Status som i web: active, completed, on_hold, archived. */
  setStatus: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["active", "completed", "on_hold", "archived"]),
      }),
    )
    .mutation(({ ctx, input }) => ctx.web.projects.updateStatus(input)),

  /** Arkivér som web's arkiver-knap (projects.delete = status "archived"). */
  archive: deviceProcedure
    .input(id)
    .mutation(({ ctx, input }) => ctx.web.projects.delete({ id: input.id })),

  monthlyBudget: deviceProcedure
    .input(
      z.object({ data: webInput<WebInputs["projects"]["monthlyBudget"]>() }),
    )
    .query(({ ctx, input }) => ctx.web.projects.monthlyBudget(input.data)),
});
