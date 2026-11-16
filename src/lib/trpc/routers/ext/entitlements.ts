import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { MODULE_KEYS, type ModuleKey } from "@/lib/modules/constants";
import {
  type AccessLevel,
  PERMISSION_MODULE_KEYS,
  type PermissionModuleKey,
  resolveModuleAccess,
} from "@/lib/permissions/role-access";
import { router } from "../../trpc";
import {
  makePermissiveModules,
  resolveModules,
} from "../enterprise/middleware";
import { deviceProcedure } from "./device-procedure";

/**
 * Hvad brugeren må i den valgte org — så klienten kan vise låste funktioner
 * i stedet for at lade kaldene fejle. Serveren håndhæver uanset hvad (alle
 * token-kald går gennem web's procedurer); dette er kun visning.
 */
export const extEntitlementsRouter = router({
  get: deviceProcedure.query(async ({ ctx }) => {
    const { orgId, userId } = ctx.device;
    const [details, { role }] = await Promise.all([
      ctx.web.subscription.getDetails(),
      ctx.web.rolePermissions.getMyRole(),
    ]);

    const modulesCtx = orgId
      ? await resolveModules(ctx.db, orgId)
      : makePermissiveModules();
    const modules = Object.fromEntries(
      MODULE_KEYS.map((key) => [key, modulesCtx.isEnabled(key)]),
    ) as Record<ModuleKey, boolean>;

    const access = Object.fromEntries(
      await Promise.all(
        PERMISSION_MODULE_KEYS.map(
          async (key) =>
            [
              key,
              orgId
                ? await resolveModuleAccess(ctx.db, userId, orgId, key)
                : "write",
            ] as const,
        ),
      ),
    ) as Record<PermissionModuleKey, AccessLevel>;

    // Samme tier-regel som subscribedProcedure: Gratis/opsagt → "free".
    const tier = details ? (details.isFree ? "free" : details.planTier) : null;
    // Uden billing (selvhost) findes ingen plan: alt er åbent
    const hasSubscription = !!details || !isBillingEnabled();
    const canWrite =
      hasSubscription && !details?.memberLocked && !details?.isTrialExpired;
    const writable = (key: PermissionModuleKey, module: ModuleKey) =>
      canWrite && modules[module] && access[key] === "write";

    return {
      organizationId: orgId,
      role,
      plan: details
        ? {
            tier,
            name: details.planName,
            status: details.status,
            isFree: details.isFree,
            isTrial: details.status === "trialing",
            trialEndsAt: details.trialEndsAt,
            isTrialExpired: details.isTrialExpired,
            memberLocked: details.memberLocked,
          }
        : null,
      limits: details?.limits ?? null,
      usage: details?.usage ?? null,
      modules,
      access,
      /** Kan brugeren skrive i området lige nu? (plan + modul + rolle) */
      features: {
        timeTracking: canWrite && access.time === "write",
        clients: writable("clients", "clients"),
        canAddActiveClient:
          writable("clients", "clients") &&
          (details?.limits.maxActiveClients == null ||
            details.usage.activeClients < details.limits.maxActiveClients),
        projects: writable("projects", "projects"),
        tasks: writable("tasks", "tasks"),
        invoices: writable("invoices", "invoicing"),
        klippekort: writable("klippekort", "klippekort"),
        reports: modules.reports && access.reports !== "none",
      },
    };
  }),
});
