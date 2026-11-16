import { eq } from "drizzle-orm";
import { z } from "zod";
import { timerStates } from "@/lib/db/schema";
import { router } from "../../trpc";
import { extensionRouter } from "../extension";
import { deviceProcedure } from "./device-procedure";

/**
 * Den fælles timer for token-klienter (desktop 0.2.23). Start, pause og stop
 * går stadig gennem de flade `extension.updateTimerState`/`claimForStop`/
 * `confirmStop`; her ligger det, de ikke dækker direkte.
 */
export const extTimerRouter = router({
  /**
   * Skift kunde, projekt og opgave på den kørende (eller pausede) timer uden
   * at stoppe den. Målet er hele trippelen: et udeladt `taskId` rydder
   * opgaven.
   *
   * Skrivningen er updateTimerState's metadata-skrivning med appens
   * `sessionId`: én atomisk upsert, der kun lander på netop den session og
   * aldrig midt i et stop eller på en ryddet række. Svaret er timerens
   * tilstand; `sessionMismatch: true` (anden eller ingen session) og
   * `stoppingInProgress: true` betyder, at intet blev skrevet. Med
   * `expectedVersion` giver en ændret række CONFLICT.
   */
  setTarget: deviceProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        projectId: z.string().uuid().nullable(),
        clientId: z.string().uuid().nullable(),
        taskId: z.string().uuid().nullable().optional(),
        expectedVersion: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Uden timer-række er der ingen session at skifte på; updateTimerState
      // ville ellers oprette en (upsert'ens insert-gren). Kun en
      // klassifikation: skrivningen nedenfor er stadig atomisk på sessionen.
      const row = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, ctx.device.userId),
        columns: { id: true },
      });
      if (!row) {
        return {
          isRunning: false,
          startTime: null,
          elapsedSeconds: 0,
          baseSeconds: 0,
          projectId: null,
          clientId: null,
          taskId: null,
          description: "",
          project: null,
          client: null,
          lastSyncedAt: null,
          version: 0,
          sessionId: null,
          intent: null,
          sessionMismatch: true,
        };
      }
      // Modul-vagten (browser_extension) har allerede godkendt dette kald.
      const extension = extensionRouter.createCaller({
        session: null,
        db: ctx.db,
        headers: ctx.headers,
      } as never);
      return extension.updateTimerState({
        // deviceProcedure har afvist kald uden token (input eller header).
        token: input.token as string,
        // Den org, deviceProcedure har godkendt (FORBIDDEN ellers).
        organizationId: ctx.device.orgId ?? undefined,
        source: "extension",
        sessionId: input.sessionId,
        projectId: input.projectId,
        clientId: input.clientId,
        taskId: input.taskId ?? null,
        expectedVersion: input.expectedVersion,
      });
    }),
});
