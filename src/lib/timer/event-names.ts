/**
 * Navne og konstanter for timerens hændelseslog (A6). Ingen server-imports,
 * så admin-UI'et kan bruge dem uden at trække schemaet med i bundlen.
 */

export const TIMER_EVENT_NAMES = [
  "start",
  "resume",
  "pause",
  "clear",
  "adopt",
  "client_change",
  "time_change",
  "claim_stop",
  "confirm_stop",
  "cancel_stop",
  "quick_stop",
  "merge_same_session",
  "idle_stamp",
  "idle_claim",
  "cron_park",
  "start_deduplicated",
  // Afvisninger
  "heartbeat_rejected",
  "pause_rejected",
  "adopt_rejected",
  "claim_rejected",
  "confirm_rejected",
  "cancel_rejected",
  "version_conflict",
  "blocked_stopping",
  "blocked_resurrection",
  "blocked_other_owner",
  // Skrivning afvist: klientens version er under MIN_CLIENT_VERSIONS
  "client_too_old",
] as const;

export type TimerEventName = (typeof TIMER_EVENT_NAMES)[number];

export type TimerEventSource =
  | "web"
  | "extension"
  | "mobile"
  | "desktop"
  | "cron"
  | "api";

/** Hændelser der er afvisninger — markeres i admin-visningen. */
export const TIMER_REJECTION_EVENTS: ReadonlySet<TimerEventName> = new Set([
  "heartbeat_rejected",
  "pause_rejected",
  "adopt_rejected",
  "claim_rejected",
  "confirm_rejected",
  "cancel_rejected",
  "version_conflict",
  "blocked_stopping",
  "blocked_resurrection",
  "blocked_other_owner",
  "client_too_old",
]);

export const TIMER_EVENT_RETENTION_DAYS = 30;
