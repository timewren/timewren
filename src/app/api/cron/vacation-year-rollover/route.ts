import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { deactivateEndedEmployments } from "@/lib/enterprise/employment";
import { runVacationYearRollover } from "@/lib/enterprise/vacation-accrual";

// Cron schedule: 30 4 * * * (dagligt, ~06:30 dansk tid)
// Årsskifte for ferie (#461): saldo-perioder der er udløbet uden rollover i
// org'er med løbende optjening får resten overført (≤ loft), udbetalt eller
// fortabt. Idempotent via rolled_over_at + rollover-referencer i ledgeren.

export const GET = withCronLogging("vacation-year-rollover", async () => {
  const result = await runVacationYearRollover(db);
  // Fratrædelser med fremtidig dato (#465): profilen deaktiveres først når
  // datoen er passeret, så medarbejderen kan registrere til og med sidste dag
  const deactivated = await deactivateEndedEmployments(db);
  return {
    itemsProcessed: result.candidates,
    itemsSucceeded: result.rolledOver,
    itemsFailed: result.failed,
    metadata: { skipped: result.skipped, deactivated },
  };
});
