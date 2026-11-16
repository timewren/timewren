import { render } from "@react-email/render";
import { createElement, type FunctionComponent } from "react";
import { describe, expect, it } from "vitest";
import { mailBrandFor } from "@/lib/email/mail-brand";
import { AluntaKlippekortCreatedEmail } from "./AluntaKlippekortCreatedEmail";
import { CancellationConfirmedEmail } from "./CancellationConfirmedEmail";
import { DataExportReadyEmail } from "./DataExportReadyEmail";
import { DripAiFeaturesEmail } from "./DripAiFeaturesEmail";
import { DripClientNoKlippekortEmail } from "./DripClientNoKlippekortEmail";
import { DripExtensionTipsEmail } from "./DripExtensionTipsEmail";
import { DripFirstWeekStatsEmail } from "./DripFirstWeekStatsEmail";
import { DripGettingStartedEmail } from "./DripGettingStartedEmail";
import { DripKlippekortTipsEmail } from "./DripKlippekortTipsEmail";
import { DripNeedHelpEmail } from "./DripNeedHelpEmail";
import { DripNoTimeEntryEmail } from "./DripNoTimeEntryEmail";
import { DripTimeNoInvoiceEmail } from "./DripTimeNoInvoiceEmail";
import { DripUpgradeReminderEmail } from "./DripUpgradeReminderEmail";
import { DripWelcomeEmail } from "./DripWelcomeEmail";
import { DripWinBack30Email } from "./DripWinBack30Email";
import { DripWinBack60Email } from "./DripWinBack60Email";
import { EndOfDayEmail } from "./EndOfDayEmail";
import { FirstClientEmail } from "./FirstClientEmail";
import { FirstInvoiceEmail } from "./FirstInvoiceEmail";
import { FirstProjectEmail } from "./FirstProjectEmail";
import { FirstTimeEntryEmail } from "./FirstTimeEntryEmail";
import { ImportCompleteEmail } from "./ImportCompleteEmail";
import { InactivityEmail } from "./InactivityEmail";
import { InvoiceEmail } from "./InvoiceEmail";
import { InvoiceReminderEmail } from "./InvoiceReminderEmail";
import { MagicLinkEmail } from "./MagicLinkEmail";
import { MonthlyClientStatusEmail } from "./MonthlyClientStatusEmail";
import { MonthlySummaryEmail } from "./MonthlySummaryEmail";
import { NewLoginEmail } from "./NewLoginEmail";
import { OrganizationInviteEmail } from "./OrganizationInviteEmail";
import { PasswordChangedEmail } from "./PasswordChangedEmail";
import { PasswordResetEmail } from "./PasswordResetEmail";
import { PaymentFailedEmail } from "./PaymentFailedEmail";
import { PaymentReminderEmail } from "./PaymentReminderEmail";
import { PortalInvitationEmail } from "./PortalInvitationEmail";
import { PrepaidExpiryEmail } from "./PrepaidExpiryEmail";
import { PrepaidLowBalanceEmail } from "./PrepaidLowBalanceEmail";
import { ProjectBudgetAlertEmail } from "./ProjectBudgetAlertEmail";
import { SignupPasswordEmail } from "./SignupPasswordEmail";
import { TaskNotificationEmail } from "./TaskNotificationEmail";
import { TimesheetNotificationEmail } from "./TimesheetNotificationEmail";
import { TrialEndingEmail } from "./TrialEndingEmail";
import { TwoFactorCodeEmail } from "./TwoFactorCodeEmail";
import { UnbilledReminderEmail } from "./UnbilledReminderEmail";
import { VerificationEmail } from "./VerificationEmail";
import { WeeklySummaryEmail } from "./WeeklySummaryEmail";
import { WelcomeEmail } from "./WelcomeEmail";

/**
 * Multibrand (docs/specs/timewren-cloud.md → Mails): hver mail til en bruger
 * renderes for en TimeWren-konto (mailBrand) og må hverken nævne TimeTrack
 * eller timetrack.dk. For en TimeTrack-konto sender afsenderne ingen
 * mailBrand (recipientMailBrand), og outputtet skal være uændret: snapshottet
 * er taget med skabelonerne fra før multibrand-mails (se rapporten/PR'en).
 *
 * URL-props er neutrale (example.com), så testen fanger skabelonernes egne
 * standardlinks og tekster.
 */

const at = new Date("2026-11-08T09:42:00.000Z");
const url = "https://example.com/x";

// biome-ignore lint/suspicious/noExplicitAny: fixtures til mange forskellige props
type Fixture = [FunctionComponent<any>, Record<string, unknown>];

const FIXTURES: Record<string, Fixture> = {
  AluntaKlippekortCreatedEmail: [
    AluntaKlippekortCreatedEmail,
    {
      userName: "Test",
      clientName: "Kunde",
      hours: "10",
      hourlyRate: "750",
      planName: "Pakke",
      dashboardUrl: url,
    },
  ],
  CancellationConfirmedEmail: [
    CancellationConfirmedEmail,
    { userName: "Test", endDate: "1. dec. 2026", reactivateUrl: url },
  ],
  DataExportReadyEmail: [
    DataExportReadyEmail,
    {
      recipientName: "Test",
      downloadUrl: url,
      expiresAt: "2026-12-01T10:00:00.000Z",
      format: "zip",
      scope: "organization",
    },
  ],
  DripAiFeaturesEmail: [DripAiFeaturesEmail, { userName: "Test" }],
  DripClientNoKlippekortEmail: [
    DripClientNoKlippekortEmail,
    { userName: "Test" },
  ],
  DripExtensionTipsEmail: [DripExtensionTipsEmail, { userName: "Test" }],
  DripFirstWeekStatsEmail: [
    DripFirstWeekStatsEmail,
    {
      userName: "Test",
      totalHoursTracked: 12.5,
      clientCount: 2,
      projectCount: 3,
    },
  ],
  DripGettingStartedEmail: [
    DripGettingStartedEmail,
    { userName: "Test", hasClient: false },
  ],
  DripKlippekortTipsEmail: [DripKlippekortTipsEmail, { userName: "Test" }],
  DripNeedHelpEmail: [
    DripNeedHelpEmail,
    { userName: "Test", hasTimeEntries: false },
  ],
  DripNoTimeEntryEmail: [DripNoTimeEntryEmail, { userName: "Test" }],
  DripTimeNoInvoiceEmail: [
    DripTimeNoInvoiceEmail,
    { userName: "Test", unbilledHours: "12" },
  ],
  DripUpgradeReminderEmail: [
    DripUpgradeReminderEmail,
    { userName: "Test", daysLeft: 3 },
  ],
  DripWelcomeEmail: [DripWelcomeEmail, { userName: "Test" }],
  DripWinBack30Email: [DripWinBack30Email, { userName: "Test" }],
  DripWinBack60Email: [DripWinBack60Email, { userName: "Test" }],
  EndOfDayEmail: [
    EndOfDayEmail,
    { title: "Dagen", body: "Husk timerne", timeUrl: url },
  ],
  FirstClientEmail: [
    FirstClientEmail,
    { userName: "Test", clientName: "Kunde" },
  ],
  FirstInvoiceEmail: [
    FirstInvoiceEmail,
    {
      userName: "Test",
      invoiceNumber: "2026-0042",
      amount: "1.000 kr.",
      clientName: "Kunde",
    },
  ],
  FirstProjectEmail: [
    FirstProjectEmail,
    { userName: "Test", projectName: "Projekt", clientName: "Kunde" },
  ],
  FirstTimeEntryEmail: [FirstTimeEntryEmail, { userName: "Test", hours: "2" }],
  ImportCompleteEmail: [
    ImportCompleteEmail,
    {
      userName: "Test",
      statusLabel: "Import fejlede",
      status: "failed",
      source: "Toggl",
      importedEntries: 0,
      skippedEntries: 0,
      failedEntries: 5,
      totalEntries: 5,
      timeUrl: url,
    },
  ],
  InactivityEmail: [
    InactivityEmail,
    { userName: "Test", daysSinceLastActivity: 14 },
  ],
  InvoiceEmail: [
    InvoiceEmail,
    {
      invoiceNumber: "2026-0042",
      clientName: "Kunde",
      amount: "8125.00",
      dueDate: "2026-10-25T00:00:00.000Z",
      senderName: "Afsender",
      senderEmail: "a@example.com",
    },
  ],
  InvoiceReminderEmail: [
    InvoiceReminderEmail,
    {
      clientName: "Kunde",
      senderName: "Afsender",
      invoiceNumber: "2026-0042",
      amount: 1000,
      dueDate: "25.10.2026",
      reminder: null,
      portalUrl: url,
    },
  ],
  MagicLinkEmail: [MagicLinkEmail, { magicLinkUrl: url }],
  MonthlyClientStatusEmail: [
    MonthlyClientStatusEmail,
    {
      clientName: "Kunde",
      senderName: "Afsender",
      monthLabel: "oktober 2026",
      totalHours: 12.5,
      projects: [{ name: "Projekt", hours: 12.5 }],
      packages: [
        { name: "Pakke", remainingHours: 4, totalHours: 10, overdraftHours: 0 },
      ],
      pendingApprovals: 2,
      portalUrl: url,
    },
  ],
  MonthlySummaryEmail: [
    MonthlySummaryEmail,
    {
      userName: "Test",
      monthName: "oktober",
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
    },
  ],
  NewLoginEmail: [
    NewLoginEmail,
    { userName: "Test", loginAt: at, ipAddress: "192.0.2.1" },
  ],
  OrganizationInviteEmail: [
    OrganizationInviteEmail,
    {
      inviterName: "Afsender",
      organizationName: "Firma",
      inviteUrl: url,
      role: "member",
    },
  ],
  PasswordChangedEmail: [
    PasswordChangedEmail,
    { userName: "Test", changedAt: at },
  ],
  PasswordResetEmail: [PasswordResetEmail, { userName: "Test", resetUrl: url }],
  PaymentFailedEmail: [
    PaymentFailedEmail,
    { userName: "Test", amountDue: "79,00 kr", billingPortalUrl: url },
  ],
  PaymentReminderEmail: [
    PaymentReminderEmail,
    {
      userName: "Test",
      urgency: "urgent",
      daysOverdue: 5,
      billingPortalUrl: url,
    },
  ],
  PortalInvitationEmail: [
    PortalInvitationEmail,
    {
      clientName: "Kunde",
      senderName: "Afsender",
      senderEmail: "a@example.com",
      portalUrl: url,
      accessType: "token",
    },
  ],
  PrepaidExpiryEmail: [
    PrepaidExpiryEmail,
    {
      recipientName: "Test",
      clientName: "Kunde",
      packageName: "Pakke",
      remainingHours: "4",
      expiryDate: "1. dec. 2026",
      daysUntilExpiry: 7,
    },
  ],
  PrepaidLowBalanceEmail: [
    PrepaidLowBalanceEmail,
    {
      recipientName: "Test",
      clientName: "Kunde",
      packageName: "Pakke",
      remainingHours: "1",
      totalHours: "10",
      percentageRemaining: 10,
    },
  ],
  ProjectBudgetAlertEmail: [
    ProjectBudgetAlertEmail,
    {
      recipientName: "Test",
      projectName: "Projekt",
      clientName: "Kunde",
      monthLabel: "oktober 2026",
      usedHours: "40",
      budgetHours: "50",
      percentage: 80,
      level: 80,
      projectUrl: url,
    },
  ],
  SignupPasswordEmail: [
    SignupPasswordEmail,
    { userName: "Test", password: "kodeord-123" },
  ],
  TaskNotificationEmail_daily: [
    TaskNotificationEmail,
    {
      kind: "daily_digest",
      name: "Test",
      dateLabel: "mandag",
      tasksToday: [{ title: "Opgave", deadline: "i dag", priority: "urgent" }],
      overdueCount: 2,
      completedYesterday: 1,
      tasksUrl: url,
    },
  ],
  TaskNotificationEmail_weekly: [
    TaskNotificationEmail,
    {
      kind: "weekly_review",
      name: "Test",
      tasksCompleted: 3,
      hoursTracked: 12,
      tasksCreated: 4,
      dashboardUrl: url,
    },
  ],
  TaskNotificationEmail_general: [
    TaskNotificationEmail,
    { kind: "general", name: "Test", message: "Besked", url },
  ],
  TimesheetNotificationEmail: [
    TimesheetNotificationEmail,
    {
      recipientName: "Test",
      heading: "Overskrift",
      bodyLines: ["Linje"],
      ctaLabel: "Åbn",
      ctaUrl: url,
    },
  ],
  TrialEndingEmail: [
    TrialEndingEmail,
    { userName: "Test", daysRemaining: 3, upgradeUrl: url },
  ],
  TwoFactorCodeEmail: [
    TwoFactorCodeEmail,
    { userName: "Test", code: "123456" },
  ],
  UnbilledReminderEmail: [
    UnbilledReminderEmail,
    {
      userName: "Test",
      totalUnbilledHours: 12.5,
      totalUnbilledValue: 8000,
      unbilledByClient: [{ name: "Kunde", hours: 12.5, value: 8000 }],
      frequency: "weekly",
    },
  ],
  VerificationEmail: [
    VerificationEmail,
    { name: "Test", verificationUrl: url },
  ],
  WeeklySummaryEmail: [
    WeeklySummaryEmail,
    {
      userName: "Test",
      weekNumber: 45,
      year: 2026,
      hoursThisWeek: 30,
      hoursLastWeek: 25,
      revenueThisWeek: 20000,
      revenueLastWeek: 15000,
      unbilledAmount: 5000,
      topClients: [{ name: "Kunde", hours: 10, revenue: 5000 }],
      daysTracked: 4,
    },
  ],
  WelcomeEmail: [WelcomeEmail, { userName: "Test" }],
};

const html = (name: string, extra: Record<string, unknown> = {}) => {
  const [Component, props] = FIXTURES[name];
  return render(createElement(Component, { ...props, ...extra }));
};

describe("mails til en TimeWren-konto", () => {
  const timewren = mailBrandFor("timewren");

  for (const name of Object.keys(FIXTURES)) {
    for (const locale of ["en", "da", "de", "es"]) {
      it(`${name} (${locale}) nævner hverken TimeTrack eller timetrack.dk`, async () => {
        const out = await html(name, { mailBrand: timewren, locale });
        expect(out).not.toMatch(/timetrack/i);
        expect(out).toContain("TimeWren");
      });
    }
  }
});

describe("mails til en TimeTrack-konto er uændrede", () => {
  for (const name of Object.keys(FIXTURES)) {
    it(`${name}`, async () => {
      // Afsenderne giver ingen mailBrand for timetrack-konti
      // (recipientMailBrand("timetrack") === undefined).
      expect(await html(name, { locale: "da" })).toMatchSnapshot();
    });
  }
});

describe("drip-mails viser brandets supportadresse (samme som replyTo)", () => {
  for (const name of ["DripWelcomeEmail", "DripNeedHelpEmail"]) {
    it(`${name} med mailBrand`, async () => {
      const mb = mailBrandFor("timetrack");
      const mailBrand = {
        ...mb,
        brand: { ...mb.brand, contactEmail: "anna@example.com" },
      };
      const out = await html(name, { mailBrand, locale: "da" });
      expect(out).toContain(mb.brand.supportEmail);
      expect(out).not.toContain("anna@example.com");
    });
  }
});
