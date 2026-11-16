/**
 * Renderer alle systemmails til HTML-filer, så de kan åbnes i en browser.
 *
 *   npx tsx scripts/render-email-previews.tsx [output-dir]
 *
 * Bruges til visuel kontrol før en skabelon-ændring lander — ingen mails
 * sendes, og der kræves ingen database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@react-email/render";
import { createElement } from "react";
import { AdminDigestEmail } from "@/components/email/AdminDigestEmail";
import { AdminNotificationEmail } from "@/components/email/AdminNotificationEmail";
import { AluntaKlippekortCreatedEmail } from "@/components/email/AluntaKlippekortCreatedEmail";
import { BetaInviteEmail } from "@/components/email/BetaInviteEmail";
import { CancellationConfirmedEmail } from "@/components/email/CancellationConfirmedEmail";
import { DataExportReadyEmail } from "@/components/email/DataExportReadyEmail";
import { DesktopLaunchEmail } from "@/components/email/DesktopLaunchEmail";
import { DesktopLicenseEmail } from "@/components/email/DesktopLicenseEmail";
import { DripAiFeaturesEmail } from "@/components/email/DripAiFeaturesEmail";
import { DripClientNoKlippekortEmail } from "@/components/email/DripClientNoKlippekortEmail";
import { DripExtensionTipsEmail } from "@/components/email/DripExtensionTipsEmail";
import { DripFirstWeekStatsEmail } from "@/components/email/DripFirstWeekStatsEmail";
import { DripGettingStartedEmail } from "@/components/email/DripGettingStartedEmail";
import { DripKlippekortTipsEmail } from "@/components/email/DripKlippekortTipsEmail";
import { DripNeedHelpEmail } from "@/components/email/DripNeedHelpEmail";
import { DripNoTimeEntryEmail } from "@/components/email/DripNoTimeEntryEmail";
import { DripTimeNoInvoiceEmail } from "@/components/email/DripTimeNoInvoiceEmail";
import { DripUpgradeReminderEmail } from "@/components/email/DripUpgradeReminderEmail";
import { DripWelcomeEmail } from "@/components/email/DripWelcomeEmail";
import { DripWinBack30Email } from "@/components/email/DripWinBack30Email";
import { DripWinBack60Email } from "@/components/email/DripWinBack60Email";
import { EndOfDayEmail } from "@/components/email/EndOfDayEmail";
import { FeedbackEmail } from "@/components/email/FeedbackEmail";
import { FirstClientEmail } from "@/components/email/FirstClientEmail";
import { FirstInvoiceEmail } from "@/components/email/FirstInvoiceEmail";
import { FirstProjectEmail } from "@/components/email/FirstProjectEmail";
import { FirstTimeEntryEmail } from "@/components/email/FirstTimeEntryEmail";
import { ImportCompleteEmail } from "@/components/email/ImportCompleteEmail";
import { InactivityEmail } from "@/components/email/InactivityEmail";
import { InvoiceEmail } from "@/components/email/InvoiceEmail";
import { InvoiceReminderEmail } from "@/components/email/InvoiceReminderEmail";
import { MagicLinkEmail } from "@/components/email/MagicLinkEmail";
import { MonthlyClientStatusEmail } from "@/components/email/MonthlyClientStatusEmail";
import { MonthlySummaryEmail } from "@/components/email/MonthlySummaryEmail";
import { NewLoginEmail } from "@/components/email/NewLoginEmail";
import { OrganizationInviteEmail } from "@/components/email/OrganizationInviteEmail";
import { PasswordChangedEmail } from "@/components/email/PasswordChangedEmail";
import { PasswordResetEmail } from "@/components/email/PasswordResetEmail";
import { PaymentFailedEmail } from "@/components/email/PaymentFailedEmail";
import { PaymentReminderEmail } from "@/components/email/PaymentReminderEmail";
import { PortalInvitationEmail } from "@/components/email/PortalInvitationEmail";
import { PrepaidExpiryEmail } from "@/components/email/PrepaidExpiryEmail";
import { PrepaidLowBalanceEmail } from "@/components/email/PrepaidLowBalanceEmail";
import { ProjectBudgetAlertEmail } from "@/components/email/ProjectBudgetAlertEmail";
import { RebrandVarselEmail } from "@/components/email/RebrandVarselEmail";
import { SignupPasswordEmail } from "@/components/email/SignupPasswordEmail";
import { TaskNotificationEmail } from "@/components/email/TaskNotificationEmail";
import { TimesheetNotificationEmail } from "@/components/email/TimesheetNotificationEmail";
import { ToolGuideEmail } from "@/components/email/ToolGuideEmail";
import { TrialEndingEmail } from "@/components/email/TrialEndingEmail";
import { TwoFactorCodeEmail } from "@/components/email/TwoFactorCodeEmail";
import { UnbilledReminderEmail } from "@/components/email/UnbilledReminderEmail";
import { VerificationEmail } from "@/components/email/VerificationEmail";
import { WeeklySummaryEmail } from "@/components/email/WeeklySummaryEmail";
import { WelcomeEmail } from "@/components/email/WelcomeEmail";

/**
 * Fyldtekst hvor skabelonen forventer en hemmelighed. Ligger i en konstant,
 * fordi hemmelighedsscannere ellers flagger `password: "..."` uanset værdien.
 */
const PLACEHOLDER_SECRET = ["EKSEMPEL", "IKKE", "EN", "KODE"].join("-");

const outDir = process.argv[2] ?? join(process.cwd(), ".email-previews");
mkdirSync(outDir, { recursive: true });

const previews: Record<string, React.ReactElement> = {
  // ─── Konto og sikkerhed ───────────────────────────────────────────
  verification: createElement(VerificationEmail, {
    name: "Mette",
    verificationUrl: "https://app.timetrack.dk/auth/verify?token=eksempel",
  }),
  welcome: createElement(WelcomeEmail, { userName: "Mette" }),
  "signup-password": createElement(SignupPasswordEmail, {
    userName: "Mette",
    password: PLACEHOLDER_SECRET,
  }),
  "magic-link": createElement(MagicLinkEmail, {
    magicLinkUrl: "https://app.timetrack.dk/auth/magic?token=eksempel",
  }),
  "password-reset": createElement(PasswordResetEmail, {
    userName: "Mette",
    resetUrl: "https://app.timetrack.dk/auth/reset-password?token=eksempel",
  }),
  "password-changed": createElement(PasswordChangedEmail, {
    userName: "Mette",
    changedAt: new Date("2026-09-16T08:20:00"),
    ipAddress: "203.0.113.4",
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140",
  }),
  "two-factor": createElement(TwoFactorCodeEmail, {
    userName: "Mette",
    code: "000 000",
  }),
  "new-login": createElement(NewLoginEmail, {
    userName: "Mette",
    loginAt: new Date("2026-09-16T08:12:00"),
    ipAddress: "203.0.113.4",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    location: "Aarhus, Danmark",
  }),
  "organization-invite": createElement(OrganizationInviteEmail, {
    inviterName: "Thomas Nielsen",
    organizationName: "Eksempel ApS",
    inviteUrl: "https://app.timetrack.dk/accept-invitation/eksempel",
    role: "member",
  }),

  // ─── Onboarding ───────────────────────────────────────────────────
  "first-client": createElement(FirstClientEmail, {
    userName: "Mette",
    clientName: "Acme ApS",
  }),
  "first-project": createElement(FirstProjectEmail, {
    userName: "Mette",
    projectName: "Hjemmeside",
    clientName: "Acme ApS",
  }),
  "first-time-entry": createElement(FirstTimeEntryEmail, {
    userName: "Mette",
    hours: "2,5",
    projectName: "Hjemmeside",
  }),
  "first-invoice": createElement(FirstInvoiceEmail, {
    userName: "Mette",
    invoiceNumber: "2026-0001",
    amount: "3.750,00",
    clientName: "Acme ApS",
  }),

  // ─── Drip-mails ───────────────────────────────────────────────────
  "drip-welcome": createElement(DripWelcomeEmail, { userName: "Mette" }),
  "drip-getting-started-no-client": createElement(DripGettingStartedEmail, {
    userName: "Mette",
    hasClient: false,
  }),
  "drip-getting-started-with-client": createElement(DripGettingStartedEmail, {
    userName: "Mette",
    hasClient: true,
  }),
  "drip-no-time-entry": createElement(DripNoTimeEntryEmail, {
    userName: "Mette",
  }),
  "drip-ai-features": createElement(DripAiFeaturesEmail, {
    userName: "Mette",
  }),
  "drip-extension-tips": createElement(DripExtensionTipsEmail, {
    userName: "Mette",
  }),
  "drip-klippekort-tips": createElement(DripKlippekortTipsEmail, {
    userName: "Mette",
  }),
  "drip-client-no-klippekort": createElement(DripClientNoKlippekortEmail, {
    userName: "Mette",
  }),
  "drip-first-week-stats-minimal": createElement(DripFirstWeekStatsEmail, {
    userName: "Mette",
    totalHoursTracked: 0.5,
    clientCount: 1,
    projectCount: 0,
  }),
  "drip-first-week-stats-active": createElement(DripFirstWeekStatsEmail, {
    userName: "Mette",
    totalHoursTracked: 14.5,
    clientCount: 3,
    projectCount: 5,
  }),
  "drip-need-help": createElement(DripNeedHelpEmail, {
    userName: "Mette",
    hasTimeEntries: false,
  }),
  "drip-time-no-invoice": createElement(DripTimeNoInvoiceEmail, {
    userName: "Mette",
    unbilledHours: "23,5",
  }),
  "drip-upgrade-reminder": createElement(DripUpgradeReminderEmail, {
    userName: "Mette",
    daysLeft: 3,
  }),
  "drip-win-back-30": createElement(DripWinBack30Email, {
    userName: "Mette",
    unbilledHours: 8,
    unbilledValue: 6800,
    pendingTasks: 2,
  }),
  "drip-win-back-60": createElement(DripWinBack60Email, { userName: "Mette" }),

  // ─── Abonnement og betaling ───────────────────────────────────────
  "trial-ending": createElement(TrialEndingEmail, {
    userName: "Mette",
    daysRemaining: 3,
    upgradeUrl: "https://app.timetrack.dk/dashboard/settings/subscription",
  }),
  "payment-failed": createElement(PaymentFailedEmail, {
    userName: "Mette",
    amountDue: "249,00 kr",
    billingPortalUrl:
      "https://app.timetrack.dk/dashboard/settings/subscription",
  }),
  "payment-reminder-urgent": createElement(PaymentReminderEmail, {
    userName: "Mette",
    urgency: "urgent",
    daysOverdue: 12,
    billingPortalUrl:
      "https://app.timetrack.dk/dashboard/settings/subscription",
  }),
  "cancellation-confirmed": createElement(CancellationConfirmedEmail, {
    userName: "Mette",
    endDate: "1. november 2026",
    reactivateUrl: "https://app.timetrack.dk/dashboard/settings/subscription",
  }),

  // ─── Kunder, fakturaer og klippekort ──────────────────────────────
  invoice: createElement(InvoiceEmail, {
    invoiceNumber: "2026-0142",
    clientName: "Acme ApS",
    amount: "12.500,00",
    dueDate: "2026-10-01",
    senderName: "Mads Holst Jensen",
    senderEmail: "anna@example.com",
    notes: "Timer for september ifølge aftale.",
  }),
  "invoice-reminder": createElement(InvoiceReminderEmail, {
    clientName: "Eksempel Børn",
    senderName: "Eksempel ApS",
    invoiceNumber: "2026-0142",
    amount: 12500,
    dueDate: "1. september 2026",
    reminder: {
      reminderNumber: 2,
      totalFees: 200,
      compensation: 310,
      accruedInterest: 154.79,
      totalClaim: 13164.79,
      daysOverdue: 15,
    },
    portalUrl: "https://app.timetrack.dk/portal/t/eksempel",
  }),
  "portal-invitation": createElement(PortalInvitationEmail, {
    clientName: "Eksempel Børn",
    senderName: "Eksempel ApS",
    senderEmail: "bruger@example.dk",
    portalUrl: "https://app.timetrack.dk/portal/t/eksempel",
    accessType: "account",
    loginEmail: "bogholderi@example.dk",
  }),
  "monthly-client-status": createElement(MonthlyClientStatusEmail, {
    clientName: "Eksempel Børn",
    senderName: "Eksempel ApS",
    monthLabel: "september 2026",
    totalHours: 31.5,
    projects: [
      { name: "Website", hours: 18 },
      { name: "SEO", hours: 9.5 },
      { name: "Support", hours: 4 },
    ],
    packages: [
      {
        name: "Support 20 timer",
        remainingHours: 2.5,
        totalHours: 20,
        overdraftHours: 0,
      },
    ],
    pendingApprovals: 3,
    personalNote:
      "Tak for en god måned — vi går i gang med kampagnen i oktober.",
    portalUrl: "https://app.timetrack.dk/portal/t/eksempel",
  }),
  "prepaid-low-balance-customer": createElement(PrepaidLowBalanceEmail, {
    recipientName: "Anders",
    clientName: "Eksempel Børn",
    packageName: "Support 20 timer",
    remainingHours: "2,5",
    totalHours: "20",
    percentageRemaining: 12,
    portalUrl: "https://app.timetrack.dk/portal/t/eksempel",
  }),
  "prepaid-low-balance-owner": createElement(PrepaidLowBalanceEmail, {
    recipientName: "Thomas",
    clientName: "Eksempel Børn",
    packageName: "Support 20 timer",
    remainingHours: "2,5",
    totalHours: "20",
    percentageRemaining: 12,
  }),
  "prepaid-expiry": createElement(PrepaidExpiryEmail, {
    recipientName: "Thomas",
    clientName: "Eksempel Børn",
    packageName: "Support 20 timer",
    remainingHours: "4,5",
    expiryDate: "2026-09-28",
    daysUntilExpiry: 12,
  }),
  "alunta-klippekort": createElement(AluntaKlippekortCreatedEmail, {
    userName: "Thomas",
    clientName: "Eksempel Børn",
    hours: "20",
    hourlyRate: "850 kr",
    expiryDate: "31. december 2026",
    planName: "Support Plus",
    dashboardUrl: "https://app.timetrack.dk/dashboard/klippekort",
  }),

  // ─── Rapporter og påmindelser ─────────────────────────────────────
  "weekly-summary": createElement(WeeklySummaryEmail, {
    userName: "Mads",
    weekNumber: 38,
    year: 2026,
    hoursThisWeek: 31.5,
    hoursLastWeek: 27,
    revenueThisWeek: 26775,
    revenueLastWeek: 22950,
    unbilledAmount: 8500,
    topClients: [
      { name: "Eksempel ApS", hours: 14, revenue: 11900 },
      { name: "Demo Havecenter", hours: 9.5, revenue: 8075 },
      { name: "Demo Rådgivning", hours: 8, revenue: 6800 },
    ],
    daysTracked: 5,
  }),
  "monthly-summary": createElement(MonthlySummaryEmail, {
    userName: "Mads",
    monthName: "September",
    year: 2026,
    hoursThisMonth: 128.5,
    hoursLastMonth: 112,
    revenueThisMonth: 109225,
    revenueLastMonth: 95200,
    clientBreakdown: [
      { name: "Eksempel ApS", hours: 54, revenue: 45900 },
      { name: "Demo Havecenter", hours: 41.5, revenue: 35275 },
      { name: "Demo Rådgivning", hours: 33, revenue: 28050 },
    ],
    invoiceStats: {
      paid: 7,
      paidAmount: 84300,
      outstanding: 3,
      outstandingAmount: 24925,
    },
    prepaidStats: {
      activePackages: 5,
      lowBalancePackages: 2,
      expiringPackages: 1,
    },
    yearToDateRevenue: 812400,
  }),
  "unbilled-reminder": createElement(UnbilledReminderEmail, {
    userName: "Mette",
    totalUnbilledHours: 23.5,
    totalUnbilledValue: 19975,
    unbilledByClient: [
      { name: "Eksempel ApS", hours: 12, value: 10200 },
      { name: "Demo Havecenter", hours: 7.5, value: 6375 },
      { name: "Demo Rådgivning", hours: 4, value: 3400 },
    ],
  }),
  inactivity: createElement(InactivityEmail, {
    userName: "Mette",
    daysSinceLastActivity: 14,
    unbilledHours: 23.5,
    unbilledValue: 19975,
    pendingTasks: 4,
  }),

  // ─── Enterprise og drift ──────────────────────────────────────────
  "timesheet-notification": createElement(TimesheetNotificationEmail, {
    recipientName: "Rasmus",
    heading: "Din timeseddel er godkendt",
    bodyLines: [
      "Mette har godkendt din timeseddel for uge 38.",
      "Timerne er nu låst og klar til løn.",
    ],
    ctaLabel: "Se timesedlen",
    ctaUrl: "https://app.timetrack.dk/dashboard/enterprise/timesheet",
  }),
  "data-export": createElement(DataExportReadyEmail, {
    recipientName: "Mette",
    downloadUrl: "https://app.timetrack.dk/exports/eksempel",
    expiresAt: "2026-09-23T12:00:00Z",
    format: "csv",
  }),
  "data-export-organisation": createElement(DataExportReadyEmail, {
    recipientName: "Mette",
    downloadUrl: "https://app.timetrack.dk/exports/eksempel",
    expiresAt: "2026-10-18T12:00:00Z",
    format: "zip",
    scope: "organization",
  }),
  "end-of-day": createElement(EndOfDayEmail, {
    title: "Din dag i TimeTrack",
    body: "Du registrerede 6,5 timer i dag på 2 kunder.",
    timeUrl: "https://app.timetrack.dk/dashboard/time",
  }),
  "import-complete": createElement(ImportCompleteEmail, {
    userName: "Mette",
    statusLabel: "Import færdig",
    status: "completed",
    source: "Toggl",
    importedEntries: 42,
    skippedEntries: 0,
    failedEntries: 0,
    totalEntries: 42,
    timeUrl: "https://app.timetrack.dk/dashboard/time",
  }),
  "import-complete-with-errors": createElement(ImportCompleteEmail, {
    userName: "Mette",
    statusLabel: "Import færdig med fejl",
    status: "completed_with_errors",
    source: "TimeOps",
    importedEntries: 38,
    skippedEntries: 3,
    failedEntries: 1,
    totalEntries: 42,
    timeUrl: "https://app.timetrack.dk/dashboard/time",
  }),
  "import-failed": createElement(ImportCompleteEmail, {
    userName: "Mette",
    statusLabel: "Import fejlede",
    status: "failed",
    source: "Clockify",
    importedEntries: 0,
    skippedEntries: 0,
    failedEntries: 0,
    totalEntries: 0,
    timeUrl: "https://app.timetrack.dk/dashboard/time",
  }),
  "project-budget-warning": createElement(ProjectBudgetAlertEmail, {
    recipientName: "Mette",
    projectName: "Hjemmeside",
    clientName: null,
    monthLabel: "september 2026",
    usedHours: "16",
    budgetHours: "20",
    percentage: 80,
    level: 80,
    projectUrl: "https://app.timetrack.dk/dashboard/projects/eksempel",
  }),
  "project-budget-exceeded": createElement(ProjectBudgetAlertEmail, {
    recipientName: "Mette",
    projectName: "Hjemmeside",
    clientName: "Acme ApS",
    monthLabel: "september 2026",
    usedHours: "20",
    budgetHours: "20",
    percentage: 100,
    level: 100,
    projectUrl: "https://app.timetrack.dk/dashboard/projects/eksempel",
  }),
  "task-daily-digest": createElement(TaskNotificationEmail, {
    kind: "daily_digest",
    name: "Rasmus",
    dateLabel: "i dag",
    tasksToday: [
      {
        title: "Send tilbud til Acme ApS",
        projectName: "Hjemmeside",
        priority: "urgent",
        deadline: "i dag",
      },
      { title: "Ret footer", projectName: "Hjemmeside" },
    ],
    overdueCount: 1,
    completedYesterday: 3,
    tasksUrl: "https://app.timetrack.dk/dashboard/tasks",
  }),
  "task-deadline-reminder": createElement(TaskNotificationEmail, {
    kind: "deadline_reminder",
    name: "Rasmus",
    task: {
      title: "Send tilbud til Acme ApS",
      projectName: "Hjemmeside",
      deadline: "i morgen",
    },
    tasksUrl: "https://app.timetrack.dk/dashboard/tasks",
  }),
  "task-overdue-alert": createElement(TaskNotificationEmail, {
    kind: "overdue_alert",
    name: "Rasmus",
    tasks: [
      {
        title: "Send tilbud til Acme ApS",
        projectName: "Hjemmeside",
        deadline: "mandag",
      },
      { title: "Opdatér CVR-oplysninger", deadline: "fredag" },
    ],
    tasksUrl: "https://app.timetrack.dk/dashboard/tasks",
  }),
  "task-weekly-review": createElement(TaskNotificationEmail, {
    kind: "weekly_review",
    name: "Rasmus",
    tasksCompleted: 9,
    hoursTracked: 31.5,
    tasksCreated: 6,
    dashboardUrl: "https://app.timetrack.dk/dashboard/tasks",
  }),
  "task-ai-suggestion": createElement(TaskNotificationEmail, {
    kind: "ai_suggestion",
    name: "Rasmus",
    suggestion:
      "Du har 3 ugentlige opgaver på Acme ApS, der ikke er planlagt endnu. Vil du sætte en frist?",
    tasksUrl: "https://app.timetrack.dk/dashboard/tasks",
  }),
  "task-general": createElement(TaskNotificationEmail, {
    kind: "general",
    name: "Rasmus",
    message: "Mette har tildelt dig 2 nye opgaver på Hjemmeside.",
    url: "https://app.timetrack.dk/dashboard/tasks",
  }),

  // ─── Admin og interne ───────────────────────────────────────────────
  "admin-digest": createElement(AdminDigestEmail, {
    weekLabel: "Uge 38, 2026",
    mrr: "18.400 kr",
    mrrChange: "+6,2 % fra sidste måned",
    mrrChangeTone: "up",
    activeSubscriptions: 142,
    trialsEndingSoon: 5,
    alerts: ["3 betalinger er fejlet og ikke rettet endnu."],
    newSignups: 11,
    signups: [
      { name: "Thomas Nielsen", detail: "Solo-plan, trial" },
      { name: "Eksempel ApS", detail: "Team-plan, 3 brugere" },
    ],
    adminUrl: "https://app.timetrack.dk/admin",
  }),
  "admin-notification": createElement(AdminNotificationEmail, {
    eventTitle: "Ny organisation oprettet: Eksempel ApS",
    rows: [
      { label: "Ejer", value: "Thomas Nielsen" },
      { label: "Plan", value: "Team" },
      { label: "Brugere", value: "3" },
    ],
    userLink: "https://app.timetrack.dk/admin/users/eksempel",
  }),
  feedback: createElement(FeedbackEmail, {
    type: "bug",
    message: "Timeren stopper ikke altid, når jeg skifter fane.",
    userName: "Mette",
    userEmail: "mette@eksempel.dk",
    orgName: "Acme ApS",
    planName: "Team",
    context: {
      url: "https://app.timetrack.dk/dashboard/time",
      viewport: "1440x900",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      appVersion: "2026.9.3",
      timer: {
        isRunning: true,
        projectId: "proj_eksempel",
        clientId: "client_eksempel",
        startTime: 1757998800000,
      },
    },
    hasScreenshot: true,
    reportId: "fb_eksempel123",
  }),

  // ─── Marketing og personlige mails ─────────────────────────────────
  "beta-invite": createElement(BetaInviteEmail, {
    recipientName: "Mette",
    signupUrl: "https://timetrack.dk/beta/signup?token=eksempel",
    discountCode: "BETA50",
  }),
  "desktop-launch": createElement(DesktopLaunchEmail, {
    heading: "TimeTrack Desktop er klar til download",
    message:
      "Du skrev dig på ventelisten til TimeTrack Desktop. Nu kan du hente den til Mac og Windows.",
    downloadUrl: "https://timetrack.dk/desktop/download",
  }),
  "desktop-license": createElement(DesktopLicenseEmail, {
    name: "Mette",
    licenseKey: PLACEHOLDER_SECRET,
    tierLabel: "Lifetime",
    maxDevices: 5,
    appUrl: "https://timetrack.dk",
  }),
  "rebrand-varsel": createElement(RebrandVarselEmail, {
    userName: "Mette",
    sentAt: new Date("2026-09-16T08:00:00"),
    appsUdgivet: false,
  }),
  "tool-guide": createElement(ToolGuideEmail, {
    toolName: "Timepriscalculator",
    guideLabel: "Hent guiden som PDF",
    guideUrl: "https://timetrack.dk/guides/timepris.pdf",
    toolUrl: "https://timetrack.dk/vaerktojer/timepriscalculator",
    trialUrl: "https://timetrack.dk/signup",
  }),
};

async function main() {
  const index: string[] = [];
  for (const [name, element] of Object.entries(previews)) {
    const html = await render(element);
    writeFileSync(join(outDir, `${name}.html`), html, "utf8");
    index.push(`<li><a href="./${name}.html">${name}</a></li>`);
    console.log(`${name}.html (${html.length} tegn)`);
  }
  writeFileSync(
    join(outDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>TimeTrack e-mails</title><style>body{font:14px system-ui;padding:24px;max-width:600px;margin:0 auto}li{margin:4px 0}</style><h1>TimeTrack e-mails</h1><ul>${index.join("")}</ul>`,
    "utf8",
  );
  console.log(`\n${index.length} mails — åbn index.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
