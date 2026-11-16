import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import { PREPAID_EXPIRY_WARNING_DAYS } from "@/lib/config";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { type clients, prepaidPackages, type users } from "@/lib/db/schema";
import { sendExpiryWarning } from "@/lib/email/prepaid";
import { getClientPortalUrl } from "@/lib/portal/client-url";
import {
  prepaidDaysUntilExpiry,
  prepaidExpiredBefore,
  prepaidExpiresWithinBefore,
} from "@/lib/prepaid/expiry";
import { countPrepaidIntegrityOrphans } from "@/lib/prepaid/integrity";
import { captureRouteError } from "@/lib/utils/sentry";
import { emitWebhookEvent } from "@/lib/webhooks/events";

// This endpoint is called by Vercel Cron to send expiry warnings
// and auto-deactivate expired packages.
// Schedule: daily at 8 AM

export const GET = withCronLogging("prepaid-alerts", async (_request) => {
  const now = new Date();
  // Kortet gælder hele udløbsdagen i dansk tid (#736): udløbet = udløbsdatoen
  // ligger før dagens danske dato.
  const expiredBefore = prepaidExpiredBefore(now);

  // Auto-deactivate expired packages
  const expiredResult = await db
    .update(prepaidPackages)
    .set({ isActive: false })
    .where(
      and(
        eq(prepaidPackages.isActive, true),
        lt(prepaidPackages.expiryDate, expiredBefore),
      ),
    )
    .returning({
      id: prepaidPackages.id,
      userId: prepaidPackages.userId,
      organizationId: prepaidPackages.organizationId,
      clientId: prepaidPackages.clientId,
      name: prepaidPackages.name,
      remainingHours: prepaidPackages.remainingHours,
      expiryDate: prepaidPackages.expiryDate,
    });

  if (expiredResult.length > 0) {
    console.warn(
      `[Prepaid] Auto-deactivated ${expiredResult.length} expired packages`,
    );
    for (const pkg of expiredResult) {
      emitWebhookEvent({
        userId: pkg.userId,
        orgId: pkg.organizationId,
        eventType: "prepaid.expired",
        eventId: pkg.id,
        data: {
          packageId: pkg.id,
          packageName: pkg.name,
          remainingHours: pkg.remainingHours,
          expiryDate: pkg.expiryDate,
        },
        clientId: pkg.clientId,
      });
    }
  }
  // Integritets-tjek (#205): prepaid-tidsposter UDEN matching usage-række
  // betyder at en skrivesti er smuttet udenom deductHoursCore (fx gammel
  // desktop-sync). Report-only — reparation kræver stillingtagen pr. post.
  const orphanCount = await countPrepaidIntegrityOrphans();
  if (orphanCount > 0) {
    console.warn(
      `[Prepaid] INTEGRITET: ${orphanCount} prepaid-tidspost(er) uden usage-række — en skrivesti er gået udenom deductHoursCore`,
    );
  }

  // Udløbsdato fra i dag til og med i dag + PREPAID_EXPIRY_WARNING_DAYS
  const warningBefore = prepaidExpiresWithinBefore(
    PREPAID_EXPIRY_WARNING_DAYS,
    now,
  );

  // Find all active prepaid packages expiring within the warning period
  // that haven't already received an expiry alert
  const expiringPackages = await db.query.prepaidPackages.findMany({
    where: and(
      eq(prepaidPackages.isActive, true),
      lt(prepaidPackages.expiryDate, warningBefore),
      gte(prepaidPackages.expiryDate, expiredBefore),
      or(
        isNull(prepaidPackages.expiryAlertSentAt),
        // Gensend kun hvis advarslen blev sendt FØR dagen der ligger en hel
        // advarselsperiode tilbage (fx forlænget kort). Grænsen er dansk
        // midnat, ikke now − N døgn: ellers kunne kortet — der nu gælder hele
        // udløbsdagen (#736) — få en ekstra mail på selve udløbsdagen,
        // afhængigt af hvornår cronen startede.
        lt(
          prepaidPackages.expiryAlertSentAt,
          prepaidExpiresWithinBefore(-PREPAID_EXPIRY_WARNING_DAYS - 1, now),
        ),
      ),
    ),
    with: {
      client: true,
      user: true,
    },
  });

  // Filter packages with remaining hours
  const packagesToAlert = expiringPackages.filter(
    (pkg) => parseFloat(pkg.remainingHours || "0") > 0,
  );

  let sentCount = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const pkg of packagesToAlert) {
    try {
      const user = pkg.user as typeof users.$inferSelect | undefined;
      const client = pkg.client as typeof clients.$inferSelect | undefined;

      if (!user || !client) continue;

      const alertRecipient = user.prepaidAlertRecipient || "owner";
      const recipients: string[] = [];

      // Determine recipients based on user preference
      if (alertRecipient === "owner" || alertRecipient === "both") {
        recipients.push(user.email);
      }
      if (
        (alertRecipient === "client" || alertRecipient === "both") &&
        client.email
      ) {
        recipients.push(client.email);
      }

      const daysUntilExpiry = Math.max(
        0,
        prepaidDaysUntilExpiry(pkg.expiryDate, now) ?? 0,
      );

      // Kundemodtagere sendes til portalen (#95)
      const clientPortalUrl = recipients.some((r) => r === client.email)
        ? await getClientPortalUrl(db, client.id)
        : null;

      // Send alert to each recipient
      for (const recipientEmail of recipients) {
        const isClient = recipientEmail === client.email;
        try {
          await sendExpiryWarning({
            to: recipientEmail,
            recipientName: isClient ? client.name : user.name,
            clientName: client.name,
            packageName: pkg.name,
            remainingHours: parseFloat(pkg.remainingHours || "0").toFixed(2),
            expiryDate: pkg.expiryDate?.toISOString() || "",
            daysUntilExpiry,
            portalUrl: isClient ? clientPortalUrl : null,
            recipient: isClient ? "client" : "owner",
            senderName: user.name,
            senderEmail: user.email,
          });
          sentCount++;
        } catch (error) {
          failed++;
          console.error(
            `Failed to send expiry alert for package ${pkg.id}:`,
            error,
          );
          errors.push(`Package ${pkg.id}: ${(error as Error).message}`);
        }
      }

      // Mark alert as sent
      await db
        .update(prepaidPackages)
        .set({ expiryAlertSentAt: new Date() })
        .where(eq(prepaidPackages.id, pkg.id));
    } catch (error) {
      failed++;
      console.error(`[Prepaid Alerts] Failed for package ${pkg.id}:`, error);
      errors.push(`Package ${pkg.id}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/prepaid-alerts",
      type: "cron",
    });
  }

  return {
    itemsProcessed: packagesToAlert.length,
    itemsSucceeded: sentCount,
    itemsFailed: failed,
    metadata: {
      expiredDeactivated: expiredResult.length,
      prepaidIntegrityOrphans: orphanCount,
      packagesChecked: packagesToAlert.length,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
});
