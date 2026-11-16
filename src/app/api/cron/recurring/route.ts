import { and, eq, isNotNull, lte, or } from "drizzle-orm";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  generatedTimeEntries,
  members,
  recurringTimeTemplates,
  taskStatuses,
  tasks,
} from "@/lib/db/schema";
import { insertRecurringTimeEntry } from "@/lib/prepaid/entry-sync";
import { copenhagenToday, entryDateFromStr } from "@/lib/time/copenhagen";
import { resolveDefaultBillable } from "@/lib/time/default-billable";
import { calculateNextDue } from "@/lib/time/recurring-next-due";
import {
  checkAndSendLowBalanceAlert,
  type DeductResult,
} from "@/lib/trpc/routers/prepaid";
import { getRateForTimeEntry } from "@/lib/trpc/routers/time";
import { captureRouteError } from "@/lib/utils/sentry";

export const GET = withCronLogging("recurring", async (_request) => {
  const now = new Date();
  console.warn(
    `[Cron] Starting recurring template generation at ${now.toISOString()}`,
  );

  // Find all active recurring templates that are due for generation
  const pendingTemplates = await db.query.recurringTimeTemplates.findMany({
    where: and(
      eq(recurringTimeTemplates.isActive, true),
      isNotNull(recurringTimeTemplates.frequency),
      lte(recurringTimeTemplates.nextDue, now),
      or(
        eq(recurringTimeTemplates.isPaused, false),
        // Pause med slutdato genoptages automatisk, når datoen er nået (#1108)
        and(
          eq(recurringTimeTemplates.isPaused, true),
          isNotNull(recurringTimeTemplates.pausedUntil),
          lte(recurringTimeTemplates.pausedUntil, now),
        ),
      ),
    ),
    with: {
      project: {
        with: {
          client: true,
        },
      },
      templateClients: {
        with: {
          client: true,
          project: true,
        },
      },
    },
  });

  console.warn(`[Cron] Found ${pendingTemplates.length} pending templates`);

  let succeeded = 0;
  let failed = 0;
  const errors: { templateId: string; error: string }[] = [];

  // Pre-resolve orgIds to avoid repeated DB queries
  const uniqueUserIds = [
    ...new Set(
      pendingTemplates.filter((t) => !t.organizationId).map((t) => t.userId),
    ),
  ];
  const orgIdCache = new Map<string, string | null>();
  for (const uid of uniqueUserIds) {
    orgIdCache.set(uid, await getUserOrgId(uid));
  }

  // Process each template
  for (const template of pendingTemplates) {
    try {
      // Org-scoped cron: recurring templates are shared org data
      const orgId =
        template.organizationId ??
        orgIdCache.get(template.userId) ??
        (await getUserOrgId(template.userId));

      // Skip templates owned by users no longer in the org
      if (orgId) {
        const isMember = await db.query.members.findFirst({
          where: and(
            eq(members.organizationId, orgId),
            eq(members.userId, template.userId),
          ),
          columns: { id: true },
        });
        if (!isMember) {
          console.warn(
            `[Cron] Skipping template ${template.id} — user ${template.userId} no longer in org ${orgId}`,
          );
          // Deactivate orphaned template
          await db
            .update(recurringTimeTemplates)
            .set({ isActive: false })
            .where(eq(recurringTimeTemplates.id, template.id));
          continue;
        }
      }

      // Check if template has expired (endDate has passed)
      if (template.endDate && new Date(template.endDate) < now) {
        console.warn(
          `[Cron] Template ${template.id} has expired, deactivating`,
        );
        await db
          .update(recurringTimeTemplates)
          .set({ isActive: false })
          .where(eq(recurringTimeTemplates.id, template.id));
        continue;
      }

      // Resolve the list of (clientId, projectId) pairs from templateClients or fallback
      const clientList =
        template.templateClients && template.templateClients.length > 0
          ? template.templateClients.map((tc) => ({
              clientId: tc.clientId,
              projectId: tc.projectId ?? template.projectId,
            }))
          : [
              {
                clientId:
                  template.clientId ||
                  (template.project
                    ? Array.isArray(template.project)
                      ? template.project[0]?.clientId
                      : template.project?.clientId
                    : null) ||
                  null,
                projectId: template.projectId,
              },
            ];

      // Frequency is guaranteed non-null by the query filter
      if (!template.frequency) continue;
      const frequency = template.frequency;
      // Kun en pause med passeret slutdato når hertil (se filteret)
      const resumedFromPause = template.isPaused === true;
      // Lav-saldo-advarsler sendes først efter commit, aldrig inde i
      // transaktionen
      const alerts: { packageId: string; deduction: DeductResult }[] = [];

      // Alle skrivninger for skabelonen, inkl. nextDue, i én transaktion
      // (#1108): fejler kunde N, rulles kunde 1..N-1 tilbage, og skabelonen
      // prøves igen som helhed næste time i stedet for at give dubletter og
      // dobbelte klippekort-træk.
      const nextDue = await db.transaction(async (tx) => {
        // Iterate over each client assignment
        for (const { clientId, projectId } of clientList) {
          // Create time entry if templateType is 'time_entry' or 'both'
          if (template.templateType !== "task") {
            // Calculate current billable rate using rate hierarchy (project → client → user)
            // We must NOT use the stale template.billableRate — it was captured at template
            // creation time and may be null if the project had no rate then.
            // Sats og fakturerbar-default læses bevidst med `db`, ikke `tx`:
            // rene læsninger, der ikke skal rulles tilbage.
            const currentRate = await getRateForTimeEntry(
              db,
              template.userId,
              projectId,
              clientId,
              orgId,
              now,
            );

            // Posten indsættes som almindelig tid; kun et lykket træk gør den
            // prepaid. Et fejlet træk (tomt blok-kort, udløbet eller fornyet
            // kort) efterlader den fakturerbar i stedet for en "prepaid"-post
            // uden træk, som hverken blev trukket eller faktureret (A1 P2-4).
            const prepaidPackageId =
              template.isPrepaid && template.prepaidPackageId
                ? template.prepaidPackageId
                : null;
            const {
              entry: timeEntry,
              deduction,
              deductionError,
            } = await insertRecurringTimeEntry(tx, {
              values: {
                projectId,
                userId: template.userId,
                organizationId: orgId,
                clientId,
                recurringTemplateId: template.id,
                description: template.description,
                hours: template.hours,
                // Dansk dato (UTC-midnat-konventionen), ikke kørselstidspunktet:
                // kørslen kl. 00-02 dansk tid lå ellers på gårsdagen (#649).
                date: entryDateFromStr(copenhagenToday(now)),
                billableRate: currentRate,
                isBillable: await resolveDefaultBillable(db, {
                  projectId,
                  clientId,
                }),
                isBilled: false,
                isFromTemplate: true,
                source: "recurring",
              },
              prepaid: prepaidPackageId
                ? {
                    packageId: prepaidPackageId,
                    hours: parseFloat(template.hours),
                  }
                : null,
            });

            if (deduction && prepaidPackageId) {
              alerts.push({ packageId: prepaidPackageId, deduction });
            } else if (deductionError) {
              // Non-fatal: posten står som fakturerbar tid uden kort
              console.warn(
                `[Recurring] Failed to deduct prepaid hours for template ${template.id} — entry saved as billable:`,
                deductionError,
              );
            }

            // Create generated entry record
            await tx.insert(generatedTimeEntries).values({
              recurringTemplateId: template.id,
              timeEntryId: timeEntry.id,
              scheduledDate: now,
              isCompleted: true,
            });
          }

          // Create task if templateType is 'task' or 'both'
          if (
            template.templateType === "task" ||
            template.templateType === "both"
          ) {
            const todoLane = await tx.query.taskStatuses.findFirst({
              where: and(
                orgId
                  ? eq(taskStatuses.organizationId, orgId)
                  : eq(taskStatuses.userId, template.userId),
                eq(taskStatuses.scope, "general"),
                eq(taskStatuses.name, "Todo"),
              ),
            });

            await tx.insert(tasks).values({
              userId: template.userId,
              organizationId: orgId,
              title: template.name,
              description: template.description,
              clientId,
              projectId,
              status: "todo",
              statusId: todoLane?.id ?? null,
              priority: "medium",
              sourceType: "recurring",
            });
          }
        }

        const next = calculateNextDue(
          frequency,
          now,
          template.dayOfWeek,
          template.dayOfMonth,
          now,
        );

        // Update template
        await tx
          .update(recurringTimeTemplates)
          .set({
            lastGenerated: now,
            nextDue: next,
            ...(resumedFromPause
              ? { isPaused: false, pausedUntil: null, pauseReason: null }
              : {}),
          })
          .where(eq(recurringTimeTemplates.id, template.id));
        return next;
      });

      for (const { packageId, deduction } of alerts) {
        try {
          await checkAndSendLowBalanceAlert(
            db,
            template.userId,
            packageId,
            deduction,
          );
        } catch (err) {
          console.warn(
            `[Recurring] Low-balance alert failed for template ${template.id}:`,
            err,
          );
        }
      }

      console.warn(
        `[Cron] Generated time entry for template ${template.name} (${template.id}), next due: ${nextDue.toISOString()}`,
      );
      succeeded++;
    } catch (error) {
      console.error(
        `[Cron] Failed to generate entry for template ${template.id}:`,
        error,
      );
      failed++;
      errors.push({
        templateId: template.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  console.warn(`[Cron] Completed: ${succeeded} succeeded, ${failed} failed`);

  if (errors.length > 0) {
    captureRouteError(new Error(errors.map((e) => e.error).join("; ")), {
      route: "/api/cron/recurring",
      type: "cron",
    });
  }

  return {
    itemsProcessed: pendingTemplates.length,
    itemsSucceeded: succeeded,
    itemsFailed: failed,
    metadata: errors.length > 0 ? { errors } : undefined,
  };
});
