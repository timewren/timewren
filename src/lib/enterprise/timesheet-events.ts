import { timesheetWeekEvents } from "@/lib/db/schema";
import { type AuditDb, resolveUserLabel } from "@/lib/org-audit";

/**
 * Skriver en række til timesheet_week_events (append-only, 5 års retention)
 * med tekst-snapshot af medarbejder og aktør (#479), så hændelsen forbliver
 * læsbar efter brugeren er slettet (user_id/actor_id bliver SET NULL).
 * Skal kaldes med den transaktion mutationen af timesheet_weeks kører i.
 */
export async function insertTimesheetWeekEvent(
  tx: AuditDb,
  event: {
    organizationId: string;
    userId: string;
    weekStart: string;
    event: "submitted" | "approved" | "rejected" | "reopened";
    actorId: string;
    reason?: string | null;
    totalHours?: string | null;
    /** Forud-opløste labels (spar opslag i bulk-godkendelse) */
    userLabel?: string | null;
    actorLabel?: string | null;
  },
): Promise<void> {
  const userLabel =
    event.userLabel !== undefined
      ? event.userLabel
      : await resolveUserLabel(tx, event.userId);
  const actorLabel =
    event.actorLabel !== undefined
      ? event.actorLabel
      : event.actorId === event.userId
        ? userLabel
        : await resolveUserLabel(tx, event.actorId);
  await tx.insert(timesheetWeekEvents).values({
    ...event,
    userLabel,
    actorLabel,
  });
}
