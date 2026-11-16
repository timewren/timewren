import { and, eq, isNotNull, lte } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { clients, companyProfiles, prepaidPackages } from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { sendNotification } from "@/lib/notifications";
import { getClientPortalUrl } from "@/lib/portal/client-url";
import { renewPackageInTx } from "@/lib/prepaid/renew-package";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { emitWebhookEvent } from "@/lib/webhooks/events";

// Periodiske klippekort (#79): dagligt cron der fornyer pakker med
// renewalNextAt <= nu. Der oprettes en NY pakke (kæden spores via
// renewedFromId); den gamle arkiveres. Rollover "carry" overfører
// restklip; overtræk (#93) modregnes altid i den nye periode.
// Schedule: dagligt 06:45 (cron-sidecar).

export const GET = withCronLogging("prepaid-renewals", async () => {
  const now = new Date();

  const due = await db.query.prepaidPackages.findMany({
    where: and(
      eq(prepaidPackages.isActive, true),
      isNotNull(prepaidPackages.renewalInterval),
      lte(prepaidPackages.renewalNextAt, now),
    ),
  });

  let renewed = 0;
  let failed = 0;

  for (const pkg of due) {
    try {
      const renewal = await db.transaction(async (tx) => {
        // Lås pakken og re-tjek — undgå dobbelt-fornyelse ved samtidige
        // cron-kørsler (samme mønster som deductHoursCore).
        const [locked] = await tx
          .select()
          .from(prepaidPackages)
          .where(eq(prepaidPackages.id, pkg.id))
          .for("update");
        if (
          !locked?.isActive ||
          !locked.renewalInterval ||
          !locked.renewalNextAt ||
          locked.renewalNextAt > now
        ) {
          return null;
        }

        return renewPackageInTx(tx, locked, now);
      });
      if (!renewal) continue;

      renewed++;

      // Fornyelsesfakturaen ligger som kladde (#198) — sig det til brugeren,
      // så den bliver gennemset og udstedt. Fejl må ikke vælte fornyelsen.
      if (renewal.draftInvoiceId) {
        try {
          await sendNotification({
            type: "recurring_invoice_draft",
            userId: pkg.userId,
            i18n: { key: "renewalDraft", values: { name: pkg.name } },
            url: `/dashboard/invoices/${renewal.draftInvoiceId}`,
          });
        } catch (notifyErr) {
          console.error(
            `[Prepaid Renewals] notifikation for ${pkg.id} fejlede:`,
            notifyErr instanceof Error ? notifyErr.message : notifyErr,
          );
        }
      }

      // Kunde-besked (#79 fase 2): kort, branded fornyelses-mail m.
      // portal-link. Fejl her må ikke rulle fornyelsen tilbage.
      try {
        const client = await db.query.clients.findFirst({
          where: eq(clients.id, pkg.clientId),
          columns: { name: true, email: true },
        });
        if (client?.email) {
          const profile = await db.query.companyProfiles.findFirst({
            where: pkg.organizationId
              ? eq(companyProfiles.organizationId, pkg.organizationId)
              : eq(companyProfiles.userId, pkg.userId),
            columns: { name: true },
          });
          // Brandet er afsenderens (kontoens), ikke kundens.
          const mb = await resolveMailBrand({ userId: pkg.userId });
          const locale = await getRecipientLocale({
            userId: pkg.userId,
            email: client.email,
            fallback: mb?.locale,
          });
          const t = mailT("emailsBilling", locale, mb?.key);
          const senderName = profile?.name || t("renewed.fallbackSender");
          const portalUrl = await getClientPortalUrl(db, pkg.clientId);
          const mailResponse = await resend.emails.send({
            from: mb?.from ?? DEFAULT_FROM_EMAIL,
            to: client.email,
            subject: t("renewed.subject", { name: pkg.name }),
            text: [
              t("renewed.body", {
                client: client.name,
                name: pkg.name,
                sender: senderName,
              }),
              portalUrl ? t("renewed.portal", { url: portalUrl }) : "",
              t("renewed.signoff", { sender: senderName }),
            ]
              .filter(Boolean)
              .join("\n\n"),
          });
          if (mailResponse.error) {
            console.error(
              `[Prepaid Renewals] kunde-besked afvist af Resend for ${pkg.id}:`,
              mailResponse.error,
            );
          }
        }
      } catch (mailErr) {
        console.error(
          `[Prepaid Renewals] kunde-besked for ${pkg.id} fejlede:`,
          mailErr instanceof Error ? mailErr.message : mailErr,
        );
      }

      // prepaid.created med renewedFrom — der FINDES en ny pakke; en
      // dedikeret renewed-event kan komme når event-kataloget udvides
      emitWebhookEvent({
        userId: pkg.userId,
        orgId: pkg.organizationId,
        eventType: "prepaid.created",
        eventId: pkg.id,
        clientId: pkg.clientId,
        data: {
          name: pkg.name,
          renewedFrom: pkg.id,
        },
      });
    } catch (err) {
      failed++;
      console.error(
        `[Prepaid Renewals] ${pkg.id} fejlede:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    itemsProcessed: renewed + failed,
    itemsSucceeded: renewed,
    itemsFailed: failed,
    metadata: { duePackages: due.length },
  };
});
