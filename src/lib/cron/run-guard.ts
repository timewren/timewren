import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cronJobLogs } from "@/lib/db/schema";

/**
 * Et job, der har stået som "running" længere end dette, regnes for dødt
 * (processen er genstartet midt i kørslen) og blokerer ikke næste kørsel.
 * Lige over curl's --max-time 300 i cron/entrypoint.sh, så en død kørsel højst
 * koster ét tick ved 5-minutters-jobs.
 */
export const CRON_RUN_STALE_AFTER_MS = 330 * 1000;

/**
 * Starter en kørsel af `jobName`: returnerer id på den nye cron_job_logs-række,
 * eller `null` når en tidligere kørsel af samme job stadig er i gang.
 *
 * Tjek og indsættelse sker i én transaktion bag en advisory lock, så to
 * samtidige kald ikke begge slipper igennem. Transaktionen indeholder kun de
 * to SQL-kald; selve jobbet kører udenfor.
 */
export async function startCronRun(
  jobName: string,
  startedAt: Date,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`cron:${jobName}`}))`,
    );
    const [running] = await tx
      .select({ id: cronJobLogs.id })
      .from(cronJobLogs)
      .where(
        and(
          eq(cronJobLogs.jobName, jobName),
          eq(cronJobLogs.status, "running"),
          gt(
            cronJobLogs.startedAt,
            new Date(startedAt.getTime() - CRON_RUN_STALE_AFTER_MS),
          ),
        ),
      )
      .limit(1);
    if (running) return null;

    const [row] = await tx
      .insert(cronJobLogs)
      .values({ jobName, status: "running", startedAt })
      .returning({ id: cronJobLogs.id });
    return row.id;
  });
}
