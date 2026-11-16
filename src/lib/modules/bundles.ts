import { sql } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import { organizationModules } from "@/lib/db/schema";
import { invalidateOrgModules } from "./cache";
import {
  CORE_BUNDLE,
  ENTERPRISE_BUNDLE,
  FREELANCE_BUNDLE,
  MODULE_KEYS,
  type ModuleKey,
} from "./constants";

type Db = typeof defaultDb;

export type OrgType = "freelance" | "enterprise" | undefined;

export function bundleFor(type: OrgType): readonly ModuleKey[] {
  return type === "enterprise" ? ENTERPRISE_BUNDLE : FREELANCE_BUNDLE;
}

/**
 * Upserts module rows for an organization. Idempotent — re-running with
 * the same bundle is a no-op beyond updating the `updatedAt` timestamp.
 *
 * Modules NOT in the bundle are left untouched (not set unavailable).
 */
export async function applyBundle(
  db: Db,
  organizationId: string,
  modules: readonly ModuleKey[],
  updatedBy?: string,
): Promise<void> {
  if (modules.length === 0) return;
  const now = new Date();
  const rows = modules.map((moduleKey) => ({
    id: crypto.randomUUID(),
    organizationId,
    moduleKey,
    isAvailable: true,
    isEnabled: true,
    availableAt: now,
    enabledAt: now,
    updatedAt: now,
    updatedBy: updatedBy ?? null,
  }));

  await db
    .insert(organizationModules)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        organizationModules.organizationId,
        organizationModules.moduleKey,
      ],
      set: {
        isAvailable: sql`true`,
        isEnabled: sql`true`,
        availableAt: sql`coalesce(${organizationModules.availableAt}, excluded.available_at)`,
        enabledAt: sql`coalesce(${organizationModules.enabledAt}, excluded.enabled_at)`,
        updatedAt: now,
        updatedBy: updatedBy ?? null,
      },
    });
  await invalidateOrgModules(organizationId);
}

/**
 * Seeder modul-rækker for en HELT NY org (opt-in-model). Alle modul-nøgler
 * oprettes; kun `CORE_BUNDLE` er `isEnabled`. Øvrige moduler er tilgængelige
 * men slukkede, så ejeren selv kan tænde dem i touren / under Indstillinger.
 *
 * `enterprise` er tilgængeligt men slukket, ligesom de øvrige moduler: en
 * org-admin tænder det selv under Indstillinger. Billing, plan og brand
 * afgør aldrig tilgængeligheden (#1035).
 *
 * Idempotent: ved konflikt (org allerede seedet) gøres intet.
 */
export async function seedNewOrgModules(
  db: Db,
  organizationId: string,
  opts: { updatedBy?: string } = {},
): Promise<void> {
  const now = new Date();

  const rows = MODULE_KEYS.map((moduleKey) => {
    const isEnabled = CORE_BUNDLE.includes(moduleKey);
    return {
      id: crypto.randomUUID(),
      organizationId,
      moduleKey,
      isAvailable: true,
      isEnabled,
      availableAt: now,
      enabledAt: isEnabled ? now : null,
      updatedAt: now,
      updatedBy: opts.updatedBy ?? null,
    };
  });

  await db
    .insert(organizationModules)
    .values(rows)
    .onConflictDoNothing({
      target: [
        organizationModules.organizationId,
        organizationModules.moduleKey,
      ],
    });
  await invalidateOrgModules(organizationId);
}
