import { tauriInvoke } from "./tauri";
import { entryFromActivity, resolveClientId } from "./timeEntryActions";
import type { Activity, Project } from "./types";

/**
 * Bulk operations on tracked time. Each run walks its activities one at a time
 * over IPC, so a run takes as long as the slowest call — long enough for a
 * second click to land.
 *
 * The buttons that start these runs are disabled while one is in flight, but
 * that is a rendering state, not a promise: React re-renders after the handler
 * returns, and a fast second click can be delivered before the `disabled`
 * attribute exists. A module-level lock makes the operations themselves
 * idempotent, because a duplicate `create_time_entry` is duplicated billed time
 * and a duplicated run cannot be undone from the UI.
 *
 * The lock covers all four operations: they write the same activities, so
 * running two of them at once interleaves classifications, entries and
 * deletions.
 */
let inFlight = false;

/** True while a bulk operation is running. Intended for tests and diagnostics. */
export function bulkRunInFlight(): boolean {
  return inFlight;
}

function findActivity(
  activities: Activity[],
  id: number,
): Activity | undefined {
  return activities.find((a) => a.id === id);
}

/**
 * Hvad en kørsl endte med.
 *
 * `fejlede` er de aktiviteter, hvis par af skrivninger ikke blev færdigt. Det er
 * dem, kaldérens skærm skal holde valget på: en kørsl går én aktivitet ad gangen
 * over IPC og kan fejle på den tredje af syv, så uden listen ved skærmen ikke hvilke
 * der rent faktisk fik skrevet — og et nyt forsøg over hele det gamle valg ville
 * skrive dobbelt tid for de første.
 *
 * `kørte` er false når en anden kørsl holdt låsen, altså når dette kald slet ikke
 * gjorde noget og hverken skal rydde valget eller vise en fejl.
 */
export interface BulkResultat {
  kørte: boolean;
  fejlede: number[];
}

/** Dette kald gjorde intet, fordi en anden kørsl holdt låsen. */
const IKKE_KØRT: BulkResultat = { kørte: false, fejlede: [] };

/**
 * Confirm each activity into `projectId` and register it as a time entry.
 */
export async function bulkAssignProject(
  activityIds: Iterable<number>,
  activities: Activity[],
  projects: Project[],
  projectId: string,
): Promise<BulkResultat> {
  if (inFlight) return IKKE_KØRT;
  inFlight = true;
  const fejlede: number[] = [];
  try {
    for (const actId of activityIds) {
      const activity = findActivity(activities, actId);
      if (!activity) continue;
      // Én fejl må ikke opgive resten af dagen: de følgende aktiviteter er
      // lige så gyldige, og hver skal have sit eget forsøg.
      try {
        await tauriInvoke("confirm_classification", {
          activityId: actId,
          projectId,
          clientId: resolveClientId(activity, projectId, projects),
          category: activity.category ?? "development",
        });

        await tauriInvoke("create_time_entry", {
          input: entryFromActivity(activity, projectId, projects, true),
        });
      } catch (err) {
        console.error(`Bulk assign failed for activity ${actId}:`, err);
        fejlede.push(actId);
      }
    }
    return { kørte: true, fejlede };
  } finally {
    inFlight = false;
  }
}

/**
 * Confirm a batch of classifications in one IPC call, then register one time
 * entry per activity. Used by the timeline's "confirm all" and its per-block
 * confirm — both register every activity in the run, so both are covered by
 * this lock. Resolves true when the run happened.
 */
export async function bulkConfirmActivities(
  activities: Activity[],
  projects: Project[],
): Promise<BulkResultat> {
  if (inFlight) return IKKE_KØRT;
  inFlight = true;
  const fejlede: number[] = [];
  try {
    try {
      await tauriInvoke("bulk_confirm_classifications", {
        items: activities.map((a) => ({
          activity_id: a.id,
          project_id: a.project_id,
          client_id: a.client_id,
          category: a.category,
        })),
      });
    } catch (err) {
      // Bekræftelsen er én samlet skrivning, så fejlede den, er ingen af dem
      // bekræftet — og ingen har fået en registrering. Alle er opgivet.
      console.error("Bulk confirm failed:", err);
      return { kørte: true, fejlede: activities.map((a) => a.id) };
    }
    for (const activity of activities) {
      try {
        await tauriInvoke("create_time_entry", {
          input: entryFromActivity(
            activity,
            activity.project_id,
            projects,
            activity.category !== "personal",
          ),
        });
      } catch (err) {
        console.error(`Bulk register failed for activity ${activity.id}:`, err);
        fejlede.push(activity.id);
      }
    }
    return { kørte: true, fejlede };
  } finally {
    inFlight = false;
  }
}

/** Delete each activity. En fejl stopper ikke de næste sletninger. */
export async function bulkDelete(
  activityIds: Iterable<number>,
): Promise<BulkResultat> {
  if (inFlight) return IKKE_KØRT;
  inFlight = true;
  const fejlede: number[] = [];
  try {
    for (const actId of activityIds) {
      try {
        await tauriInvoke("delete_activity", { activityId: actId });
      } catch (err) {
        console.error(`Bulk delete failed for activity ${actId}:`, err);
        fejlede.push(actId);
      }
    }
    return { kørte: true, fejlede };
  } finally {
    inFlight = false;
  }
}

/**
 * Re-classify each activity as personal so it stops counting as billable.
 * Resolves true when the run happened.
 */
export async function bulkMarkNonBillable(
  activityIds: Iterable<number>,
  activities: Activity[],
): Promise<BulkResultat> {
  if (inFlight) return IKKE_KØRT;
  inFlight = true;
  const fejlede: number[] = [];
  try {
    for (const actId of activityIds) {
      const activity = findActivity(activities, actId);
      if (!activity) continue;

      try {
        await tauriInvoke("confirm_classification", {
          activityId: actId,
          projectId: activity.project_id,
          clientId: activity.client_id,
          category: "personal",
        });
      } catch (err) {
        console.error(`Bulk mark failed for activity ${actId}:`, err);
        fejlede.push(actId);
      }
    }
    return { kørte: true, fejlede };
  } finally {
    inFlight = false;
  }
}

/**
 * Behold kun de id'er, hvis skrivninger ikke blev færdigt — dem, kørslen
 * rapporterede som fejlede.
 *
 * Bruges efter en fejlet kørsl: skærmen genindlæses, så en delvis kørsl ikke længer
 * ser ud til at være udført, og valget bliver præcis det arbejde, der er tilbage.
 *
 * Bevidst *kun* efter kørslens egen liste, ikke «alt der ikke er bekræftet»:
 * `confirm_classification` og `create_time_entry` er to skrivninger, og kan den
 * første lykkes mens den anden fejler, står aktiviteten i databasen som bekræftet
 * *uden* en registrering. Den skal derfor stadig kunne vælges igen — den tid er
 * ikke skrevet endnu, og den går tabt, hvis vi lader den ligge.
 */
export function kunFejlede(
  fejlede: number[],
  aktiviteter: Activity[],
): Set<number> {
  const stadigHer = new Set<number>();
  for (const id of fejlede) {
    // Et id der ikke længer findes (slettet, eller et nyt døgn) kan ikke bruges.
    if (findActivity(aktiviteter, id)) stadigHer.add(id);
  }
  return stadigHer;
}
