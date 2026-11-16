import { router } from "../../trpc";
import { clientsRouter } from "../clients";
import { integrationsRouter } from "../integrations";
import { invoicesRouter } from "../invoices";
import { prepaidRouter } from "../prepaid";
import { projectsRouter } from "../projects";
import { reportsRouter } from "../reports";
import { rolePermissionsRouter } from "../rolePermissions";
import { subscriptionRouter } from "../subscription";
import { taskStatusesRouter } from "../taskStatuses";
import { tasksRouter } from "../tasks";
import { timeRouter } from "../time";

/**
 * KUN til typer: det udsnit af appRouter, token-procedurerne kalder. Selve
 * kaldene går altid til den rigtige appRouter (createWebCaller), hvor
 * routerne er pakket i guardedRouter — denne router kaldes aldrig, så
 * modul-vagten kan ikke omgås via den. Typen kan ikke tages fra AppRouter,
 * fordi AppRouter selv indeholder token-procedurerne (cirkulær type).
 */
export const webRouterShape = router({
  clients: clientsRouter,
  integrations: integrationsRouter,
  invoices: invoicesRouter,
  prepaid: prepaidRouter,
  projects: projectsRouter,
  reports: reportsRouter,
  rolePermissions: rolePermissionsRouter,
  subscription: subscriptionRouter,
  taskStatuses: taskStatusesRouter,
  tasks: tasksRouter,
  time: timeRouter,
});
