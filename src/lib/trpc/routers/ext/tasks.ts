import { z } from "zod";
import { collectTaskPages } from "@/lib/tasks/task-pages";
import { router } from "../../trpc";
import { deviceProcedure, type WebInputs, webInput } from "./device-procedure";
import { idempotencyKeyInput, withIdempotencyKey } from "./idempotency";

/**
 * Opgaver for token-klienter, som web's tasks-router: liste (med
 * `trackedMinutes` = registreret tid på opgaven), opret, ret status og
 * registrér tid på en opgave.
 */

const id = z.object({ id: z.string().uuid() });

export const extTasksRouter = router({
  /** Samme filtre som web (status, prioritet, projekt, kunde …). */
  list: deviceProcedure
    .input(
      z.object({ filter: webInput<WebInputs["tasks"]["list"]>().optional() }),
    )
    .query(({ ctx, input }) =>
      collectTaskPages((cursor) =>
        ctx.web.tasks.list({ ...input.filter, restPage: undefined, cursor }),
      ),
    ),

  get: deviceProcedure
    .input(id)
    .query(({ ctx, input }) => ctx.web.tasks.getById({ id: input.id })),

  /**
   * Kanban-baner (brugerdefinerede statusser) for et projekt eller org'en,
   * med `category` (not_started, in_progress, done, cancelled).
   */
  statuses: deviceProcedure
    .input(z.object({ projectId: z.string().uuid().nullable().optional() }))
    .query(({ ctx, input }) =>
      ctx.web.taskStatuses.listForContext({
        projectId: input.projectId ?? null,
      }),
    ),

  /** `idempotencyKey`: samme nøgle inden for 24 timer = samme opgave. */
  create: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["tasks"]["create"]>(),
        idempotencyKey: idempotencyKeyInput,
      }),
    )
    .mutation(({ ctx, input }) =>
      withIdempotencyKey(
        ctx.db,
        ctx.device,
        "tasks.create",
        input.idempotencyKey,
        {
          create: () => ctx.web.tasks.create(input.data),
          idOf: (t) => t.id,
          replay: (id) => ctx.web.tasks.getById({ id }),
        },
      ),
    ),

  update: deviceProcedure
    .input(z.object({ data: webInput<WebInputs["tasks"]["update"]>() }))
    .mutation(({ ctx, input }) => ctx.web.tasks.update(input.data)),

  /** Status som web: backlog, todo, in_progress, done. */
  setStatus: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["backlog", "todo", "in_progress", "done"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      input.status === "done"
        ? ctx.web.tasks.markDone({ id: input.id })
        : ctx.web.tasks.update({ id: input.id, status: input.status }),
    ),

  /**
   * Flyt opgaven til en bane (egne statusser) som web's tavle. Banens
   * kategori sætter `status`; `orderedTaskIds` gemmer banens rækkefølge.
   */
  move: deviceProcedure
    .input(z.object({ data: webInput<WebInputs["tasks"]["move"]>() }))
    .mutation(({ ctx, input }) => ctx.web.tasks.move(input.data)),

  reopen: deviceProcedure
    .input(id)
    .mutation(({ ctx, input }) => ctx.web.tasks.reopen({ id: input.id })),

  /** Slet opgaven og dens underopgaver (web's tasks.delete). */
  delete: deviceProcedure
    .input(id)
    .mutation(({ ctx, input }) => ctx.web.tasks.delete({ id: input.id })),

  /**
   * Underopgave under en opgave i org'en (arver projekt, kunde og
   * prioritet). `idempotencyKey`: samme nøgle inden for 24 timer = samme
   * underopgave.
   */
  createSubtask: deviceProcedure
    .input(
      z.object({
        parentTaskId: z.string().uuid(),
        title: z.string(),
        description: z.string().optional(),
        idempotencyKey: idempotencyKeyInput,
      }),
    )
    .mutation(({ ctx, input }) =>
      withIdempotencyKey(
        ctx.db,
        ctx.device,
        "tasks.createSubtask",
        input.idempotencyKey,
        {
          create: () =>
            ctx.web.tasks.createSubtask({
              parentTaskId: input.parentTaskId,
              title: input.title,
              description: input.description,
            }),
          idOf: (t) => t.id,
          replay: (id) => ctx.web.tasks.getById({ id }),
        },
      ),
    ),

  /**
   * Tildel opgaven et medlem af org'en (`null` = ingen). Medlemmerne står i
   * `extension.org.members`.
   */
  setAssignee: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        assignedToUserId: z.string().nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.tasks.setAssignee({
        id: input.id,
        assignedToUserId: input.assignedToUserId,
      }),
    ),

  /** Poster registreret på opgaven. */
  timeEntries: deviceProcedure
    .input(id)
    .query(({ ctx, input }) => ctx.web.time.list({ taskId: input.id })),

  /**
   * Registrér tid på en opgave (web's time.create med `taskId`). Send
   * `clientEntryId` med, så et gentaget kald fra offline-køen ikke giver en
   * dublet.
   */
  logTime: deviceProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: webInput<Omit<WebInputs["time"]["create"], "taskId">>(),
        /** Som `clientEntryId` (bruges, hvis den ikke er sat). */
        idempotencyKey: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.time.create({
        ...input.data,
        clientEntryId: input.data.clientEntryId ?? input.idempotencyKey,
        taskId: input.id,
      }),
    ),
});
