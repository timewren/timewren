// Afgrænsning af tidsposter til én kunde, med samme regel som kundesiden
// brugte i browseren: posten er sat direkte på kunden, eller den ligger på et
// af kundens projekter (projektposter har ofte ingen client_id). Filteret
// skal ligge i SQL — at hente organisationens seneste 1000 poster og filtrere
// bagefter gav forkerte tal, så snart der var flere poster end det (#1115).

import { and, eq, or, type SQL, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { clients, projects, timeEntries } from "@/lib/db/schema";

export function entryBelongsToClient(clientId: string): SQL {
  return or(
    eq(timeEntries.clientId, clientId),
    sql`${timeEntries.projectId} in (select ${projects.id} from ${projects} where ${projects.clientId} = ${clientId})`,
  ) as SQL;
}

/**
 * Kundesidens timer og omsætning summeret i SQL over alle kundens poster
 * inden for `scope` (org/bruger og adgangsfiltre). Takst som kundesiden
 * altid har brugt: postens takst, ellers projektets, ellers kundens
 * standardtakst. Klippekortposter tæller i timer, ikke i omsætning.
 */
export async function sumClientEntries(
  db: PostgresJsDatabase<typeof schema>,
  clientId: string,
  scope: SQL | undefined,
): Promise<{ hours: number; revenue: number }> {
  const rate = sql`coalesce(${timeEntries.billableRate}, ${projects.hourlyRate}, (select ${clients.defaultHourlyRate} from ${clients} where ${clients.id} = ${clientId}), 0)`;
  const [row] = await db
    .select({
      hours: sql<string>`coalesce(sum(${timeEntries.hours}), 0)`,
      revenue: sql<string>`coalesce(sum(case when coalesce(${timeEntries.isPrepaid}, false) then 0 else ${timeEntries.hours} * ${rate} end), 0)`,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(and(scope, entryBelongsToClient(clientId)));
  return {
    hours: Number(row?.hours ?? 0),
    revenue: Number(row?.revenue ?? 0),
  };
}
