import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getT } from "@/i18n/server";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { logOrgAudit } from "@/lib/org-audit";
import { resolveActiveOrgId } from "./active-org";
import type { McpOAuthDeps } from "./mcp-oauth";

/** auth-oversætteren med løse nøgler (getT kender ikke navneområdets nøgler). */
async function authT() {
  return (await getT("auth")) as unknown as (
    key: string,
    values?: Record<string, string>,
  ) => string;
}

/**
 * Fejltekst (i brugerens sprog) hvis organisationens plan ikke må bruge MCP, ellers null.
 * Samme abonnementsopslag som tRPC's abonnementsvagt (`resolvePlanTier`):
 * aktiv, prøveperiode og betalingsfrist er ok; Gratis, udløbet og intet
 * abonnement afvises. Admins har ingen plangrænser.
 */
export async function mcpPlanDenial(
  userId: string,
  orgId: string,
): Promise<string | null> {
  // Lazy import: trpc.ts trækker hele middleware-laget med, som auth.ts ikke
  // skal indlæse ved opstart.
  const { resolvePlanTier } = await import("@/lib/trpc/trpc");
  try {
    const tier = await resolvePlanTier({
      db,
      session: { user: { id: userId } },
      orgId,
    });
    if (tier !== "free") return null;
    // Gratis-orgen (inkl. opsagte betalere, der lander på Gratis).
    return (await authT())("oauth.paidPlanRequired");
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      return (await authT())("oauth.activePlanRequired", {
        message: err.message,
      });
    }
    throw err;
  }
}

/** Brugeren er (stadig) medlem af organisationen. */
export async function isOrgMember(
  userId: string,
  orgId: string,
): Promise<boolean> {
  const row = await db.query.members.findFirst({
    where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
    columns: { id: true },
  });
  return Boolean(row);
}

export const mcpOAuthDeps: McpOAuthDeps = {
  resolveOrgForSession: (userId, session) =>
    resolveActiveOrgId({ db, userId, session }),
  planDenial: mcpPlanDenial,
  audit: (orgId, userId, action, metadata) =>
    logOrgAudit(db, orgId, userId, action, { metadata }),
};
