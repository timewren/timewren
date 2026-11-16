import { createHash } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  hashOAuthToken,
  mcpResourceUrl,
  OAUTH_TOKEN_PREFIX,
} from "@/lib/auth/mcp-oauth";
import { isOrgMember, mcpPlanDenial } from "@/lib/auth/mcp-oauth-access";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { shouldRecordKeyUse } from "./last-used";

/**
 * verifyToken for the MCP endpoint. Accepts two kinds of Bearer tokens:
 *
 * - `tk_live_` API keys: mirrors the REST Bearer-key validation (hash, look
 *   up, reject revoked/expired keys) — unchanged.
 * - `tt_at_` OAuth access tokens (#912): issued by the oauth-provider plugin
 *   and bound to one organization on the consent screen.
 *
 * Returns an AuthInfo whose `extra` carries the resolved userId + orgId so
 * each tool can build a scoped tRPC caller. Returns undefined for any invalid
 * token (the adapter then responds 401).
 */
export async function verifyMcpToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (bearerToken?.startsWith(OAUTH_TOKEN_PREFIX.opaqueAccessToken)) {
    return verifyOAuthAccessToken(bearerToken);
  }
  if (!bearerToken?.startsWith("tk_live_")) return undefined;

  const keyHash = createHash("sha256").update(bearerToken).digest("hex");
  const keyRecord = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
  });

  if (!keyRecord || keyRecord.isRevoked) return undefined;
  if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) return undefined;

  // Fire-and-forget last-used update (don't block the request), throttlet
  // til én skrivning pr. interval (se last-used.ts).
  if (shouldRecordKeyUse(keyRecord)) {
    void db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyRecord.id))
      .catch(() => {});
  }

  return {
    token: bearerToken,
    clientId: keyRecord.id,
    scopes: keyRecord.scopes ?? [],
    extra: {
      userId: keyRecord.userId,
      organizationId: keyRecord.organizationId ?? undefined,
    },
  };
}

interface StoredAccessToken {
  clientId: string;
  userId?: string | null;
  referenceId?: string | null;
  resources?: string[] | null;
  scopes: string[];
  expiresAt?: Date | string | null;
  revoked?: Date | string | null;
}

/**
 * Opaque OAuth access token → AuthInfo. Fail closed: the token must be
 * unrevoked and unexpired, belong to an enabled client, carry a user and the
 * organization chosen at consent, be issued for this MCP resource (or no
 * explicit resource), and the user must still be a member of that org.
 *
 * A valid token whose org is not (or no longer) on a paying plan still
 * authenticates, but `extra.planDenied` carries the Danish reason so the
 * route answers 403 instead of 401 (re-authorizing would not help).
 */
async function verifyOAuthAccessToken(
  bearerToken: string,
): Promise<AuthInfo | undefined> {
  const raw = bearerToken.slice(OAUTH_TOKEN_PREFIX.opaqueAccessToken.length);
  if (!raw) return undefined;
  // Gennem better-auths adapter (samme lag som pluginet skriver med), så
  // modellen og kolonnerne altid matcher pluginets egne opslag.
  const { adapter } = await auth.$context;
  const row = await adapter.findOne<StoredAccessToken>({
    model: "oauthAccessToken",
    where: [{ field: "token", value: hashOAuthToken(raw) }],
  });
  if (!row || row.revoked) return undefined;
  const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return undefined;
  if (!row.userId || !row.referenceId) return undefined;
  const resources = row.resources ?? [];
  if (resources.length > 0 && !resources.includes(mcpResourceUrl())) {
    return undefined;
  }

  const client = await adapter.findOne<{ disabled?: boolean | null }>({
    model: "oauthClient",
    where: [{ field: "clientId", value: row.clientId }],
  });
  if (!client || client.disabled) return undefined;

  if (!(await isOrgMember(row.userId, row.referenceId))) return undefined;
  const planDenied = await mcpPlanDenial(row.userId, row.referenceId);

  return {
    token: bearerToken,
    clientId: row.clientId,
    scopes: row.scopes ?? [],
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
    resource: new URL(mcpResourceUrl()),
    extra: {
      userId: row.userId,
      organizationId: row.referenceId,
      authType: "oauth",
      ...(planDenied ? { planDenied } : {}),
    },
  };
}
