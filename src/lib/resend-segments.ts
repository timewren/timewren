/**
 * Resend Segments service
 * Manages user segments for targeted broadcasts.
 *
 * Segments are defined locally and synced to Resend when the API supports it.
 * Until then, segment logic is used for filtering broadcasts locally.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { prepaidPackages, timeEntries, users } from "@/lib/db/schema";

/** Segment definitions with local query criteria */
export const SEGMENT_DEFINITIONS = [
  {
    id: "active_freelancers",
    name: "Aktive freelancere",
    description: "Har logget tid inden for 30 dage",
  },
  {
    id: "klippekort_users",
    name: "Klippekort-brugere",
    description: "Har aktive prepaid packages",
  },
  {
    id: "inactive_users",
    name: "Inaktive brugere",
    description: "Ingen aktivitet i 30+ dage",
  },
  {
    id: "new_users",
    name: "Nye brugere",
    description: "Oprettet inden for 14 dage",
  },
] as const;

export type SegmentId = (typeof SEGMENT_DEFINITIONS)[number]["id"];

/**
 * Get user IDs for a specific segment.
 */
export async function getUsersInSegment(
  segmentId: SegmentId,
): Promise<string[]> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  switch (segmentId) {
    case "active_freelancers": {
      // Users who logged time in the last 30 days
      const result = await db
        .selectDistinct({ userId: timeEntries.userId })
        .from(timeEntries)
        .where(gte(timeEntries.createdAt, thirtyDaysAgo));
      return result.map((r) => r.userId);
    }

    case "klippekort_users": {
      // Users with active prepaid packages
      const result = await db
        .selectDistinct({ userId: prepaidPackages.userId })
        .from(prepaidPackages)
        .where(eq(prepaidPackages.isActive, true));
      return result.map((r) => r.userId);
    }

    case "inactive_users": {
      // Users with no time entries in 30+ days
      const activeUsers = db
        .selectDistinct({ userId: timeEntries.userId })
        .from(timeEntries)
        .where(gte(timeEntries.createdAt, thirtyDaysAgo));

      const result = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            sql`${users.id} NOT IN (${activeUsers})`,
            // Only include users who have actually used the system
            sql`EXISTS (SELECT 1 FROM time_entries WHERE user_id = ${users.id})`,
          ),
        );
      return result.map((r) => r.id);
    }

    case "new_users": {
      // Users created in the last 14 days
      const result = await db
        .select({ id: users.id })
        .from(users)
        .where(gte(users.createdAt, fourteenDaysAgo));
      return result.map((r) => r.id);
    }

    default:
      return [];
  }
}

/**
 * Get segment counts for admin overview.
 */
export async function getSegmentCounts(): Promise<
  { id: SegmentId; name: string; description: string; count: number }[]
> {
  const results = await Promise.all(
    SEGMENT_DEFINITIONS.map(async (seg) => {
      const userIds = await getUsersInSegment(seg.id);
      return {
        id: seg.id,
        name: seg.name,
        description: seg.description,
        count: userIds.length,
      };
    }),
  );
  return results;
}
