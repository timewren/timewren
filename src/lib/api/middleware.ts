import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextRequest, NextResponse } from "next/server";
import type { Session } from "@/lib/auth";
import { withoutOrgOverride } from "@/lib/auth/org-header";
import { isUserOnOtherBrand } from "@/lib/auth/request-brand";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { createRequestMemo } from "@/lib/trpc/request-memo";
import { appRouter } from "@/lib/trpc/routers/index";
import {
  getClientIp,
  ipRateLimitKey,
  RATE_LIMIT_CONFIGS,
  rateLimiter,
  userRateLimitKey,
} from "@/lib/utils/rate-limiter";
import {
  errorResponse,
  type RateLimitInfo,
  rateLimitResponse,
  withRateLimitHeaders,
} from "./http";
import { shouldRecordKeyUse } from "./last-used";
import { hasScope, type Resource } from "./scopes";

// ============================================
// Types
// ============================================

export interface ApiContext {
  userId: string;
  scopes: string[];
  apiKeyId: string;
  caller: ReturnType<typeof appRouter.createCaller>;
  rateLimit: RateLimitInfo;
}

// ============================================
// Authentication
// ============================================

/**
 * Authenticate a request using a Bearer API key.
 * Returns `{ context }` on success or `{ error: NextResponse }` on failure.
 */
export async function authenticateApiKey(
  request: NextRequest,
): Promise<{ context: ApiContext } | { error: NextResponse }> {
  // 1. Rate limit auth attempts by IP FIRST, before any token inspection.
  // This ensures malformed tokens, missing headers, and unknown keys all
  // count against the brute-force budget — otherwise attackers could spam
  // malformed requests unlimited to probe timing or exhaust resources.
  const clientIp = getClientIp(request.headers);
  const ipKey = ipRateLimitKey(clientIp, "api-auth");
  const ipLimit = await rateLimiter.check(ipKey, "apiAuth");

  if (!ipLimit.allowed) {
    return {
      error: rateLimitResponse(
        ipLimit.resetIn,
        RATE_LIMIT_CONFIGS.apiAuth.maxRequests,
        0,
      ),
    };
  }

  // 2. Check Authorization header presence + Bearer prefix
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: errorResponse(
        401,
        "UNAUTHORIZED",
        "Missing or invalid Authorization header",
      ),
    };
  }

  const token = authHeader.slice(7); // strip "Bearer "

  // 3. Validate token format
  if (!token.startsWith("tk_live_")) {
    return {
      error: errorResponse(401, "UNAUTHORIZED", "Invalid API key format"),
    };
  }

  // 4. Hash the token
  const keyHash = createHash("sha256").update(token).digest("hex");

  // 5. Look up key in database
  const keyRecord = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
  });

  // SECURITY: Return the same error for unknown, revoked, and expired keys
  // to avoid leaking whether a particular key hash exists in our database
  // or whether it was previously valid (oracle attack).
  if (!keyRecord || keyRecord.isRevoked) {
    return {
      error: errorResponse(401, "UNAUTHORIZED", "Invalid API key"),
    };
  }

  if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
    return {
      error: errorResponse(401, "UNAUTHORIZED", "Invalid API key"),
    };
  }

  // Multibrand: en nøgle gælder kun på kontoens eget brand (samme svar som en
  // ukendt nøgle). Uden host-auth-flagene en no-op.
  if (await isUserOnOtherBrand(keyRecord.userId, request.headers.get("host"))) {
    return {
      error: errorResponse(401, "UNAUTHORIZED", "Invalid API key"),
    };
  }

  // Gyldig nøgle: nulstil IP-brute-force-budgettet, så legitime kald aldrig
  // låses ude. Kun fejlede forsøg (som ikke når hertil) akkumulerer mod loftet.
  await rateLimiter.reset(ipKey);

  // Rate limit by user (API usage)
  const userKey = userRateLimitKey(keyRecord.userId, "api");
  const userLimit = await rateLimiter.check(userKey, "api");

  if (!userLimit.allowed) {
    return {
      error: rateLimitResponse(
        userLimit.resetIn,
        RATE_LIMIT_CONFIGS.api.maxRequests,
        0,
      ),
    };
  }

  // Fire-and-forget: update lastUsedAt and lastUsedIp (throttlet, se last-used.ts)
  if (shouldRecordKeyUse(keyRecord, clientIp)) {
    void db
      .update(apiKeys)
      .set({
        lastUsedAt: new Date(),
        lastUsedIp: clientIp,
      })
      .where(eq(apiKeys.id, keyRecord.id))
      .catch(() => {});
  }

  // Build tRPC caller — include activeOrganizationId so the isAuthed
  // middleware resolves org context without an extra membership lookup.
  // Fall back to membership lookup if apiKey.organizationId is not set
  // (pre-migration keys).
  const caller = appRouter.createCaller({
    session: {
      user: { id: keyRecord.userId },
      activeOrganizationId: keyRecord.organizationId ?? undefined,
      // API-nøgler har kun bruger-id og org; resten af Better-Auth-sessionen findes ikke.
    } as unknown as Session,
    db,
    // Org-override er kun for web-sessionens offline-kø — aldrig for nøgler.
    headers: withoutOrgOverride(request.headers),
    memo: createRequestMemo(),
  });

  const rateLimitReset = Math.ceil((Date.now() + userLimit.resetIn) / 1000);

  return {
    context: {
      userId: keyRecord.userId,
      scopes: keyRecord.scopes,
      apiKeyId: keyRecord.id,
      caller,
      rateLimit: {
        limit: RATE_LIMIT_CONFIGS.api.maxRequests,
        remaining: userLimit.remaining,
        reset: rateLimitReset,
      },
    },
  };
}

// ============================================
// Scope Checking
// ============================================

/**
 * Check if the API context has the required scope.
 * Returns a NextResponse error if access is denied, or null if allowed.
 */
export function requireScope(
  ctx: ApiContext,
  resource: Resource,
  permission: "read" | "write",
): NextResponse | null {
  if (!hasScope(ctx.scopes, resource, permission)) {
    const response = errorResponse(
      403,
      "FORBIDDEN",
      `Missing required scope: ${resource}:${permission}`,
    );
    // Attach rate limit headers so clients can track quota even on 403
    return withRateLimitHeaders(response, ctx.rateLimit);
  }
  return null;
}

// ============================================
// Re-eksport af de rene HTTP-hjælpere
// ============================================
// De bor i ./http, så de kan unit-testes uden at rejse databasen og hele
// tRPC-routeren. Eksporteres herfra, fordi ruterne importerer dem her.

export {
  applyPaginationAndSort,
  corsPreflightResponse,
  errorResponse,
  handleTrpcError,
  MAX_PAGE_SIZE,
  paginatedResponse,
  parsePagination,
  parseSorting,
  type RateLimitInfo,
  successResponse,
  withCorsHeaders,
  withRateLimitHeaders,
} from "./http";
