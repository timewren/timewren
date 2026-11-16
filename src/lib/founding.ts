import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { db as DbHandle } from "@/lib/db";
import { members, organizations } from "@/lib/db/schema";

type Db = typeof DbHandle;

/**
 * Founding-mærket er kun en markering (visning + support-prioritet). Ingen
 * funktion må læse det som betingelse.
 */
export async function isOrgFounding(
  db: Db,
  orgId: string | null | undefined,
): Promise<boolean> {
  if (!orgId) return false;
  const row = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.id, orgId),
    columns: { foundingSince: true },
  });
  return row?.foundingSince != null;
}

/**
 * Hvilke supportsager hører til en Founding-organisation. En sag matcher via
 * sit organizationId, eller (fald-tilbage) via afsenderens medlemskaber.
 * Returnerer sags-id'er.
 */
export async function foundingTicketIds(
  db: Db,
  tickets: Array<{
    id: string;
    organizationId: string | null;
    userId: string | null;
  }>,
): Promise<Set<string>> {
  const orgIds = [
    ...new Set(tickets.map((t) => t.organizationId).filter((x) => !!x)),
  ] as string[];
  const userIds = [
    ...new Set(tickets.map((t) => t.userId).filter((x) => !!x)),
  ] as string[];

  const foundingOrgs = new Set<string>();
  if (orgIds.length > 0) {
    const rows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          inArray(organizations.id, orgIds),
          isNotNull(organizations.foundingSince),
        ),
      );
    for (const r of rows) foundingOrgs.add(r.id);
  }
  const foundingUsers = new Set<string>();
  if (userIds.length > 0) {
    const rows = await db
      .select({ userId: members.userId })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(
        and(
          inArray(members.userId, userIds),
          isNotNull(organizations.foundingSince),
        ),
      );
    for (const r of rows) foundingUsers.add(r.userId);
  }
  return new Set(
    tickets
      .filter(
        (t) =>
          (t.organizationId && foundingOrgs.has(t.organizationId)) ||
          (!t.organizationId && t.userId && foundingUsers.has(t.userId)),
      )
      .map((t) => t.id),
  );
}
