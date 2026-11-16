import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { runStabilityWatch } from "@/lib/stability/run";

/**
 * Stabilitetsvagten: kører detektorerne for timer- og datafejl over
 * vinduet siden forrige kørsel, gemmer fund i stability_findings og
 * alarmerer (Discord + Sentry) ved tilstandsskift. Se
 * docs/runbooks/timer-fejlsoegning.md og /admin/stabilitet.
 *
 * Schedule: hvert 15. minut (cron/entrypoint.sh)
 */
export const GET = withCronLogging("stability-watch", async (request) => {
  const forcePrepaid = new URL(request.url).searchParams.has("prepaid");
  const summary = await runStabilityWatch(db, { forcePrepaid });
  return {
    itemsProcessed: summary.detected,
    itemsSucceeded: summary.ran.length,
    itemsFailed: summary.failed.length,
    metadata: { ...summary },
  };
});
