import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { tasks } from "@/lib/db/schema";

/**
 * Hvem skal have deadline-påmindelser for en opgave: den tildelte når der er
 * en, ellers opretteren. Solo-brugere er upåvirkede (opretter = tildelt).
 */
export function resolveDeadlineRecipient(task: {
  userId: string;
  assignedToUserId: string | null;
}): string {
  return task.assignedToUserId ?? task.userId;
}

/** SQL-modstykket til resolveDeadlineRecipient: opgaver hvor userId er modtager. */
export function deadlineRecipientIs(userId: string): SQL {
  // or() is typed `SQL | undefined` for empty arg lists; ours never is.
  return or(
    eq(tasks.assignedToUserId, userId),
    and(isNull(tasks.assignedToUserId), eq(tasks.userId, userId)),
  ) as SQL;
}
