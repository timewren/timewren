import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { clients, projects, timerEvents } from "@/lib/db/schema";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

/**
 * Support-læsning af timerens hændelseslog (A6). Kun admin — loggen viser
 * hvornår og fra hvilken enhed en bruger har arbejdet. Hver visning
 * auditlogges.
 */
export const adminTimerEventsRouter = router({
  timerEvents: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        from: z.date().optional(),
        to: z.date().optional(),
        limit: z.number().int().min(1).max(1000).default(300),
      }),
    )
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_timer_events",
        input.userId,
        {
          from: input.from?.toISOString() ?? null,
          to: input.to?.toISOString() ?? null,
        },
        ctx.headers,
      );

      const rows = await ctx.db
        .select()
        .from(timerEvents)
        .where(
          and(
            eq(timerEvents.userId, input.userId),
            input.from ? gte(timerEvents.createdAt, input.from) : undefined,
            input.to ? lte(timerEvents.createdAt, input.to) : undefined,
          ),
        )
        .orderBy(desc(timerEvents.createdAt))
        .limit(input.limit);

      // Navne til visning — slået op separat (ingen FK: loggen overlever
      // sletninger, så et id kan pege på noget der ikke findes længere).
      const projectIds = [
        ...new Set(rows.map((r) => r.projectId).filter(Boolean)),
      ] as string[];
      const clientIds = [
        ...new Set(rows.map((r) => r.clientId).filter(Boolean)),
      ] as string[];
      const [projectRows, clientRows] = await Promise.all([
        projectIds.length
          ? ctx.db
              .select({ id: projects.id, name: projects.name })
              .from(projects)
              .where(inArray(projects.id, projectIds))
          : Promise.resolve([]),
        clientIds.length
          ? ctx.db
              .select({ id: clients.id, name: clients.name })
              .from(clients)
              .where(inArray(clients.id, clientIds))
          : Promise.resolve([]),
      ]);
      const projectNames = new Map(projectRows.map((p) => [p.id, p.name]));
      const clientNames = new Map(clientRows.map((c) => [c.id, c.name]));

      return rows.map((r) => ({
        ...r,
        projectName: r.projectId
          ? (projectNames.get(r.projectId) ?? null)
          : null,
        clientName: r.clientId ? (clientNames.get(r.clientId) ?? null) : null,
      }));
    }),
});
