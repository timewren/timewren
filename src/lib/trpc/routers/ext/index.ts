import { router } from "../../trpc";
import { extClientsRouter, extProjectsRouter } from "./clients-projects";
import { extCvrRouter } from "./cvr";
import { extDeviceAuthRouter } from "./device";
import { extEntitlementsRouter } from "./entitlements";
import { extEntriesRouter } from "./entries";
import { extImportRouter } from "./import";
import { extIntegrationsRouter } from "./integrations";
import { extInvoicesRouter } from "./invoices";
import { extKlippekortRouter } from "./klippekort";
import { extOrgRouter } from "./org";
import { extPatternsRouter } from "./patterns";
import { extReportsRouter } from "./reports";
import { extRulesRouter, extSiteMappingsRouter } from "./rules";
import { extCompanyRouter, extUserRouter } from "./settings";
import { extTasksRouter } from "./tasks";
import { extTimerRouter } from "./timer";

/**
 * Token-API'et til desktop 1.0, udvidelsen og mobilen. Samles under
 * `extension`-namespacet (D9: samme API som browserudvidelsen), som
 * under-namespaces, så de ikke kan kollidere med de eksisterende flade
 * `extension.*`-procedurer. Se device-procedure.ts for auth og grænser.
 */
export const extDeviceRouter = router({
  device: extDeviceAuthRouter,
  entitlements: extEntitlementsRouter,
  clients: extClientsRouter,
  cvr: extCvrRouter,
  projects: extProjectsRouter,
  entries: extEntriesRouter,
  import: extImportRouter,
  tasks: extTasksRouter,
  invoices: extInvoicesRouter,
  klippekort: extKlippekortRouter,
  reports: extReportsRouter,
  rules: extRulesRouter,
  patterns: extPatternsRouter,
  siteMappings: extSiteMappingsRouter,
  timer: extTimerRouter,
  integrations: extIntegrationsRouter,
  user: extUserRouter,
  company: extCompanyRouter,
  org: extOrgRouter,
});
