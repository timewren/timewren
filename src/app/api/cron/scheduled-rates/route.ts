import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { copenhagenToday } from "@/lib/rates/scheduled";
import {
  applyDueRateChanges,
  createDrizzleApplyStore,
} from "@/lib/rates/scheduled-service";

// Cron schedule: 5 0 * * * (dagligt 00:05 dansk tid)
// Planlagte satsændringer: forfaldne ændringer (effectiveDate ≤ i dag i dansk
// tid) skrives ind på klienten/projektet, den gamle sats gemmes på ændringen,
// og der logges en rate_history-række med ændringens dato. Idempotent:
// applied_at sættes atomisk, så en ændring kun anvendes én gang.

export const GET = withCronLogging("scheduled-rates", async () => {
  const result = await applyDueRateChanges(
    createDrizzleApplyStore(db),
    copenhagenToday(),
  );
  for (const error of result.errors) {
    console.error(
      `[Cron] scheduled-rates: kunne ikke anvende ${error.id}: ${error.message}`,
    );
  }
  return {
    itemsProcessed: result.due,
    itemsSucceeded: result.applied,
    itemsFailed: result.failed,
    metadata: { skipped: result.skipped, errors: result.errors },
  };
});
