// Afgrænsning af tidsposter til én kunde, med samme regel som kundesiden
// brugte i browseren: posten er sat direkte på kunden, eller den ligger på et
// af kundens projekter (projektposter har ofte ingen client_id). Filteret
// skal ligge i SQL — at hente organisationens seneste 1000 poster og filtrere
// bagefter gav forkerte tal, så snart der var flere poster end det (#1115).

import { and, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { clients, projects, timeEntries } from "@/lib/db/schema";

// `= any(array(...))`, ikke `in (select ...)`: IN-subqueryen bliver en hashed
// SubPlan, som Postgres kun kan bruge som filter, så kundesiden gennemgik
// alle organisationens poster for at finde kundens (20.000 læst for 400 i
// docs/research/2026-11-22-stabilitet.md). Array-formen er en InitPlan, og så
// kan begge grene bruge deres indeks (client_id og project_id) i en BitmapOr.
// Samme resultat: NULL-project_id og en kunde uden projekter giver i begge
// former "ikke med" fra projekt-grenen.
//
// Subqueryen skrives med et eget alias og ikke med ${projects.id}: i
// db.query.timeEntries.findMany (time.list) omdøber Drizzle alle kolonner i
// en sql-skabelon til tabellens alias, så den blev til
// `select "timeEntries"."id" from projects where "timeEntries"."client_id" = …`
// og kundesidens liste mistede alle poster, der kun lå på kundens projekter.
const projectClientId = sql`"scope_p"."client_id"`;

function projectMatchesClientFilter(filter: SQL): SQL {
  return sql`${timeEntries.projectId} = any(array(select "scope_p"."id" from "projects" "scope_p" where ${filter}))`;
}

export function entryBelongsToClient(clientId: string): SQL {
  return or(
    eq(timeEntries.clientId, clientId),
    projectMatchesClientFilter(eq(projectClientId, clientId)),
  ) as SQL;
}

/** A direct client assignment takes precedence over the project's client. */
export function entryMatchesEffectiveClients(clientIds: string[]): SQL {
  return or(
    inArray(timeEntries.clientId, clientIds),
    and(
      isNull(timeEntries.clientId),
      projectMatchesClientFilter(inArray(projectClientId, clientIds)),
    ),
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
