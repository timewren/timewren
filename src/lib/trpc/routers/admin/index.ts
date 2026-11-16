import { mergeRouters, router } from "../../trpc";
import { adminAnalyticsRouter } from "./analytics";
import { adminBillingRouter } from "./billing";
import { adminDesktopRouter } from "./desktop";
import { adminFeaturesRouter } from "./features";
import { adminFinanceRouter } from "./finance";
import { adminGdprRouter } from "./gdpr";
import { adminModerationRouter } from "./moderation";
import { adminMonitoringRouter } from "./monitoring";
import { adminNotificationsRouter } from "./notifications";
import { adminOrganizationModulesRouter } from "./organizationModules";
import { adminProspectsRouter } from "./prospects";
import { adminSearchRouter } from "./search";
import { adminSecurityRouter } from "./security";
import { adminStabilityRouter } from "./stability";
import { adminSupportRouter } from "./support";
import { adminSupportTemplatesRouter } from "./supportTemplates";
import { adminTimerEventsRouter } from "./timerEvents";
import { adminUsersRouter } from "./users";
import { adminWebhooksRouter } from "./webhooks";

const adminFlatRouter = mergeRouters(
  adminUsersRouter,
  adminBillingRouter,
  adminModerationRouter,
  adminAnalyticsRouter,
  adminMonitoringRouter,
  adminFinanceRouter,
  adminFeaturesRouter,
  adminNotificationsRouter,
  adminSupportRouter,
  adminTimerEventsRouter,
);

export const adminRouter = mergeRouters(
  adminFlatRouter,
  router({
    organizationModules: adminOrganizationModulesRouter,
    search: adminSearchRouter,
    webhooks: adminWebhooksRouter,
    gdpr: adminGdprRouter,
    security: adminSecurityRouter,
    prospects: adminProspectsRouter,
    supportTemplates: adminSupportTemplatesRouter,
    desktop: adminDesktopRouter,
    stability: adminStabilityRouter,
  }),
);
