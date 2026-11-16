// src/lib/permissions/server.ts
//
// Server-side permission resolution that needs DB access.

import type { db as defaultDb } from "@/lib/db";
import { getOrgRole } from "@/lib/trpc/middleware/org-role";

type Db = typeof defaultDb;

/**
 * Whether the user may see every member's time entries in the org (lists,
 * reports, entry detail). Owners and admins may; plain members see only their
 * own. Solo users (no org) always may. Mutating other members' time stays
 * owner-only — see resolveTimeOwnershipFilter.
 */
export async function canViewAllOrgTime(
  db: Db,
  orgId: string | null,
  userId: string,
): Promise<boolean> {
  if (!orgId) return true;
  const role = await getOrgRole(db, userId, orgId);
  return role === "owner" || role === "admin";
}
