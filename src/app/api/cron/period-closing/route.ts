import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { runPeriodClosingCron } from "@/lib/enterprise/period-closing-service";

// Cron schedule: 45 4 * * * (dagligt, ~06:45 dansk tid)
// Periodeafslutning (#518): for hver enterprise-org med periodeafslutning
// dannes opgørelsen (registreret, norm, flex, fravær) for den senest
// afsluttede måned/kvartal, og lederne får besked. Idempotent — kører den
// igen, dannes kun de manglende opgørelser.

export const GET = withCronLogging("period-closing", async () => {
  const result = await runPeriodClosingCron(db);
  return {
    itemsProcessed: result.orgs,
    itemsSucceeded: result.created,
    itemsFailed: result.failed,
  };
});
