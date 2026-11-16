import { sql } from "drizzle-orm";
import { timerStates } from "@/lib/db/schema";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";

/**
 * Stempl starten på en inaktivitetsperiode — men KUN hvis der ikke allerede
 * står et stempel (#588).
 *
 * Web og extension opdager inaktiviteten hver for sig og med sekunders
 * forskel. Den FØRSTE detektor skal vinde: flyttede en senere detektor
 * stemplet frem, ville det målte fravær krympe, og brugeren ville få tilbudt
 * at fjerne mindre tid end hun faktisk var væk. `COALESCE` afgør det i
 * databasen i stedet for i en race-fyldt læs-så-skriv.
 *
 * Tidsstemplet sættes med `now()`, ikke med en bunden JS-`Date`: postgres-js
 * kan ikke binde et Date-objekt i en rå `sql`-skabelon, og Postgres afviser
 * `COALESCE(timestamp, text)`. Det gav 500'ere på reportIdle i beta.
 *
 * Returnerer det gældende stempel — enten det eksisterende eller det nye.
 */
export async function stampIdle(
  db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  userId: string,
): Promise<Date | null> {
  const rows = (await db.execute(sql`
    UPDATE ${timerStates}
    SET is_idle = true,
        idle_detected_at = COALESCE(${timerStates.idleDetectedAt}, now()),
        last_activity_at = now(),
        updated_at = now()
    WHERE ${timerStates.userId} = ${userId}
    RETURNING idle_detected_at
  `)) as unknown as Array<{ idle_detected_at: Date | string | null }>;

  const value = rows?.[0]?.idle_detected_at;
  return parseDbTimestamp(value);
}

/**
 * "Klip" brugerens idle-stempel ud: nulstil `is_idle`/`idle_detected_at` og
 * få det FORRIGE tidspunkt med tilbage i samme sætning (#588).
 *
 * Web og extension kapløber om det her, når brugeren kommer tilbage. Præcis
 * én af dem skal have tidspunktet og spørge brugeren; den anden skal have
 * null og tie — ellers bliver det samme fravær spurgt om to gange, og to
 * "Fjern"-klik trækker tiden fra dobbelt.
 *
 * To ting gør klippet atomisk, og BEGGE er nødvendige:
 *
 * 1. `FOR UPDATE` i CTE'en. Uden den læser `prev` ved statement-snapshottet
 *    under READ COMMITTED, og taberen af kapløbet ser stadig det gamle,
 *    non-null stempel.
 * 2. `AND t.idle_detected_at IS NOT NULL` i UPDATE'ens WHERE. Taberen blokerer
 *    på rækkelåsen og kører derefter EvalPlanQual — som kun gen-tjekker
 *    UPDATE'ens egen WHERE, ikke CTE'ens. Uden prædikatet ville UPDATE'en køre
 *    alligevel, og `RETURNING prev.idle_detected_at` ville levere det gamle
 *    stempel til begge klienter. Med prædikatet matcher taberen 0 rækker.
 *
 * Tidsstempler sættes med `now()` i stedet for en bunden JS-`Date`: postgres-js
 * afviser et Date-objekt i en rå `sql`-skabelon ("The \"string\" argument must
 * be of type string"), og `now()` er i forvejen det schemaets egne
 * `defaultNow()`-kolonner bruger.
 */
export async function claimIdleStamp(
  db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  userId: string,
): Promise<Date | null> {
  const claimed = await db.execute(sql`
    WITH prev AS (
      SELECT ${timerStates.id}, ${timerStates.idleDetectedAt}
      FROM ${timerStates}
      WHERE ${timerStates.userId} = ${userId}
      FOR UPDATE
    )
    UPDATE ${timerStates} AS t
    SET is_idle = false,
        idle_detected_at = NULL,
        last_activity_at = now(),
        updated_at = now()
    FROM prev
    WHERE t.id = prev.id
      AND t.idle_detected_at IS NOT NULL
    RETURNING prev.idle_detected_at AS claimed_idle_detected_at
  `);

  // Husholdning: `is_idle` og `last_activity_at` skal opdateres uanset om
  // DENNE klient vandt klippet — `idle-warning`-cron'en bruger
  // last_activity_at til at afgøre om der skal advares, og klippet ovenfor
  // rører kun rækken når der FAKTISK var et stempel. Idempotent, ingen
  // versionsbump, intet ejerskabsskifte.
  await db.execute(sql`
    UPDATE ${timerStates}
    SET is_idle = false,
        last_activity_at = now(),
        updated_at = now()
    WHERE ${timerStates.userId} = ${userId}
  `);

  const rows = claimed as unknown as Array<{
    claimed_idle_detected_at: Date | string | null;
  }>;
  const value = rows?.[0]?.claimed_idle_detected_at;
  return parseDbTimestamp(value);
}
