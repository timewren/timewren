// Shared "one active timer per user" rule used by the start guards in both the
// web (`timerSync.sync`) and extension (`extension.updateTimerState`) routers,
// so the policy lives in a single place instead of being re-implemented per
// procedure.

type TimerConflictInput =
  | {
      isRunning: boolean | null;
      lastSyncedFrom: string | null;
    }
  | null
  | undefined;

/**
 * A timer start/resume is blocked when a *different* client already has a
 * timer running (only one active timer per user across web + extension).
 * Same-source resumes/heartbeats are allowed, so a client may keep or resume
 * its own timer. Note: this helper is only the readable pre-check used for
 * rich error messages — the rule itself is enforced atomically via a
 * conditional upsert (`setWhere`) in both routers, so concurrent starts can't
 * both slip through.
 */
export function isCrossClientTimerConflict(
  timer: TimerConflictInput,
  source: string,
): boolean {
  return Boolean(
    timer?.isRunning && timer.lastSyncedFrom && timer.lastSyncedFrom !== source,
  );
}

/** Danish label for where the blocking timer runs, for user-facing messages. */
export function timerConflictLocation(lastSyncedFrom: string | null): string {
  return lastSyncedFrom === "web" ? "i web-appen" : "på en anden enhed";
}
