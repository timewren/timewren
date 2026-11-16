import { render } from "@react-email/render";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createElement } from "react";
import { InvoiceReminderEmail } from "@/components/email/InvoiceReminderEmail";
import { toIntlLocale } from "@/i18n/format-locale";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { clients, companyProfiles, invoices } from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import {
  calcReminderCharges,
  FRIENDLY_REMINDER_DAYS_BEFORE,
  isReminderDue,
} from "@/lib/invoices/reminder-rules";
import { getClientPortalUrl } from "@/lib/portal/client-url";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";

// Automatiske rykkere med dansk rentelov (#92): dagligt cron —
// venlig påmindelse FRIENDLY_REMINDER_DAYS_BEFORE dage før forfald +
// rykker 1-3 efter forfald (gebyr/kompensation/morarente opgjort efter
// renteloven; kun mails i v1 — ingen gebyr-postering, jf. issuets pkt. 3).
// Opt-in pr. kunde (clients.autoReminderEnabled).
// Schedule: dagligt 07:40 (cron-sidecar).

export const GET = withCronLogging("invoice-reminders", async () => {
  const now = new Date();

  // Kandidater: sendte/forfaldne fakturaer for opt-in-kunder m. email
  const candidates = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      amount: invoices.amount,
      status: invoices.status,
      dueDate: invoices.dueDate,
      reminderCount: invoices.reminderCount,
      reminderSentAt: invoices.reminderSentAt,
      friendlyReminderSentAt: invoices.friendlyReminderSentAt,
      userId: invoices.userId,
      organizationId: invoices.organizationId,
      kind: invoices.kind,
      clientId: clients.id,
      clientName: clients.name,
      clientEmail: clients.email,
      clientCvr: clients.cvrNumber,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(
      and(
        eq(clients.autoReminderEnabled, true),
        inArray(invoices.status, ["sent", "overdue"]),
        eq(invoices.kind, "invoice"),
        ne(clients.email, ""),
      ),
    );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const senderCache = new Map<string, string>();
  const localeCache = new Map<string, string>();

  for (const inv of candidates) {
    try {
      if (!inv.dueDate || !inv.clientEmail) {
        skipped++;
        continue;
      }
      const dueDate = new Date(inv.dueDate);
      const amount = Number.parseFloat(inv.amount || "0");
      if (!Number.isFinite(amount) || amount <= 0) {
        skipped++;
        continue;
      }

      // Venlig påmindelse: X dage før forfald, én gang
      const friendlyFrom = new Date(dueDate);
      friendlyFrom.setDate(
        friendlyFrom.getDate() - FRIENDLY_REMINDER_DAYS_BEFORE,
      );
      const isFriendlyWindow =
        now >= friendlyFrom && now < dueDate && !inv.friendlyReminderSentAt;

      // Rykker: efter forfald, rentelovens kadence
      const reminderDue =
        inv.status === "overdue" &&
        isReminderDue(
          {
            dueDate,
            reminderCount: inv.reminderCount ?? 0,
            lastReminderAt: inv.reminderSentAt,
          },
          now,
        );

      if (!isFriendlyWindow && !reminderDue) {
        skipped++;
        continue;
      }

      const senderKey = inv.organizationId ?? inv.userId;
      let senderName = senderCache.get(senderKey);
      if (senderName === undefined) {
        const profile = await db.query.companyProfiles.findFirst({
          where: inv.organizationId
            ? eq(companyProfiles.organizationId, inv.organizationId)
            : eq(companyProfiles.userId, inv.userId),
          columns: { name: true },
        });
        senderName = profile?.name || "";
        senderCache.set(senderKey, senderName);
      }

      // Kunden har ingen profil: mailen følger afsenderens sprog.
      const localeKey = `${inv.userId}|${inv.clientEmail}`;
      let locale = localeCache.get(localeKey);
      if (!locale) {
        locale = await getRecipientLocale({
          userId: inv.userId,
          email: inv.clientEmail,
        });
        localeCache.set(localeKey, locale);
      }
      // Brandet er afsenderens (kontoens), ikke kundens.
      const mb = await resolveMailBrand({ userId: inv.userId });
      const t = mailT("emailsBilling", locale, mb?.key);
      const senderLabel = senderName || t("reminder.fallbackSender");

      const reminderNumber = (inv.reminderCount ?? 0) + 1;
      const daysOverdue = Math.max(
        0,
        Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000),
      );
      const charges = reminderDue
        ? {
            ...calcReminderCharges({
              principal: amount,
              reminderNumber,
              daysOverdue,
              isBusinessClient: !!inv.clientCvr,
            }),
            daysOverdue,
          }
        : null;

      const portalUrl = await getClientPortalUrl(db, inv.clientId);
      const displayNumber = formatInvoiceNumber(inv.invoiceNumber);

      const html = await render(
        createElement(InvoiceReminderEmail, {
          mailBrand: mb,
          clientName: inv.clientName,
          senderName: senderLabel,
          invoiceNumber: displayNumber,
          locale,
          amount,
          dueDate: dueDate.toLocaleDateString(toIntlLocale(locale), {
            timeZone: "Europe/Copenhagen",
          }),
          reminder: charges,
          portalUrl,
        }),
      );

      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to: inv.clientEmail,
        subject: charges
          ? t("reminder.subjectOverdue", {
              n: charges.reminderNumber,
              number: displayNumber,
              sender: senderLabel,
            })
          : t("reminder.subjectFriendly", { number: displayNumber }),
        html,
      });
      if (response.error) {
        throw new Error(`Resend: ${JSON.stringify(response.error)}`);
      }

      await db
        .update(invoices)
        .set(
          charges
            ? { reminderCount: reminderNumber, reminderSentAt: now }
            : { friendlyReminderSentAt: now },
        )
        .where(eq(invoices.id, inv.id));
      sent++;
    } catch (err) {
      failed++;
      console.error(
        `[Invoice Reminders] ${inv.id} fejlede:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    itemsProcessed: sent + failed,
    itemsSucceeded: sent,
    itemsFailed: failed,
    metadata: { candidates: candidates.length, skippedNotDue: skipped },
  };
});
