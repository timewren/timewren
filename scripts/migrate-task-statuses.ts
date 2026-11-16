/**
 * One-off data migration for task_statuses.
 *
 * Idempotent — safe to run multiple times. After all tasks have a
 * status_id, make the column NOT NULL in a follow-up commit (not
 * this script, to avoid risk in the first rollout).
 *
 * Usage:
 *   tsx scripts/migrate-task-statuses.ts
 */

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, taskStatuses, tasks, users } from "@/lib/db/schema";
import {
  GENERAL_DEFAULT_LANES,
  mapLegacyStatusToLaneName,
  PROJECT_DEFAULT_LANES,
} from "@/lib/kanban/default-lanes";

async function main() {
  console.log("[migrate-task-statuses] starting…");

  // ── Step 1: seed general lanes for every user ───────────────────────
  const allUsers = await db.select({ id: users.id }).from(users);
  console.log(`users: ${allUsers.length}`);

  for (const user of allUsers) {
    // Skip if this user already has general lanes (idempotent).
    const existing = await db
      .select({ id: taskStatuses.id })
      .from(taskStatuses)
      .where(
        and(
          eq(taskStatuses.userId, user.id),
          eq(taskStatuses.scope, "general"),
        ),
      );
    if (existing.length > 0) continue;

    await db.insert(taskStatuses).values(
      GENERAL_DEFAULT_LANES.map((lane) => ({
        userId: user.id,
        scope: "general",
        projectId: null,
        name: lane.name,
        color: lane.color,
        order: lane.order,
        isArchive: lane.isArchive,
        category: lane.category,
      })),
    );
  }
  console.log("✓ general lanes seeded");

  // ── Step 2: seed project lanes for every existing project ───────────
  const allProjects = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects);
  console.log(`projects: ${allProjects.length}`);

  for (const project of allProjects) {
    const existing = await db
      .select({ id: taskStatuses.id })
      .from(taskStatuses)
      .where(
        and(
          eq(taskStatuses.projectId, project.id),
          eq(taskStatuses.scope, "project"),
        ),
      );
    if (existing.length > 0) continue;

    await db.insert(taskStatuses).values(
      PROJECT_DEFAULT_LANES.map((lane) => ({
        userId: project.userId,
        scope: "project",
        projectId: project.id,
        name: lane.name,
        color: lane.color,
        order: lane.order,
        isArchive: lane.isArchive,
        category: lane.category,
      })),
    );
  }
  console.log("✓ project lanes seeded");

  // ── Step 3: populate tasks.status_id for general tasks ──────────────
  // General tasks have project_id IS NULL. Match by user + general-lane name.
  const generalTasks = await db
    .select({
      id: tasks.id,
      userId: tasks.userId,
      status: tasks.status,
    })
    .from(tasks)
    .where(and(isNull(tasks.statusId), isNull(tasks.projectId)));
  console.log(`general tasks to migrate: ${generalTasks.length}`);

  for (const task of generalTasks) {
    const name = mapLegacyStatusToLaneName(task.status);
    if (!name) {
      console.warn(
        `task ${task.id} has unknown status ${task.status} — skipping`,
      );
      continue;
    }
    const [lane] = await db
      .select({ id: taskStatuses.id })
      .from(taskStatuses)
      .where(
        and(
          eq(taskStatuses.userId, task.userId),
          eq(taskStatuses.scope, "general"),
          eq(taskStatuses.name, name),
        ),
      )
      .limit(1);
    if (!lane) continue;
    await db
      .update(tasks)
      .set({ statusId: lane.id })
      .where(eq(tasks.id, task.id));
  }
  console.log("✓ general tasks populated");

  // ── Step 4: populate tasks.status_id for project tasks ──────────────
  // Project tasks with status 'backlog' are special: project defaults
  // don't include a Backlog lane. Add one per-project on demand.
  const projectTasks = await db
    .select({
      id: tasks.id,
      userId: tasks.userId,
      projectId: tasks.projectId,
      status: tasks.status,
    })
    .from(tasks)
    .where(and(isNull(tasks.statusId), isNotNull(tasks.projectId)));
  console.log(`project tasks to migrate: ${projectTasks.length}`);

  for (const task of projectTasks) {
    const name = mapLegacyStatusToLaneName(task.status);
    if (!name || !task.projectId) continue;

    // Find the corresponding lane in this project.
    let [lane] = await db
      .select({ id: taskStatuses.id })
      .from(taskStatuses)
      .where(
        and(
          eq(taskStatuses.projectId, task.projectId),
          eq(taskStatuses.scope, "project"),
          eq(taskStatuses.name, name),
        ),
      )
      .limit(1);

    // Edge case: project has a task in 'backlog' but no Backlog lane
    // (projects default to 3 lanes, no Backlog). Insert a Backlog lane
    // with order = max + 1 so it doesn't shift existing orders.
    if (!lane && name === "Backlog") {
      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`coalesce(max("order"), -1)` })
        .from(taskStatuses)
        .where(
          and(
            eq(taskStatuses.projectId, task.projectId),
            eq(taskStatuses.scope, "project"),
          ),
        );
      const [inserted] = await db
        .insert(taskStatuses)
        .values({
          userId: task.userId,
          scope: "project",
          projectId: task.projectId,
          name: "Backlog",
          color: "#9ca3af",
          order: Number(maxOrder) + 1,
          isArchive: false,
        })
        .returning({ id: taskStatuses.id });
      lane = inserted;
    }
    if (!lane) continue;
    await db
      .update(tasks)
      .set({ statusId: lane.id })
      .where(eq(tasks.id, task.id));
  }
  console.log("✓ project tasks populated");

  // ── Step 5: report remaining NULLs ──────────────────────────────────
  const remaining = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(isNull(tasks.statusId));
  if (remaining.length > 0) {
    console.warn(
      `⚠ ${remaining.length} tasks still have NULL status_id — inspect manually`,
    );
    for (const t of remaining.slice(0, 10))
      console.warn(`  ${t.id}: ${t.status}`);
  } else {
    console.log("✓ every task has a status_id");
  }

  console.log("[migrate-task-statuses] done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
