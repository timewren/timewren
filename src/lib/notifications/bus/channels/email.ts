import { brand } from "@/lib/brand";
import { getAppUrl } from "@/lib/config";
import {
  sendAbsenceDecidedEmail,
  sendAbsenceRegisteredEmail,
  sendAbsenceRequestedEmail,
} from "@/lib/email/absence";
import { mailT, normalizeMailLocale } from "@/lib/email/locale";
import type { EmailType } from "@/lib/email/logger";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import {
  sendTimesheetDecisionEmail,
  sendTimesheetEmail,
  sendTimesheetReminderEmail,
  sendTimesheetSubmittedEmail,
} from "@/lib/email/timesheet";
import type { NotificationPayloads } from "../events";
import {
  ChannelSkipped,
  type NotificationChannel,
  type OutgoingNotification,
} from "./types";

/**
 * E-mail-kanal. Hændelser med en eksisterende React-Email-skabelon bruger
 * den (uændret indhold for kunderne); resten renderes generisk via den
 * fælles timeseddel-layout-hjælper.
 */
export const emailChannel: NotificationChannel = {
  key: "email",
  scope: "user",
  async send(msg) {
    const r = msg.recipient;
    if (!r?.email) throw new ChannelSkipped("Ingen e-mail-adresse");
    if (r.email.endsWith(".demo")) throw new ChannelSkipped("Demo-bruger");
    await sendForEvent(
      msg,
      r.email,
      r.name,
      r.userId,
      normalizeMailLocale(r.locale),
    );
  },
  isTransient(error) {
    const m = error instanceof Error ? error.message : String(error);
    return /ECONN|ETIMEDOUT|fetch failed|"statusCode":5\d\d|rate_limit/i.test(
      m,
    );
  },
};

async function sendForEvent(
  msg: OutgoingNotification,
  to: string,
  recipientName: string,
  recipientUserId: string,
  locale: string,
): Promise<void> {
  switch (msg.event) {
    case "timesheet.submitted": {
      const p = msg.payload as NotificationPayloads["timesheet.submitted"];
      await sendTimesheetSubmittedEmail({
        to,
        managerName: recipientName,
        employeeName: p.employeeName,
        weekStart: p.weekStart,
        totalHours: p.totalHours,
        userId: p.employeeUserId,
      });
      return;
    }
    case "timesheet.approved":
    case "timesheet.rejected": {
      const p = msg.payload as NotificationPayloads["timesheet.rejected"];
      await sendTimesheetDecisionEmail({
        to,
        employeeName: recipientName,
        managerName: p.managerName,
        weekStart: p.weekStart,
        decision: msg.event === "timesheet.approved" ? "approved" : "rejected",
        rejectionReason: p.rejectionReason ?? undefined,
        userId: recipientUserId,
      });
      return;
    }
    case "reminder.timesheet_missing": {
      const p =
        msg.payload as NotificationPayloads["reminder.timesheet_missing"];
      await sendTimesheetReminderEmail({
        to,
        employeeName: recipientName,
        weekStart: p.weekStart,
        registeredHours: p.registeredHours,
        userId: recipientUserId,
      });
      return;
    }
    case "absence.requested": {
      const p = msg.payload as NotificationPayloads["absence.requested"];
      await sendAbsenceRequestedEmail({
        to,
        managerName: recipientName,
        employeeName: p.employeeName,
        typeName: p.typeName,
        startDate: p.startDate,
        endDate: p.endDate,
        totalDays: p.totalDays,
        note: p.note,
        userId: p.employeeUserId,
      });
      return;
    }
    case "absence.approved":
    case "absence.rejected": {
      const p = msg.payload as NotificationPayloads["absence.rejected"];
      await sendAbsenceDecidedEmail({
        to,
        employeeName: recipientName,
        managerName: p.managerName,
        typeName: p.typeName,
        startDate: p.startDate,
        endDate: p.endDate,
        decision: msg.event === "absence.approved" ? "approved" : "rejected",
        rejectionReason: p.rejectionReason,
        userId: recipientUserId,
      });
      return;
    }
    case "absence.registered": {
      const p = msg.payload as NotificationPayloads["absence.registered"];
      await sendAbsenceRegisteredEmail({
        to,
        employeeName: recipientName,
        registrarName: p.registrarName,
        typeName: p.typeName,
        startDate: p.startDate,
        endDate: p.endDate,
        hoursPerDay: p.hoursPerDay,
        userId: recipientUserId,
      });
      return;
    }
    default: {
      // Generisk skabelon for de nye hændelser (genåbnet, sygemelding,
      // compliance, digest)
      const mb = await resolveMailBrand({ userId: recipientUserId, email: to });
      await sendTimesheetEmail({
        to,
        userId: recipientUserId,
        locale,
        mb,
        emailType: GENERIC_EMAIL_TYPES[msg.event] ?? "manager_digest",
        subject: msg.rendered.title,
        recipientName,
        heading: msg.rendered.title,
        bodyLines: msg.rendered.body.split("\n"),
        ctaLabel: mailT(
          "notifications",
          locale,
          mb?.key,
        )("emailOpenIn", {
          brand: (mb?.brand ?? brand).name,
        }),
        ctaUrl: `${mb?.appUrl ?? getAppUrl()}${msg.rendered.url}`,
      });
    }
  }
}

const GENERIC_EMAIL_TYPES: Partial<Record<string, EmailType>> = {
  "timesheet.reopened": "timesheet_reopened",
  "period.closing_ready": "period_closing_ready",
  "period.closing_approved": "period_closing_approved",
  "period.closing_unlocked": "period_closing_unlocked",
  "absence.sick_registered": "absence_sick_registered",
  "compliance.warning": "compliance_warning",
  "compliance.forecast": "compliance_warning",
  "digest.manager": "manager_digest",
  "reminder.coverage_low": "coverage_reminder",
};
