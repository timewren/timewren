/**
 * Opdigtede eksempeldata til preview af alle mailskabeloner (ingen
 * kundedata). Bruges af mail-previews.preview.tsx.
 */
import { createElement, type ReactElement } from "react";
import { AluntaKlippekortCreatedEmail } from "@/components/email/AluntaKlippekortCreatedEmail";
import { BetaInviteEmail } from "@/components/email/BetaInviteEmail";
import { CancellationConfirmedEmail } from "@/components/email/CancellationConfirmedEmail";
import { DataExportReadyEmail } from "@/components/email/DataExportReadyEmail";
import { DesktopLaunchEmail } from "@/components/email/DesktopLaunchEmail";
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
import { TrialEndingEmail } from "@/components/email/TrialEndingEmail";
import { TwoFactorCodeEmail } from "@/components/email/TwoFactorCodeEmail";
import { UnbilledReminderEmail } from "@/components/email/UnbilledReminderEmail";
import { WeeklySummaryEmail } from "@/components/email/WeeklySummaryEmail";
import { WelcomeEmail } from "@/components/email/WelcomeEmail";

const APP = "https://timetrack.dk";
const UNSUB = `${APP}/api/unsubscribe?token=eksempel`;
const NAME = "Mette";
const KUNDE = "Bageriet på hjørnet";

export const MAIL_FIXTURES: { id: string; element: ReactElement }[] = [
  {
    id: "AluntaKlippekortCreated",
    element: (
      <AluntaKlippekortCreatedEmail
        userName={NAME}
        clientName={KUNDE}
        hours="20"
        hourlyRate="650"
        expiryDate="31. december 2026"
        planName="Klippekort 20 t"
        dashboardUrl={`${APP}/dashboard/prepaid`}
      />
    ),
  },
  {
    id: "BetaInvite",
    element: (
      <BetaInviteEmail
        recipientName={NAME}
        signupUrl={`${APP}/signup`}
        discountCode="BETA2026"
      />
    ),
  },
  {
    id: "CancellationConfirmed",
    element: (
      <CancellationConfirmedEmail
        userName={NAME}
        endDate="31. oktober 2026"
        reactivateUrl={`${APP}/dashboard/settings/billing`}
      />
    ),
  },
  {
    id: "DataExportReady",
    element: (
      <DataExportReadyEmail
        recipientName={NAME}
        downloadUrl={`${APP}/api/export/eksempel`}
        expiresAt="18. oktober 2026"
        format="ZIP (JSON + CSV)"
      />
    ),
  },
  {
    id: "DataExportReadyOrg",
    element: (
      <DataExportReadyEmail
        recipientName={NAME}
        downloadUrl={`${APP}/api/export/eksempel`}
        expiresAt="2026-10-18T10:00:00.000Z"
        format="zip"
        scope="organization"
      />
    ),
  },
  {
    id: "DripAiFeatures",
    element: <DripAiFeaturesEmail userName={NAME} />,
  },
  {
    id: "DripClientNoKlippekort",
    element: (
      <DripClientNoKlippekortEmail userName={NAME} unsubscribeUrl={UNSUB} />
    ),
  },
  {
    id: "DripExtensionTips",
    element: <DripExtensionTipsEmail userName={NAME} />,
  },
  {
    id: "DripFirstWeekStats",
    element: (
      <DripFirstWeekStatsEmail
        userName={NAME}
        totalHoursTracked={12.5}
        clientCount={3}
        projectCount={4}
      />
    ),
  },
  {
    id: "DripGettingStarted",
    element: <DripGettingStartedEmail userName={NAME} hasClient={false} />,
  },
  {
    id: "DripKlippekortTips",
    element: <DripKlippekortTipsEmail userName={NAME} />,
  },
  {
    id: "DripNeedHelp",
    element: <DripNeedHelpEmail userName={NAME} hasTimeEntries={false} />,
  },
  {
    id: "DripNoTimeEntry",
    element: <DripNoTimeEntryEmail userName={NAME} unsubscribeUrl={UNSUB} />,
  },
  {
    id: "DripTimeNoInvoice",
    element: (
      <DripTimeNoInvoiceEmail
        userName={NAME}
        unsubscribeUrl={UNSUB}
        unbilledHours="14,5"
      />
    ),
  },
  {
    id: "DripUpgradeReminder",
    element: <DripUpgradeReminderEmail userName={NAME} daysLeft={3} />,
  },
  { id: "DripWelcome", element: <DripWelcomeEmail userName={NAME} /> },
  {
    id: "DripWinBack30",
    element: (
      <DripWinBack30Email
        userName={NAME}
        unbilledHours={6.5}
        unbilledValue={4225}
        pendingTasks={2}
      />
    ),
  },
  { id: "DripWinBack60", element: <DripWinBack60Email userName={NAME} /> },
  {
    id: "Feedback",
    element: (
      <FeedbackEmail
        type="feature"
        message="Det ville være rart at kunne eksportere klippekort til CSV."
        userName="Testbruger"
        userEmail="test@example.com"
        orgName="Eksempel ApS"
        planName="Selvstændig"
        context={{
          url: `${APP}/dashboard/prepaid`,
          viewport: "1440x900",
          userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0",
          appVersion: "0.30.0",
        }}
        hasScreenshot={false}
      />
    ),
  },
  {
    id: "FirstClient",
    element: <FirstClientEmail userName={NAME} clientName={KUNDE} />,
  },
  {
    id: "FirstInvoice",
    element: (
      <FirstInvoiceEmail
        userName={NAME}
        invoiceNumber="2026-0042"
        amount="8.125,00 kr."
        clientName={KUNDE}
      />
    ),
  },
  {
    id: "FirstProject",
    element: (
      <FirstProjectEmail
        userName={NAME}
        projectName="Ny hjemmeside"
        clientName={KUNDE}
      />
    ),
  },
  {
    id: "FirstTimeEntry",
    element: (
      <FirstTimeEntryEmail
        userName={NAME}
        hours="2 t 15 min"
        projectName="Ny hjemmeside"
      />
    ),
  },
  {
    id: "Inactivity",
    element: (
      <InactivityEmail
        userName={NAME}
        daysSinceLastActivity={21}
        unbilledHours={6.5}
        unbilledValue={4225}
        pendingTasks={2}
      />
    ),
  },
  {
    id: "Invoice",
    element: (
      <InvoiceEmail
        invoiceNumber="2026-0042"
        clientName={KUNDE}
        amount="8.125,00 kr."
        dueDate="25. oktober 2026"
        senderName="Eksempel Design"
        senderEmail="faktura@example.com"
        notes="Tak for samarbejdet i september."
      />
    ),
  },
  {
    id: "InvoiceReminder",
    element: (
      <InvoiceReminderEmail
        clientName={KUNDE}
        senderName="Eksempel Design"
        invoiceNumber="2026-0042"
        amount={8125}
        dueDate="25.10.2026"
        reminder={null}
        portalUrl={`${APP}/portal`}
      />
    ),
  },
  {
    id: "MagicLink",
    element: <MagicLinkEmail magicLinkUrl={`${APP}/api/auth/magic?x=1`} />,
  },
  {
    id: "MonthlyClientStatus",
    element: (
      <MonthlyClientStatusEmail
        clientName={KUNDE}
        senderName="Eksempel Design"
        monthLabel="september 2026"
        totalHours={13}
        projects={[
          { name: "Ny hjemmeside", hours: 9.5 },
          { name: "Support", hours: 3.5 },
        ]}
        packages={[
          {
            name: "Klippekort 20 t",
            remainingHours: 7,
            totalHours: 20,
            overdraftHours: 0,
          },
        ]}
        pendingApprovals={1}
        portalUrl={`${APP}/portal`}
      />
    ),
  },
  {
    id: "MonthlySummary",
    element: (
      <MonthlySummaryEmail
        userName={NAME}
        monthName="september"
        year={2026}
        hoursThisMonth={86.5}
        hoursLastMonth={79}
        revenueThisMonth={56225}
        revenueLastMonth={51350}
        clientBreakdown={[
          { name: KUNDE, hours: 40, revenue: 26000 },
          { name: "Cykelværkstedet", hours: 26.5, revenue: 17225 },
        ]}
        invoiceStats={{
          paid: 4,
          paidAmount: 41000,
          outstanding: 1,
          outstandingAmount: 8125,
        }}
        prepaidStats={{
          activePackages: 3,
          lowBalancePackages: 1,
          expiringPackages: 0,
        }}
        yearToDateRevenue={412300}
      />
    ),
  },
  {
    id: "NewLogin",
    element: (
      <NewLoginEmail
        userName={NAME}
        loginAt={new Date("2026-10-05T07:42:00Z")}
        ipAddress="192.0.2.10"
        userAgent="Mozilla/5.0 (Windows NT 10.0) Chrome/129.0"
      />
    ),
  },
  {
    id: "OrganizationInvite",
    element: createElement(OrganizationInviteEmail, {
      inviterName: "Anders",
      organizationName: "Eksempel Bureau ApS",
      inviteUrl: `${APP}/auth/accept-invitation?id=x`,
      role: "member",
    }),
  },
  {
    id: "PasswordChanged",
    element: (
      <PasswordChangedEmail
        userName={NAME}
        changedAt={new Date("2026-10-05T07:42:00Z")}
        ipAddress="192.0.2.10"
        userAgent="Mozilla/5.0 (Macintosh) Safari/17"
      />
    ),
  },
  {
    id: "PasswordReset",
    element: (
      <PasswordResetEmail
        userName={NAME}
        resetUrl={`${APP}/auth/reset?token=x`}
      />
    ),
  },
  {
    id: "PaymentFailed",
    element: (
      <PaymentFailedEmail
        userName={NAME}
        amountDue="98,75 kr."
        billingPortalUrl={`${APP}/dashboard/settings/billing`}
      />
    ),
  },
  {
    id: "PaymentReminder",
    element: (
      <PaymentReminderEmail
        userName={NAME}
        urgency="warning"
        daysOverdue={5}
        billingPortalUrl={`${APP}/dashboard/settings/billing`}
      />
    ),
  },
  {
    id: "PortalInvitation",
    element: (
      <PortalInvitationEmail
        clientName={KUNDE}
        senderName="Eksempel Design"
        senderEmail="kontakt@example.com"
        portalUrl={`${APP}/portal/login`}
        accessType="account"
        loginEmail="kunde@example.com"
      />
    ),
  },
  {
    id: "PrepaidExpiry",
    element: (
      <PrepaidExpiryEmail
        recipientName={NAME}
        clientName={KUNDE}
        packageName="Klippekort 20 t"
        remainingHours="7"
        expiryDate="31. oktober 2026"
        daysUntilExpiry={14}
      />
    ),
  },
  {
    id: "PrepaidLowBalance",
    element: (
      <PrepaidLowBalanceEmail
        recipientName={NAME}
        clientName={KUNDE}
        packageName="Klippekort 20 t"
        remainingHours="3,5"
        totalHours="20"
        percentageRemaining={17.5}
      />
    ),
  },
  {
    id: "PrepaidLowBalanceClient",
    element: (
      <PrepaidLowBalanceEmail
        recipientName={KUNDE}
        clientName={KUNDE}
        packageName="Klippekort 20 t"
        remainingHours="7"
        totalHours="20"
        percentageRemaining={35}
        recipient="client"
        senderName="Eksempel Design"
        senderEmail="kontakt@example.com"
        portalUrl={`${APP}/portal`}
      />
    ),
  },
  {
    id: "ProjectBudgetAlert",
    element: (
      <ProjectBudgetAlertEmail
        recipientName={NAME}
        projectName="Ny hjemmeside"
        clientName={KUNDE}
        monthLabel="oktober 2026"
        usedHours="32"
        budgetHours="40"
        percentage={80}
        level={80}
        projectUrl={`${APP}/dashboard/projects/x`}
      />
    ),
  },
  {
    id: "SignupPassword",
    element: <SignupPasswordEmail userName={NAME} password="eksempel-1234" />,
  },
  {
    id: "TimesheetNotification",
    element: (
      <TimesheetNotificationEmail
        recipientName={NAME}
        heading="Din timeseddel er godkendt"
        bodyLines={["Uge 40 er godkendt af Anders."]}
        highlight="37 t 30 min"
        ctaLabel="Se timesedlen"
        ctaUrl={`${APP}/dashboard/timesheets`}
      />
    ),
  },
  {
    id: "TrialEnding",
    element: (
      <TrialEndingEmail
        userName={NAME}
        daysRemaining={3}
        upgradeUrl={`${APP}/dashboard/settings/billing`}
      />
    ),
  },
  {
    id: "TwoFactorCode",
    element: <TwoFactorCodeEmail userName={NAME} code="482913" />,
  },
  {
    id: "UnbilledReminder",
    element: (
      <UnbilledReminderEmail
        userName={NAME}
        totalUnbilledHours={14.5}
        totalUnbilledValue={9425}
        unbilledByClient={[
          { name: KUNDE, hours: 9, value: 5850 },
          { name: "Cykelværkstedet", hours: 5.5, value: 3575 },
        ]}
      />
    ),
  },
  {
    id: "WeeklySummary",
    element: (
      <WeeklySummaryEmail
        userName={NAME}
        weekNumber={40}
        year={2026}
        hoursThisWeek={31.5}
        hoursLastWeek={28}
        revenueThisWeek={20475}
        revenueLastWeek={18200}
        unbilledAmount={9425}
        topClients={[
          { name: KUNDE, hours: 14, revenue: 9100 },
          { name: "Cykelværkstedet", hours: 9.5, revenue: 6175 },
        ]}
        daysTracked={5}
      />
    ),
  },
  { id: "Welcome", element: <WelcomeEmail userName={NAME} /> },
  {
    id: "EndOfDay",
    element: (
      <EndOfDayEmail
        title="Dagsoversigt: 6 t 15 min registreret"
        body="Du har registreret 6 t 15 min i dag. 2 t 30 min er ikke faktureret."
        timeUrl={`${APP}/dashboard/time`}
      />
    ),
  },
  {
    id: "DesktopLaunch",
    element: (
      <DesktopLaunchEmail
        heading="TimeTrack Desktop er klar"
        message="Tak, fordi du skrev dig på ventelisten. TimeTrack Desktop kan hentes nu."
        downloadUrl={`${APP}/desktop`}
      />
    ),
  },
  {
    id: "TaskOverdue",
    element: (
      <TaskNotificationEmail
        kind="overdue_alert"
        name={NAME}
        tasks={[
          {
            title: "Send tilbud",
            deadline: "10. oktober",
            projectName: "Ny hjemmeside",
          },
        ]}
        tasksUrl={`${APP}/dashboard/tasks`}
      />
    ),
  },
  {
    // Udkast: varsling af vilkår/DPA 1.1 + rebrand (docs/brand/udkast/)
    id: "RebrandVarsel",
    element: (
      <RebrandVarselEmail
        userName={NAME}
        sentAt={new Date("2026-10-20T08:00:00+02:00")}
      />
    ),
  },
];
