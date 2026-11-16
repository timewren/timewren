import { tauriInvoke } from "./tauri";
import type { Activity, Project } from "./types";

/** The payload `create_time_entry` takes, as the screens that register time build it. */
export interface TimeEntryInput {
  project_id: string | null;
  client_id: string | null;
  klippekort_id: string | null;
  description: string | null;
  start_time: string;
  end_time: string;
  duration: number;
  is_billable: boolean;
  /**
   * Sættes kun af pomodoro-registreringen, og kun fordi den skal kunne siges
   * i tidslinjen: uden den ved ingen, at fasens minutter allerede er bogført, så
   * den samme halve time står to steder uden at nogen af dem siger det.
   *
   * Valgfrit fordi alle andre veje ind i `create_time_entry` er manuelle eller
   * automatiske og intet har med pomodoro at gøre.
   */
  pomodoro_session_id?: string | null;
}

/** A form's date + two clock times, resolved to what the entry is stored with. */
export interface ResolvedEntryTimes {
  start_time: string;
  end_time: string;
  duration: number;
  /** Sluttidspunktet ligger på dagen efter den valgte dato (nattskift). */
  crossesMidnight: boolean;
}

export type ResolvedEntryTimesResult =
  | { ok: true; times: ResolvedEntryTimes }
  | { ok: false; error: "startMissing" | "endMissing" | "endNotAfterStart" };

/** Moves a `YYYY-MM-DD` date one day forward, across month and year ends. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Turns a form's date + start/end clock times into the timestamps the entry is
 * stored with.
 *
 * An end time EARLIER than the start time is not a mistake — a shift from 22:00
 * to 02:00 crosses midnight, so the end belongs to the following day. Rolling it
 * forward is what the user meant, and the calendar already draws such an entry
 * as one block per day (`splitAtMidnight`), so it is a view they recognise. Only
 * equal times are a real error: there is no time to bill.
 *
 * The end is never more than one day forward, so a 48-hour typo becomes an
 * obvious 4-hour entry the user can see and fix, rather than billed time.
 *
 * Returns the error instead of a negative duration, so no caller can save a
 * reversed entry by accident.
 */
export function resolveEntryTimes(
  date: string,
  startTime: string,
  endTime: string,
): ResolvedEntryTimesResult {
  if (!date || !startTime) return { ok: false, error: "startMissing" };
  if (!endTime) return { ok: false, error: "endMissing" };

  const startISO = `${date}T${startTime}:00`;
  const crossesMidnight = endTime < startTime;
  const endISO = crossesMidnight
    ? `${nextDay(date)}T${endTime}:00`
    : `${date}T${endTime}:00`;

  const duration = Math.floor(
    (new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000,
  );
  if (duration <= 0) return { ok: false, error: "endNotAfterStart" };

  return {
    ok: true,
    times: {
      start_time: startISO,
      end_time: endISO,
      duration,
      crossesMidnight,
    },
  };
}

/**
 * Single time entries, registered from the tracker form, the activity dialog
 * and the report coverage list.
 *
 * The create button is disabled while a save runs, but that is a rendering
 * state, not a promise: React re-renders after the handler returns, so a fast
 * second click can be delivered before `disabled` exists. A duplicate
 * `create_time_entry` is duplicated billed time and cannot be undone from the
 * UI, so the create itself carries the lock.
 *
 * The lock covers every create in this module. The screens are separate, so
 * they never share a screenshot — the lock makes a repeated click on one screen
 * harmless rather than serialising the app.
 */
let inFlight = false;

/** True while a single entry is being registered. Intended for tests and diagnostics. */
export function timeEntryCreateInFlight(): boolean {
  return inFlight;
}

/**
 * The customer a registration for this activity gets, so the time entry, the
 * classification it confirms and the pattern the backend learns from it cannot
 * disagree about who is being billed.
 *
 * The customer follows the project, in ONE direction: a chosen project owns the
 * customer, clearing it when it has none. "Eget arbejde" is a real project
 * shape, and inheriting the activity's customer there would bill a customer
 * that project does not belong to — including spending that customer's prepaid
 * klippekort, since the lookup falls back to the customer's own card. With no
 * project the activity's own customer is the only thing that says WHO the work
 * is for, so it is kept: "Acme, no project" is legitimate billable work, and
 * `fallbackClientId` is what the caller knows about it. A project missing from
 * the list (still loading) leaves the customer alone rather than clearing it on
 * a race — the same choice TimeEntryForm and TimerWidget make.
 */
export function resolveClientId(
  activity: Activity,
  projectId: string | null,
  projects: Project[],
  fallbackClientId?: string | null,
): string | null {
  const project = projects.find((p) => p.id === projectId);
  if (project) return project.client_id ?? null;
  if (projectId) return activity.client_id ?? null;
  return fallbackClientId ?? activity.client_id ?? null;
}

/** Build the entry an activity becomes, so every path bills it the same way. */
export function entryFromActivity(
  activity: Activity,
  projectId: string | null,
  projects: Project[],
  isBillable: boolean,
): TimeEntryInput {
  return {
    project_id: projectId,
    client_id: resolveClientId(activity, projectId, projects),
    klippekort_id: null,
    description: [activity.app_name, activity.window_title]
      .filter(Boolean)
      .join(" - "),
    start_time: activity.started_at,
    end_time: activity.ended_at,
    duration: activity.duration,
    is_billable: isBillable,
  };
}

/**
 * Register one time entry. Resolves true when the entry was created, false when
 * another create still held the lock — the caller already has one on its way.
 */
export async function createTimeEntry(input: TimeEntryInput): Promise<boolean> {
  if (inFlight) return false;
  inFlight = true;
  try {
    await tauriInvoke("create_time_entry", { input });
    return true;
  } finally {
    inFlight = false;
  }
}

/**
 * Confirm one activity's classification and register it as a time entry, as a
 * unit. The two calls belong together: a repeated click that only reached the
 * first would leave the activity confirmed but never billed.
 * Resolves true when the entry was created, false when the lock was held.
 */
export async function confirmActivityAsTimeEntry(args: {
  activity: Activity;
  projectId: string | null;
  /**
   * The customer to confirm to when there is no project. Optional because the
   * dialog passes the project's own customer — but a customer without a
   * project is exactly the case where it is the ONLY thing that says who the
   * work is for, so it must reach the backend that learns the pattern too.
   * A chosen project overrides it: see `resolveClientId`.
   */
  clientId?: string | null;
  category: string | null;
  projects: Project[];
}): Promise<boolean> {
  const { activity, projectId, clientId, category, projects } = args;
  if (inFlight) return false;
  inFlight = true;
  try {
    await tauriInvoke("confirm_classification", {
      activityId: activity.id,
      projectId,
      // Resolved by the same rule as the entry below, so the pattern the
      // backend learns cannot name a different customer than the entry bills.
      clientId: resolveClientId(activity, projectId, projects, clientId),
      category,
    });
    await tauriInvoke("create_time_entry", {
      input: entryFromActivity(
        activity,
        projectId,
        projects,
        category !== "personal",
      ),
    });
    return true;
  } finally {
    inFlight = false;
  }
}
