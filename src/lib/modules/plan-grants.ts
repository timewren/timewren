import { isNull, or, sql } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import { organizationModules } from "@/lib/db/schema";
import { ensureDefaultAbsenceTypes } from "@/lib/enterprise/absence-defaults";
import { invalidateOrgModules } from "./cache";

type Db = typeof defaultDb;

/** Planer der automatisk giver enterprise-modulet (ferie, fravær, flex …). */
const ENTERPRISE_GRANTING_TIERS: readonly string[] = ["business"];

export function tierGrantsEnterprise(tier: string | null | undefined): boolean {
  return !!tier && ENTERPRISE_GRANTING_TIERS.includes(tier);
}

/**
 * Virksomhed-planen ("business") giver enterprise-modulet automatisk.
 *
 * Grant-on-write, aldrig automatisk fjernelse: kaldes hvor en subscriptions
 * planTier sættes/ændres. Andre tiers er en no-op — en nedgradering fjerner
 * IKKE modulet, og manuelt tændte orgs (fx demo-orgs) røres ikke.
 *
 * Idempotent: rækken gøres tilgængelig + tændt, medmindre modulet allerede er
 * tilgængeligt og HAR været tændt (enabledAt sat) — så respekteres en ejer der
 * bevidst har slukket det. Ved en faktisk tildeling seedes standard-
 * fraværstyperne (#435, også idempotent).
 *
 * Returnerer true når modulet blev tildelt/tændt ved dette kald.
 */
export async function grantEnterpriseForTier(
  db: Db,
  orgId: string | null | undefined,
  tier: string | null | undefined,
): Promise<boolean> {
  if (!orgId || !tierGrantsEnterprise(tier)) return false;

  const now = new Date();
  const granted = await db
    .insert(organizationModules)
    .values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      moduleKey: "enterprise",
      isAvailable: true,
      isEnabled: true,
      availableAt: now,
      enabledAt: now,
      updatedAt: now,
      updatedBy: null,
    })
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
      },
      setWhere: or(
        sql`${organizationModules.isAvailable} = false`,
        isNull(organizationModules.enabledAt),
      ),
    })
    .returning({ id: organizationModules.id });

  if (granted.length === 0) return false;

  await invalidateOrgModules(orgId);
  await ensureDefaultAbsenceTypes(db, orgId);
  return true;
}

/**
 * Best-effort-variant til billing-flows: en fejl i modul-seeding må aldrig
 * vælte et abonnements-flow (webhook, onboarding, cron). Logger og sluger.
 */
export async function grantEnterpriseForTierSafe(
  db: Db,
  orgId: string | null | undefined,
  tier: string | null | undefined,
  source: string,
): Promise<void> {
  try {
    const granted = await grantEnterpriseForTier(db, orgId, tier);
    if (granted) {
      console.warn(
        `[plan-grants] enterprise tildelt org ${orgId} (tier ${tier}, ${source})`,
      );
    }
  } catch (err) {
    console.error(
      `[plan-grants] kunne ikke tildele enterprise til org ${orgId} (tier ${tier}, ${source}):`,
      err,
    );
  }
}
