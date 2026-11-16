import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { st } from "@/i18n/sync-text";
import type * as schema from "@/lib/db/schema";
import { members } from "@/lib/db/schema";

export type OrgRole = "owner" | "admin" | "member";

export async function getOrgRole(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  orgId: string,
): Promise<OrgRole | null> {
  const membership = await db.query.members.findFirst({
    where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
    columns: { role: true },
  });
  return (membership?.role as OrgRole) ?? null;
}

export function assertMinRole(actual: OrgRole | null, required: OrgRole): void {
  const hierarchy: Record<OrgRole, number> = {
    member: 0,
    admin: 1,
    owner: 2,
  };
  const level = hierarchy[actual as OrgRole];
  if (!actual || level === undefined || level < hierarchy[required]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: st("errors.insufficientRights"),
    });
  }
}
