import { and, eq, gte } from "drizzle-orm";
import { CHURN_PLAYBOOKS } from "@/lib/admin/churn-playbooks";
import { calculateChurnRisk } from "@/lib/admin/churn-risk";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { churnPlaybookRuns } from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notifications/admin";

// Churn-playbooks (#152): dagligt cron der evaluerer risiko-scoren mod
// playbook-reglerne og udløser Discord-aktioner m. cooldown pr. bruger
// pr. playbook. Kill-switch: CHURN_PLAYBOOKS_DISABLED=1.
// Schedule: dagligt 08:30 (cron-sidecar).

export const GET = withCronLogging("churn-playbooks", async () => {
  if (process.env.CHURN_PLAYBOOKS_DISABLED === "1") {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      itemsFailed: 0,
      metadata: { disabled: true },
    };
  }

  // Risiko-scoren og playbooks bygger på prøveperiode og abonnement. Uden
  // betalingsudbyder (selvhost) findes de ikke.
  if (!isBillingEnabled()) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      itemsFailed: 0,
      metadata: { skipped: "billing-disabled" },
    };
  }

  const now = new Date();
  const atRisk = await calculateChurnRisk(db, {
    limit: 200,
    minLevel: "medium",
  });

  let triggered = 0;
  let failed = 0;
  let skippedCooldown = 0;

  for (const user of atRisk) {
    for (const playbook of CHURN_PLAYBOOKS) {
      try {
        if (!playbook.matches(user)) continue;

        // Cooldown: én aktion pr. bruger pr. playbook pr. vindue
        const windowStart = new Date(now);
        windowStart.setDate(windowStart.getDate() - playbook.cooldownDays);
        const recent = await db.query.churnPlaybookRuns.findFirst({
          where: and(
            eq(churnPlaybookRuns.userId, user.userId),
            eq(churnPlaybookRuns.playbookKey, playbook.key),
            gte(churnPlaybookRuns.triggeredAt, windowStart),
          ),
          columns: { id: true },
        });
        if (recent) {
          skippedCooldown++;
          continue;
        }

        // Log FØRST (cooldown-vinduet skal holde selv hvis Discord
        // fejler — hellere én mistet ping end daglig spam)
        await db.insert(churnPlaybookRuns).values({
          userId: user.userId,
          playbookKey: playbook.key,
          riskScore: user.riskScore,
          reasons: user.reasons,
        });

        await notifyAdmin("churn_risk", {
          userName: user.name,
          userEmail: user.email,
          userId: user.userId,
          reason: `[${playbook.label}] ${playbook.message(user)}`,
        });
        triggered++;
      } catch (err) {
        failed++;
        console.error(
          `[Churn Playbooks] ${playbook.key}/${user.userId} fejlede:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return {
    itemsProcessed: triggered + failed,
    itemsSucceeded: triggered,
    itemsFailed: failed,
    metadata: { atRiskUsers: atRisk.length, skippedCooldown },
  };
});
