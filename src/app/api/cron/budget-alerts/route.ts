import { and, isNotNull, lt, sql } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { projectBudgetAlerts, projects } from "@/lib/db/schema";
import { sendProjectBudgetAlert } from "@/lib/email/project-budget";
import {
  budgetAlertCrossing,
  monthKeyCopenhagen,
  monthlyBudgetStatus,
} from "@/lib/projects/budget";
import {
  loadMonthlyUsage,
  monthlyUsageScope,
} from "@/lib/projects/monthly-usage";
import { captureRouteError } from "@/lib/utils/sentry";
import { emitWebhookEvent } from "@/lib/webhooks/events";

// Cron schedule: 45 8 * * * (dagligt kl. 08:45)
//
// Månedsbudget-advarsler (#592): projekter der siden sidste kørsel har
// krydset 80 % eller 100 % af månedsbudgettet. Krydsningen afgøres mod det
// niveau der sidst blev advaret om i samme måned (project_budget_alerts), så
// en daglig kørsel ikke giver en daglig mail.

export const GET = withCronLogging("budget-alerts", async (_request) => {
  const now = new Date();
  const month = monthKeyCopenhagen(now);

  const budgetProjects = await db.query.projects.findMany({
    where: and(
      isNotNull(projects.monthlyBudgetHours),
      // Arkiverede projekter skal ikke sende mails
      sql`${projects.status} IS DISTINCT FROM 'archived'`,
    ),
    columns: {
      id: true,
      name: true,
      userId: true,
      organizationId: true,
      clientId: true,
      monthlyBudgetHours: true,
    },
    with: {
      client: { columns: { name: true } },
      user: { columns: { id: true, name: true, email: true } },
    },
  });

  const withBudget = budgetProjects.filter(
    (p) => Number.parseFloat(p.monthlyBudgetHours ?? "0") > 0,
  );
  if (withBudget.length === 0) {
    return { itemsProcessed: 0, itemsSucceeded: 0, itemsFailed: 0 };
  }

  // Forbruget skal beregnes med præcis samme prædikat som projektlisten, så
  // mailen og skærmen aldrig viser forskellige tal. Prædikatet afhænger af
  // ejerskabet (org vs. solo), så projekterne grupperes efter scope.
  const byScope = new Map<string, typeof withBudget>();
  for (const p of withBudget) {
    const key = p.organizationId
      ? `org:${p.organizationId}`
      : `user:${p.userId}`;
    const list = byScope.get(key) ?? [];
    list.push(p);
    byScope.set(key, list);
  }

  const usedByProject = new Map<string, number>();
  for (const group of byScope.values()) {
    const first = group[0];
    const usage = await loadMonthlyUsage(db, {
      projectIds: group.map((p) => p.id),
      scope: monthlyUsageScope(first.organizationId ?? null, first.userId),
      now,
    });
    for (const [projectId, hours] of usage) {
      usedByProject.set(projectId, hours);
    }
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const project of withBudget) {
    const budgetHours = Number.parseFloat(project.monthlyBudgetHours ?? "0");
    const usedHours = usedByProject.get(project.id) ?? 0;
    const rawPercentage = budgetHours > 0 ? (usedHours / budgetHours) * 100 : 0;
    const status = monthlyBudgetStatus(budgetHours, usedHours);
    // Læses uden for transaktionen, men insert'en nedenfor er selve guarden —
    // den her udvælgelse sparer bare en skrivning for de fleste projekter.
    const level = budgetAlertCrossing(rawPercentage, 0);
    if (level === null || level === 0) continue;

    processed++;
    try {
      // Atomisk guard: rækken skrives KUN hvis niveauet er højere end det
      // gemte. To samtidige kørsler kan derfor ikke begge få en række
      // tilbage, og den der taber sender ingen mail.
      const [claimed] = await db
        .insert(projectBudgetAlerts)
        .values({
          projectId: project.id,
          month,
          notifiedLevel: level,
          notifiedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [projectBudgetAlerts.projectId, projectBudgetAlerts.month],
          set: { notifiedLevel: level, notifiedAt: new Date() },
          where: lt(projectBudgetAlerts.notifiedLevel, level),
        })
        .returning({ id: projectBudgetAlerts.id });
      if (!claimed) continue;

      emitWebhookEvent({
        userId: project.userId,
        orgId: project.organizationId,
        eventType: "project.budget_threshold",
        eventId: `${project.id}:${month}:${level}`,
        data: {
          projectId: project.id,
          projectName: project.name,
          month,
          level,
          budgetHours,
          usedHours: Math.round(usedHours * 10) / 10,
          percentage: status.percentage,
        },
        clientId: project.clientId,
        // Uden den droppes projekt-scopede webhooks i delivery-filteret
        projectId: project.id,
      });

      const owner = project.user;
      if (!owner?.email) continue;

      await sendProjectBudgetAlert({
        to: owner.email,
        recipientName: owner.name ?? "der",
        projectId: project.id,
        projectName: project.name,
        clientName: project.client?.name ?? null,
        month,
        usedHours,
        budgetHours,
        percentage: status.percentage,
        level,
        userId: owner.id,
      });
      sent++;
    } catch (error) {
      failed++;
      const message = (error as Error).message;
      console.error(`[Budget Alerts] Failed for project ${project.id}:`, error);
      errors.push(`Project ${project.id}: ${message}`);
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/budget-alerts",
      type: "cron",
    });
  }

  return {
    itemsProcessed: processed,
    itemsSucceeded: sent,
    itemsFailed: failed,
    metadata: {
      month,
      projectsWithBudget: withBudget.length,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
});
