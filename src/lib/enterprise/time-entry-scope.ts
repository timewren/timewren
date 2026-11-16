import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { timeEntries } from "@/lib/db/schema";

/**
 * Org-scoping af time_entries (#445).
 *
 * En bruger kan være medlem af flere organisationer; alle enterprise-flows
 * (timeseddel, team-overblik, flex) må kun se posterne fra den aktive org.
 * Legacy-poster uden organization_id (oprettet før multi-tenant) tilhører
 * stadig ejeren og tæller med, så freelance-brugere ikke mister data i
 * grid'et. Poster fra ANDRE orgs udelukkes altid.
 */
export function inOrgOrLegacy(orgId: string): SQL {
  return or(
    eq(timeEntries.organizationId, orgId),
    isNull(timeEntries.organizationId),
  ) as SQL;
}

/**
 * Hele org'ens poster plus den kaldende brugers EGNE legacy-poster uden org.
 * Til org-brede visninger uden anden afgrænsning (fx rapporter): alene
 * matcher `inOrgOrLegacy` alle brugeres org-løse poster i hele databasen.
 */
export function inOrgOrOwnLegacy(orgId: string, userId: string): SQL {
  return or(
    eq(timeEntries.organizationId, orgId),
    and(isNull(timeEntries.organizationId), eq(timeEntries.userId, userId)),
  ) as SQL;
}

/** Ejerens egne poster i den aktive org (inkl. legacy-poster uden org). */
export function ownTimeEntriesInOrg(userId: string, orgId: string): SQL {
  return and(eq(timeEntries.userId, userId), inOrgOrLegacy(orgId)) as SQL;
}

/** Samme prædikat for flere brugere (team-overblik). */
export function usersTimeEntriesInOrg(userIds: string[], orgId: string): SQL {
  return and(inArray(timeEntries.userId, userIds), inOrgOrLegacy(orgId)) as SQL;
}

/** Ren JS-tvilling af prædikatet — til aggregering i hukommelsen og tests. */
export function isOwnTimeEntryInOrg(
  entry: { userId: string; organizationId: string | null },
  userId: string,
  orgId: string,
): boolean {
  return (
    entry.userId === userId &&
    (entry.organizationId === null || entry.organizationId === orgId)
  );
}
