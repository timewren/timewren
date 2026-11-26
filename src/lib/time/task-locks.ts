import { inArray } from "drizzle-orm";
import type { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Acquire task locks after prepaid cards and before touching time entries.
 * Deleting a task takes its lock before clearing time_entries.task_id.
 */
export async function lockTimeEntryTasks(
  tx: Pick<Tx, "select">,
  taskIds: readonly (string | null | undefined)[],
) {
  const ids = [...new Set(taskIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return [];
  return tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(inArray(tasks.id, ids))
    .orderBy(tasks.id)
    .for("no key update");
}
