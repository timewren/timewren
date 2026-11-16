import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { taskStatuses, tasks } from "@/lib/db/schema";
import { GENERAL_DEFAULT_LANES } from "./default-lanes";
import {
  type LaneCategory,
  type LegacyTaskStatus,
  legacyStatusForLane,
  resolveTaskLaneId,
} from "./lane-category";

type Db = typeof appDb;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Kolonner deles i org'en; solo-brugere ejer deres egne. */
export function laneOwnerFilter(
  orgId: string | null | undefined,
  userId: string,
) {
  return orgId
    ? eq(taskStatuses.organizationId, orgId)
    : eq(taskStatuses.userId, userId);
}

/**
 * Tavlens kolonner i rækkefølge. Den generelle tavle får standardkolonnerne
 * ved første opslag, så opgaverne og kolonnerne altid hentes fra samme sæt
 * (ellers grupperede listByStatus efter kolonner, der ikke fandtes endnu,
 * og tavlen stod tom ved første besøg).
 */
export async function listBoardLanes(
  db: Db,
  {
    userId,
    orgId,
    projectId,
  }: {
    userId: string;
    orgId: string | null | undefined;
    projectId: string | null;
  },
) {
  const scope = projectId === null ? "general" : "project";
  const where = and(
    laneOwnerFilter(orgId, userId),
    eq(taskStatuses.scope, scope),
    projectId === null
      ? sql`${taskStatuses.projectId} IS NULL`
      : eq(taskStatuses.projectId, projectId),
  );
  const rows = await db.query.taskStatuses.findMany({
    where,
    orderBy: taskStatuses.order,
  });
  if (rows.length > 0 || scope !== "general") return rows;

  await db
    .insert(taskStatuses)
    .values(
      GENERAL_DEFAULT_LANES.map((lane) => ({
        userId,
        organizationId: orgId ?? null,
        scope: "general" as const,
        projectId: null,
        name: lane.name,
        color: lane.color,
        order: lane.order,
        isArchive: lane.isArchive,
        category: lane.category,
      })),
    )
    .onConflictDoNothing();
  return db.query.taskStatuses.findMany({ where, orderBy: taskStatuses.order });
}

const LEGACY_STATUSES: readonly LegacyTaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "done",
];

/**
 * Giv opgaverne i en kolonne den gamle status, kolonnens kategori kræver
 * (når kategorien ændres, eller opgaverne flyttes hertil ved sletning af
 * en anden kolonne). completedAt sættes, når kolonnen er afsluttet, og
 * ryddes ellers, så en annullering ikke tæller som en afsluttet opgave.
 */
export async function applyLaneStatusToTasks(
  tx: Tx | Db,
  lane: { id: string; name: string; category: LaneCategory },
  taskFilter = eq(tasks.statusId, lane.id),
) {
  const now = new Date();
  for (const current of LEGACY_STATUSES) {
    const next = legacyStatusForLane(lane, current);
    if (next === current) continue;
    await tx
      .update(tasks)
      .set({ status: next, updatedAt: now })
      .where(and(taskFilter, eq(tasks.status, current)));
  }
  if (lane.category === "done") {
    await tx
      .update(tasks)
      .set({ completedAt: now, updatedAt: now })
      .where(and(taskFilter, isNull(tasks.completedAt)));
  } else {
    await tx
      .update(tasks)
      .set({ completedAt: null, updatedAt: now })
      .where(and(taskFilter, sql`${tasks.completedAt} IS NOT NULL`));
  }
}

/**
 * Giv de kort, tavlen viser i kolonnen, kolonnen som statusId. Tavlen
 * placerer også opgaver uden statusId, opgaver med en kolonne fra et
 * gammelt projektboard og opgaver, hvis status er ændret andetsteds
 * (resolveTaskLaneId). Før kolonnens kategori ændres, eller dens opgaver
 * flyttes ved sletning, skal de følge med, ellers hopper de til en anden
 * kolonne i stedet for at skifte status.
 */
export async function claimLaneTasks(
  tx: Tx | Db,
  lane: { id: string; scope: string; projectId: string | null },
  {
    userId,
    orgId,
  }: {
    userId: string;
    orgId: string | null | undefined;
  },
) {
  const boardLanes = await tx
    .select({
      id: taskStatuses.id,
      name: taskStatuses.name,
      category: taskStatuses.category,
      order: taskStatuses.order,
    })
    .from(taskStatuses)
    .where(
      and(
        laneOwnerFilter(orgId, userId),
        eq(taskStatuses.scope, lane.scope),
        lane.projectId === null
          ? sql`${taskStatuses.projectId} IS NULL`
          : eq(taskStatuses.projectId, lane.projectId),
      ),
    );
  // Samme opgaver som listByStatus for tavlen.
  const shown = await tx
    .select({ id: tasks.id, statusId: tasks.statusId, status: tasks.status })
    .from(tasks)
    .where(
      and(
        orgId ? eq(tasks.organizationId, orgId) : eq(tasks.userId, userId),
        isNull(tasks.parentTaskId),
        lane.projectId === null
          ? undefined
          : eq(tasks.projectId, lane.projectId),
      ),
    );
  const ids = shown
    .filter(
      (t) =>
        t.statusId !== lane.id && resolveTaskLaneId(t, boardLanes) === lane.id,
    )
    .map((t) => t.id);
  for (let i = 0; i < ids.length; i += 1000) {
    await tx
      .update(tasks)
      .set({ statusId: lane.id })
      .where(inArray(tasks.id, ids.slice(i, i + 1000)));
  }
}

/**
 * Opgaven er ikke annulleret: rapporter, der tæller afsluttede opgaver
 * (status "done"), skal udelade dem i en annulleret kolonne.
 */
export function notCancelledTask() {
  // The subquery columns are written out: db.query.tasks.findMany rewrites
  // every column in a sql template to the "tasks" alias, which turned this
  // into `SELECT "tasks"."id" FROM "task_statuses"` (Sentry TIMETRACK-23).
  const cancelledIds = sql.raw(
    `SELECT "task_statuses"."id" FROM "task_statuses" WHERE "task_statuses"."category" = 'cancelled'`,
  );
  return sql`(${tasks.statusId} IS NULL OR ${tasks.statusId} NOT IN (${cancelledIds}))`;
}

/** Gem kortenes rækkefølge i én kolonne (position = indeks). */
export async function saveTaskOrder(
  tx: Tx | Db,
  orderedTaskIds: readonly string[],
  ownership: ReturnType<typeof eq>,
) {
  if (orderedTaskIds.length === 0) return;
  const ids = sql.join(
    orderedTaskIds.map((id) => sql`${id}`),
    sql`, `,
  );
  await tx.execute(sql`
    UPDATE ${tasks}
    SET position = data.pos - 1
    FROM unnest(ARRAY[${ids}]::uuid[]) WITH ORDINALITY AS data(id, pos)
    WHERE ${tasks.id} = data.id AND ${ownership}
  `);
}

/** Antal af `ids`, der hører til ejeren (org eller solo-bruger). */
export async function countOwnedTasks(
  tx: Tx | Db,
  ids: readonly string[],
  ownership: ReturnType<typeof eq>,
) {
  if (ids.length === 0) return 0;
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(inArray(tasks.id, [...ids]), ownership));
  return Number(count);
}
