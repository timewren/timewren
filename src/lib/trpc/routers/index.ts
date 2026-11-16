import type { inferRouterOutputs } from "@trpc/server";
import { guardedRouter } from "../module-guard";
import { mergeRouters, router } from "../trpc";
import { activityRouter } from "./activity";
import { adminRouter } from "./admin";
import { aiRouter } from "./ai";
import { aluntaKlippekortRouter } from "./aluntaKlippekort";
import { apiKeysRouter } from "./apiKeys";
import { approvalRequestsRouter } from "./approvalRequests";
import { betaSignupRouter } from "./betaSignup";
import { broadcastsRouter } from "./broadcasts";
import { calendarRouter } from "./calendar";
import { cashflowRouter } from "./cashflow";
import { changelogRouter } from "./changelog";
import { clientAccessRouter } from "./clientAccess";
import { clientPortalAccessRouter } from "./clientPortalAccess";
import { clientsRouter } from "./clients";
import { connectedAppsRouter } from "./connectedApps";
import { contactRouter } from "./contact";
import { coverageRouter } from "./coverage";
import { dashboardRouter } from "./dashboard";
import { dataExportRouter } from "./dataExport";
import { dayOffRouter } from "./day-off";
import { desktopRouter } from "./desktop";
import { dpaRouter } from "./dpa";
import { emailActivityRouter } from "./emailActivity";
import { emailAnalyticsRouter } from "./emailAnalytics";
import { emailForwardingRouter } from "./emailForwarding";
import { emailIntegrationRouter } from "./emailIntegration";
import { emailMetricsRouter } from "./emailMetrics";
import { emailTasksRouter } from "./emailTasks";
import { emailTemplatesRouter } from "./emailTemplates";
import { enterpriseRouter } from "./enterprise";
import { extDeviceRouter } from "./ext";
import { extensionRouter } from "./extension";
import { feedbackRouter } from "./feedback";
import { foundingTierRouter } from "./foundingTier";
import { helpFeedbackRouter } from "./helpFeedback";
import { importsRouter } from "./imports";
import { integrationsRouter } from "./integrations";
import { invoicesRouter } from "./invoices";
import { invoiceTemplatesRouter } from "./invoiceTemplates";
import { logbookRouter } from "./logbook";
import { marketingRouter } from "./marketing";
import { memberRatesRouter } from "./memberRates";
import { mobileRouter } from "./mobile";
import { notificationsRouter } from "./notifications";
import { nudgesRouter } from "./nudges";
import { onboardingRouter } from "./onboarding";
import { orgAuditRouter } from "./orgAudit";
import { organizationRouter } from "./organization";
import { plausibleRouter } from "./plausible";
import { portalBrandingRouter } from "./portalBranding";
import { prepaidRouter } from "./prepaid";
import { projectsRouter } from "./projects";
import { publicPortalRouter } from "./publicPortal";
import { quickSignupRouter } from "./quickSignup";
import { rateHistoryRouter } from "./rateHistory";
import { recurringRouter } from "./recurring";
import { recurringInvoicesRouter } from "./recurringInvoices";
import { reportsRouter } from "./reports";
import { reportTemplatesRouter } from "./reportTemplates";
import { resourcePlanRouter } from "./resourcePlan";
import { roadmapRouter } from "./roadmap";
import { rolePermissionsRouter } from "./rolePermissions";
import { scheduledRatesRouter } from "./scheduledRates";
import { searchRouter } from "./search";
import { securityRouter } from "./security";
import { storeBillingRouter } from "./storeBilling";
import { subscriptionRouter } from "./subscription";
import { tagsRouter } from "./tags";
import { taskCommentsRouter } from "./taskComments";
import { taskStatusesRouter } from "./taskStatuses";
import { tasksRouter } from "./tasks";
import { teamRouter } from "./team";
import { timeRouter } from "./time";
import { timerSyncRouter } from "./timerSync";
import { timerTemplatesRouter } from "./timerTemplates";
import { userRouter } from "./user";
import { vatRouter } from "./vat";
import { webhooksRouter } from "./webhooks";

export const appRouter = router({
  activity: activityRouter,
  aluntaKlippekort: guardedRouter("klippekort", aluntaKlippekortRouter),
  apiKeys: guardedRouter("public_api", apiKeysRouter),
  cashflow: cashflowRouter,
  admin: adminRouter,
  ai: aiRouter,
  betaSignup: betaSignupRouter,
  broadcasts: broadcastsRouter,
  quickSignup: quickSignupRouter,
  calendar: calendarRouter,
  changelog: changelogRouter,
  connectedApps: connectedAppsRouter,
  contact: contactRouter,
  clientAccess: clientAccessRouter,
  approvalRequests: approvalRequestsRouter,
  clients: guardedRouter("clients", clientsRouter),
  clientPortalAccess: guardedRouter("clients", clientPortalAccessRouter),
  coverage: coverageRouter,
  dayOff: dayOffRouter,
  // Fuld org-/persondataeksport må ikke afhænge af rapport-modulet: en ejer,
  // der slår rapporter fra, må ikke tage medlemmernes eksport med.
  dataExport: guardedRouter("reports", dataExportRouter, {
    except: [
      "getExportFlags",
      "requestOrgExport",
      "listOrgExports",
      "requestUserExport",
      "listUserExports",
      "listExportRequests",
      "cancelExportRequest",
    ],
  }),
  dashboard: dashboardRouter,
  desktop: desktopRouter,
  // Databehandleraftale for alle planer, ikke bag et modul
  dpa: dpaRouter,
  emailActivity: emailActivityRouter,
  emailAnalytics: emailAnalyticsRouter,
  emailForwarding: emailForwardingRouter,
  emailIntegration: emailIntegrationRouter,
  emailMetrics: emailMetricsRouter,
  emailTasks: emailTasksRouter,
  emailTemplates: emailTemplatesRouter,
  enterprise: guardedRouter("enterprise", enterpriseRouter),
  // Token-procedurer: de eksisterende (flade) + desktop-API'et (ext/*).
  extension: guardedRouter(
    "browser_extension",
    mergeRouters(extensionRouter, extDeviceRouter),
  ),
  feedback: feedbackRouter,
  foundingTier: foundingTierRouter,
  helpFeedback: helpFeedbackRouter,
  imports: importsRouter,
  marketing: marketingRouter,
  projects: guardedRouter("projects", projectsRouter),
  time: timeRouter,
  prepaid: guardedRouter("klippekort", prepaidRouter),
  tags: tagsRouter,
  tasks: guardedRouter("tasks", tasksRouter),
  taskComments: guardedRouter("tasks", taskCommentsRouter),
  taskStatuses: guardedRouter("tasks", taskStatusesRouter),
  logbook: logbookRouter,
  team: teamRouter,
  user: userRouter,
  invoices: guardedRouter("invoicing", invoicesRouter),
  invoiceTemplates: guardedRouter("invoicing", invoiceTemplatesRouter),
  memberRates: memberRatesRouter,
  mobile: mobileRouter,
  notifications: notificationsRouter,
  nudges: nudgesRouter,
  portalBranding: portalBrandingRouter,
  publicPortal: publicPortalRouter,
  recurring: guardedRouter("invoicing", recurringRouter),
  recurringInvoices: guardedRouter("invoicing", recurringInvoicesRouter),
  reports: guardedRouter("reports", reportsRouter),
  resourcePlan: resourcePlanRouter,
  reportTemplates: guardedRouter("reports", reportTemplatesRouter),
  rolePermissions: rolePermissionsRouter,
  roadmap: roadmapRouter,
  integrations: guardedRouter("integrations", integrationsRouter),
  rateHistory: rateHistoryRouter,
  scheduledRates: scheduledRatesRouter,
  onboarding: onboardingRouter,
  orgAudit: orgAuditRouter,
  organization: organizationRouter,
  plausible: plausibleRouter,
  timerTemplates: timerTemplatesRouter,
  timerSync: timerSyncRouter,
  search: searchRouter,
  security: securityRouter,
  subscription: subscriptionRouter,
  storeBilling: storeBillingRouter,
  vat: vatRouter,
  webhooks: webhooksRouter,
});

export type AppRouter = typeof appRouter;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
