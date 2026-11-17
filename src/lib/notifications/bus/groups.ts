/**
 * Notifikationsbussens kanaler og grupper. Uden andre importer, så
 * indstillingssiderne i browseren kan bruge dem uden at trække
 * hændelseskatalogets mailtekster (alle sprog) med i bundtet.
 */
export const NOTIFICATION_CHANNELS = [
  "in_app",
  "email",
  "push",
  "teams",
] as const;
export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_GROUPS = [
  "timesheet",
  "absence",
  "reminder",
  "compliance",
  "digest",
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];
