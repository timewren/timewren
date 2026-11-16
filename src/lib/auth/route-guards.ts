/**
 * Adgangsvagt til Next.js-route handlers, der skal svare som tRPC's
 * `isAuthed` + `requireModuleAccess` (se src/lib/trpc/trpc.ts).
 *
 * Uden aktiv organisation afvises kaldet i stedet for at falde tilbage til
 * brugerens egne rækker: ellers kan et fjernet medlem stadig nå data fra den
 * organisation, det ikke længere er medlem af. Derefter skal organisationen
 * have modulet slået til (som `guardedRouter` i src/lib/trpc/module-guard.ts),
 * og til sidst kræves rollens adgangsniveau til modulet.
 */

import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import { orglessForbiddenMessage } from "@/lib/auth/orgless";
import { db } from "@/lib/db";
import type { ModuleKey } from "@/lib/modules/constants";
import {
  accessSatisfies,
  type PermissionModuleKey,
  resolveModuleAccess,
} from "@/lib/permissions/role-access";
import { resolveModules } from "@/lib/trpc/routers/enterprise/middleware";

export type RouteGuardResult =
  | { ok: true; userId: string; orgId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requireInvoiceRouteAccess(input: {
  headers: Headers;
  moduleKey: PermissionModuleKey;
  /** Org-modulet, der skal være slået til (tRPC: `guardedRouter`). */
  featureModule: ModuleKey;
  required: "read" | "write";
}): Promise<RouteGuardResult> {
  const session = await auth.api.getSession({ headers: input.headers });
  if (!session?.user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const userId = session.user.id;

  const orgId = await resolveActiveOrgId({
    db,
    userId,
    session: session as unknown as Record<string, unknown>,
  });
  if (!orgId) {
    return { ok: false, status: 403, error: orglessForbiddenMessage() };
  }

  const modules = await resolveModules(db, orgId);
  if (!modules.isEnabled(input.featureModule)) {
    return {
      ok: false,
      status: 403,
      error: await tr("serverErrors", "core.moduleDisabled", {
        module: input.featureModule,
      }),
    };
  }

  const level = await resolveModuleAccess(db, userId, orgId, input.moduleKey);
  if (!accessSatisfies(level, input.required)) {
    return {
      ok: false,
      status: 403,
      error: await tr("serverErrors", "core.roleNoAccess"),
    };
  }

  return { ok: true, userId, orgId };
}
