/**
 * Resend Topics service
 * Maps local emailPreferences to Resend Topics for managed unsubscribe.
 *
 * Note: Resend Topics API may not be available in all plans.
 * These functions gracefully handle API errors.
 */

/**
 * Topic definitions mapping to emailPreferences fields
 */
export const TOPIC_DEFINITIONS = [
  {
    name: "Ugentlig rapport",
    preferenceField: "weeklyReport" as const,
  },
  {
    name: "Månedlig rapport",
    preferenceField: "monthlyReport" as const,
  },
  {
    name: "Fakturapåmindelser",
    preferenceField: "unbilledReminder" as const,
  },
  {
    name: "Tips & tricks",
    preferenceField: "tipsAndTricks" as const,
  },
  {
    name: "Produktopdateringer",
    preferenceField: "productUpdates" as const,
  },
] as const;

export type TopicPreferenceField =
  (typeof TOPIC_DEFINITIONS)[number]["preferenceField"];

/**
 * Map local email preferences (booleans) to topic names for display/sync.
 */
export function mapPreferencesToTopicNames(prefs: {
  weeklyReport?: boolean | null;
  monthlyReport?: boolean | null;
  unbilledReminder?: boolean | null;
  tipsAndTricks?: boolean | null;
  productUpdates?: boolean | null;
}): { name: string; subscribed: boolean }[] {
  return TOPIC_DEFINITIONS.map((topic) => ({
    name: topic.name,
    subscribed: prefs[topic.preferenceField] ?? true,
  }));
}

/**
 * Map a topic name back to the local preference field name.
 */
export function topicNameToPreferenceField(
  topicName: string,
): TopicPreferenceField | null {
  const topic = TOPIC_DEFINITIONS.find((t) => t.name === topicName);
  return topic?.preferenceField || null;
}
