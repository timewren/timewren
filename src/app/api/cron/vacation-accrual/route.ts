import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { runMonthlyVacationAccrual } from "@/lib/enterprise/vacation-accrual";

// Cron schedule: 15 4 1 * * (d. 1. i måneden, ~06:15 dansk tid)
// Løbende ferieoptjening (#461): 2,08 dage × FTE for forrige måned pr. aktiv
// medarbejder i org'er med vacation_accrual_mode = 'monthly'. Idempotent —
// kan køres igen uden dobbelt-postering (unikt indeks på cron/YYYY-MM).

export const GET = withCronLogging("vacation-accrual", async () => {
  const result = await runMonthlyVacationAccrual(db);
  return {
    itemsProcessed: result.employees,
    itemsSucceeded: result.posted,
    itemsFailed: result.failed,
    metadata: { orgs: result.orgs },
  };
});
