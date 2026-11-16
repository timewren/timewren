import { render } from "@react-email/render";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "@/i18n/config";
import { AdminDigestEmail } from "./AdminDigestEmail";
import { AluntaKlippekortCreatedEmail } from "./AluntaKlippekortCreatedEmail";
import { CancellationConfirmedEmail } from "./CancellationConfirmedEmail";
import { DataExportReadyEmail } from "./DataExportReadyEmail";
import { DripFirstWeekStatsEmail } from "./DripFirstWeekStatsEmail";
import { DripUpgradeReminderEmail } from "./DripUpgradeReminderEmail";
import { DripWinBack30Email } from "./DripWinBack30Email";
import { ImportCompleteEmail } from "./ImportCompleteEmail";
import { InvoiceEmail } from "./InvoiceEmail";
import { InvoiceReminderEmail } from "./InvoiceReminderEmail";
import { MonthlyClientStatusEmail } from "./MonthlyClientStatusEmail";
import { MonthlySummaryEmail } from "./MonthlySummaryEmail";
import { NewLoginEmail } from "./NewLoginEmail";
import { OrganizationInviteEmail } from "./OrganizationInviteEmail";
import { PasswordResetEmail } from "./PasswordResetEmail";
import { PaymentFailedEmail } from "./PaymentFailedEmail";
import { PaymentReminderEmail } from "./PaymentReminderEmail";
import { PrepaidExpiryEmail } from "./PrepaidExpiryEmail";
import { PrepaidLowBalanceEmail } from "./PrepaidLowBalanceEmail";
import { ProjectBudgetAlertEmail } from "./ProjectBudgetAlertEmail";
import { TaskNotificationEmail } from "./TaskNotificationEmail";
import { TimesheetNotificationEmail } from "./TimesheetNotificationEmail";
import { TrialEndingEmail } from "./TrialEndingEmail";
import { UnbilledReminderEmail } from "./UnbilledReminderEmail";
import { WeeklySummaryEmail } from "./WeeklySummaryEmail";

import { WelcomeEmail } from "./WelcomeEmail";

// Hver skabelon renderes på alle sprog. Manglende nøgler giver en
// console.error fra next-intl, og selve nøglenavnet ville stå i outputtet.
const templates: Record<
  string,
  (locale: string) => Parameters<typeof render>[0]
> = {
  InvoiceEmail: (locale) =>
    createElement(InvoiceEmail, {
      invoiceNumber: "2026-0042",
      clientName: "Kunde",
      amount: "8125.00",
      dueDate: "2026-10-25T00:00:00.000Z",
      senderName: "Afsender",
      senderEmail: "a@example.com",
      notes: "Tak",
      locale,
    }),
  InvoiceReminderEmail: (locale) =>
    createElement(InvoiceReminderEmail, {
      clientName: "Kunde",
      senderName: "Afsender",
      invoiceNumber: "2026-0042",
      amount: 1000,
      dueDate: "25.10.2026",
      reminder: {
        reminderNumber: 2,
        daysOverdue: 14,
        totalFees: 200,
        compensation: 310,
        accruedInterest: 5.5,
        totalClaim: 1515.5,
      } as never,
      portalUrl: "https://example.com/portal",
      locale,
    }),
  PaymentFailedEmail: (locale) =>
    createElement(PaymentFailedEmail, {
      userName: "Test",
      amountDue: "79,00 kr",
      billingPortalUrl: "https://example.com/billing",
      locale,
    }),
  PaymentReminderEmail: (locale) =>
    createElement(PaymentReminderEmail, {
      userName: "Test",
      urgency: "urgent",
      daysOverdue: 5,
      billingPortalUrl: "https://example.com/billing",
      locale,
    }),
  TrialEndingEmail: (locale) =>
    createElement(TrialEndingEmail, {
      userName: "Test",
      daysRemaining: 1,
      upgradeUrl: "https://example.com/upgrade",
      locale,
    }),
  CancellationConfirmedEmail: (locale) =>
    createElement(CancellationConfirmedEmail, {
      userName: "Test",
      endDate: "1. december 2026",
      reactivateUrl: "https://example.com/reactivate",
      locale,
    }),
  PrepaidExpiryEmail: (locale) =>
    createElement(PrepaidExpiryEmail, {
      recipientName: "Test",
      clientName: "Kunde",
      packageName: "Pakke",
      remainingHours: "4.50",
      expiryDate: "2026-12-01T00:00:00.000Z",
      daysUntilExpiry: 3,
      recipient: "client",
      senderName: "Afsender",
      senderEmail: "a@example.com",
      locale,
    }),
  PrepaidLowBalanceEmail: (locale) =>
    createElement(PrepaidLowBalanceEmail, {
      recipientName: "Test",
      clientName: "Kunde",
      packageName: "Pakke",
      remainingHours: "3.50",
      totalHours: "20",
      percentageRemaining: 17,
      locale,
    }),
  AluntaKlippekortCreatedEmail: (locale) =>
    createElement(AluntaKlippekortCreatedEmail, {
      userName: "Test",
      clientName: "Kunde",
      hours: "10",
      hourlyRate: "850",
      planName: "Plan",
      dashboardUrl: "https://example.com/dashboard",
      locale,
    }),
  WeeklySummaryEmail: (locale) =>
    createElement(WeeklySummaryEmail, {
      userName: "Test",
      weekNumber: 41,
      year: 2026,
      hoursThisWeek: 30,
      hoursLastWeek: 25,
      revenueThisWeek: 20000,
      revenueLastWeek: 20000,
      unbilledAmount: 5000,
      topClients: [{ name: "Kunde", hours: 10, revenue: 5000 }],
      daysTracked: 5,
      locale,
    }),
  MonthlySummaryEmail: (locale) =>
    createElement(MonthlySummaryEmail, {
      userName: "Test",
      monthName: "Oktober",
      year: 2026,
      hoursThisMonth: 100,
      hoursLastMonth: 0,
      revenueThisMonth: 50000,
      revenueLastMonth: 40000,
      clientBreakdown: [{ name: "Kunde", hours: 10, revenue: 5000 }],
      invoiceStats: {
        paid: 2,
        paidAmount: 10000,
        outstanding: 1,
        outstandingAmount: 500,
      },
      prepaidStats: {
        activePackages: 3,
        lowBalancePackages: 1,
        expiringPackages: 1,
      },
      yearToDateRevenue: 300000,
      locale,
    }),
  UnbilledReminderEmail: (locale) =>
    createElement(UnbilledReminderEmail, {
      userName: "Test",
      totalUnbilledHours: 12.5,
      totalUnbilledValue: 8000,
      unbilledByClient: [{ name: "Kunde", hours: 12.5, value: 8000 }],
      frequency: "weekly",
      locale,
    }),
  MonthlyClientStatusEmail: (locale) =>
    createElement(MonthlyClientStatusEmail, {
      clientName: "Kunde",
      senderName: "Afsender",
      monthLabel: "oktober 2026",
      totalHours: 12.5,
      projects: [{ name: "Projekt", hours: 12.5 }],
      packages: [
        { name: "Pakke", remainingHours: 4, totalHours: 10, overdraftHours: 0 },
      ],
      pendingApprovals: 2,
      personalNote: "Tak for måneden",
      portalUrl: "https://example.com/portal",
      locale,
    }),
  ProjectBudgetAlertEmail: (locale) =>
    createElement(ProjectBudgetAlertEmail, {
      recipientName: "Test",
      projectName: "Projekt",
      clientName: "Kunde",
      monthLabel: "oktober 2026",
      usedHours: "40",
      budgetHours: "50",
      percentage: 80,
      level: 80,
      projectUrl: "https://example.com/project",
      locale,
    }),
  TimesheetNotificationEmail: (locale) =>
    createElement(TimesheetNotificationEmail, {
      recipientName: "Test",
      heading: "Overskrift",
      bodyLines: ["Linje"],
      ctaLabel: "Åbn",
      ctaUrl: "https://example.com",
      locale,
    }),
  DataExportReadyEmail: (locale) =>
    createElement(DataExportReadyEmail, {
      recipientName: "Test",
      downloadUrl: "https://example.com/download",
      expiresAt: "2026-12-01T10:00:00.000Z",
      format: "zip",
      scope: "organization",
      locale,
    }),
  ImportCompleteEmail: (locale) =>
    createElement(ImportCompleteEmail, {
      userName: "Test",
      statusLabel: "Import færdig med fejl",
      status: "completed_with_errors",
      source: "Toggl",
      importedEntries: 100,
      skippedEntries: 3,
      failedEntries: 2,
      totalEntries: 105,
      timeUrl: "https://example.com/time",
      locale,
    }),
  AdminDigestEmail: (locale) =>
    createElement(AdminDigestEmail, {
      weekLabel: "Uge 1",
      mrr: "1.000 kr.",
      mrrChange: "+5 %",
      mrrChangeTone: "up",
      activeSubscriptions: 4,
      trialsEndingSoon: 1,
      alerts: ["x"],
      newSignups: 1,
      signups: [{ name: "A", detail: "b" }],
      adminUrl: "https://example.com/admin",
      locale,
    }),
  TaskNotificationEmail: (locale) =>
    createElement(TaskNotificationEmail, {
      kind: "daily_digest",
      name: "Test",
      dateLabel: "mandag",
      tasksToday: [{ title: "Opgave", deadline: "i dag", priority: "urgent" }],
      overdueCount: 2,
      completedYesterday: 1,
      tasksUrl: "https://example.com/tasks",
      locale,
    }),
  WelcomeEmail: (locale) =>
    createElement(WelcomeEmail, { userName: "Test", locale }),
  PasswordResetEmail: (locale) =>
    createElement(PasswordResetEmail, {
      userName: "Test",
      resetUrl: "https://example.com/reset",
      locale,
    }),
  NewLoginEmail: (locale) =>
    createElement(NewLoginEmail, {
      userName: "Test",
      loginAt: new Date("2026-10-05T09:42:00Z"),
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
      locale,
    }),
  OrganizationInviteEmail: (locale) =>
    createElement(OrganizationInviteEmail, {
      inviterName: "Anna",
      organizationName: "Acme",
      inviteUrl: "https://example.com/invite",
      role: "member",
      locale,
    }),
  DripFirstWeekStatsEmail: (locale) =>
    createElement(DripFirstWeekStatsEmail, {
      userName: "Test",
      totalHoursTracked: 12.5,
      clientCount: 3,
      projectCount: 4,
      locale,
    }),
  DripUpgradeReminderEmail: (locale) =>
    createElement(DripUpgradeReminderEmail, {
      userName: "Test",
      daysLeft: 3,
      locale,
    }),
  DripWinBack30Email: (locale) =>
    createElement(DripWinBack30Email, {
      userName: "Test",
      unbilledHours: 5.5,
      unbilledValue: 4000,
      pendingTasks: 2,
      locale,
    }),
};

// Rå nøglenavne som "emailsAuth.welcome.intro" eller "shell.sentVia"
const RAW_KEY = /\b(?:emails\w*|shell|personal)\.[a-z]\w*(?:\.\w+)*/;

describe("mailskabeloner på alle sprog", () => {
  afterEach(() => vi.restoreAllMocks());

  for (const [name, build] of Object.entries(templates)) {
    for (const locale of LOCALES) {
      it(`${name} (${locale}) renderes uden manglende nøgler`, async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const html = await render(build(locale));
        const text = await render(build(locale), { plainText: true });
        expect(errors).not.toHaveBeenCalled();
        expect(html).toContain(`lang="${locale}"`);
        expect(text).not.toMatch(RAW_KEY);
        expect(html).not.toMatch(RAW_KEY);
      });
    }
  }

  it("ændrer sprog i teksten", async () => {
    const da = await render(build("da"), { plainText: true });
    const de = await render(build("de"), { plainText: true });
    expect(da).toMatch(/velkommen/i);
    expect(de).toMatch(/willkommen/i);
  });

  function build(locale: string) {
    return templates.WelcomeEmail(locale);
  }
});
