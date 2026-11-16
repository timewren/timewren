import { and, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  calendarMatchingRules,
  clients,
  members,
  timeEntries,
} from "@/lib/db/schema";

interface MatchResult {
  clientId: string;
  clientName: string;
  projectId?: string;
  projectName?: string;
  score: number;
  source: "rule" | "learned" | "attendee" | "fuzzy" | "history";
}

export async function matchEventToClient(
  userId: string,
  eventTitle: string,
  eventDescription: string | undefined,
  attendeeEmails: string[],
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  // 1. Explicit + learned rules
  const rules = await db.query.calendarMatchingRules.findMany({
    where: eq(calendarMatchingRules.userId, userId),
    with: { client: true, project: true },
  });

  const titleLower = eventTitle.toLowerCase();
  const descLower = (eventDescription ?? "").toLowerCase();

  for (const rule of rules) {
    if (!rule.client) continue;
    const patternLower = rule.pattern.toLowerCase();
    if (titleLower.includes(patternLower)) {
      results.push({
        clientId: rule.client.id,
        clientName: rule.client.name,
        projectId: rule.project?.id,
        projectName: rule.project?.name,
        score: rule.source === "manual" ? 200 : 150,
        source: rule.source === "manual" ? "rule" : "learned",
      });
    }
  }

  // 2. Attendee email domain matching
  if (attendeeEmails.length > 0) {
    const allClientsWithEmail = await db.query.clients.findMany({
      where: eq(clients.userId, userId),
      columns: { id: true, name: true, email: true },
    });

    for (const email of attendeeEmails) {
      const domain = email.split("@")[1]?.toLowerCase();
      if (!domain) continue;
      for (const client of allClientsWithEmail) {
        if (client.email?.toLowerCase().endsWith(`@${domain}`)) {
          if (!results.some((r) => r.clientId === client.id)) {
            results.push({
              clientId: client.id,
              clientName: client.name,
              score: 120,
              source: "attendee",
            });
          }
        }
      }
    }
  }

  // 3. Client name in event title/description (fuzzy)
  const allClients = await db.query.clients.findMany({
    where: eq(clients.userId, userId),
    columns: { id: true, name: true },
  });

  for (const client of allClients) {
    if (results.some((r) => r.clientId === client.id)) continue;
    const nameLower = client.name.toLowerCase();
    if (nameLower.length < 2) continue; // Skip very short names to avoid false matches
    if (titleLower.includes(nameLower)) {
      results.push({
        clientId: client.id,
        clientName: client.name,
        score: 80,
        source: "fuzzy",
      });
    } else if (descLower.includes(nameLower)) {
      results.push({
        clientId: client.id,
        clientName: client.name,
        score: 40,
        source: "fuzzy",
      });
    }
  }

  // 4. Historical: similar event title -> same client
  if (eventTitle.length >= 5) {
    const historicalEntries = await db.query.timeEntries.findMany({
      where: and(
        eq(timeEntries.userId, userId),
        ilike(timeEntries.description, `%${eventTitle.substring(0, 30)}%`),
      ),
      with: { client: true },
      orderBy: [desc(timeEntries.createdAt)],
      limit: 5,
    });

    for (const entry of historicalEntries) {
      if (!entry.client || results.some((r) => r.clientId === entry.client?.id))
        continue;
      results.push({
        clientId: entry.client.id,
        clientName: entry.client.name,
        projectId: entry.projectId ?? undefined,
        score: 60,
        source: "history",
      });
    }
  }

  // Deduplicate by clientId (keep highest score), sort desc
  const seen = new Set<string>();
  return results
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      if (seen.has(r.clientId)) return false;
      seen.add(r.clientId);
      return true;
    })
    .slice(0, 5);
}

export async function learnMatchingRule(
  userId: string,
  eventTitle: string,
  clientId: string,
  projectId?: string,
) {
  const existing = await db.query.calendarMatchingRules.findFirst({
    where: and(
      eq(calendarMatchingRules.userId, userId),
      eq(calendarMatchingRules.pattern, eventTitle),
    ),
  });

  if (existing) {
    await db
      .update(calendarMatchingRules)
      .set({
        clientId,
        projectId: projectId ?? null,
        matchCount: existing.matchCount + 1,
        lastMatchedAt: new Date(),
      })
      .where(eq(calendarMatchingRules.id, existing.id));
  } else {
    // Resolve org inline
    const membership = await db.query.members.findFirst({
      where: eq(members.userId, userId),
      columns: { organizationId: true },
    });
    const orgId = membership?.organizationId ?? null;

    await db.insert(calendarMatchingRules).values({
      userId,
      organizationId: orgId,
      pattern: eventTitle,
      clientId,
      projectId: projectId ?? null,
      source: "learned",
    });
  }
}
