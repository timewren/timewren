import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { extensionTokens } from "@/lib/db/schema";
import { tokenLookup } from "@/lib/security/token-hash";

/**
 * ElectricSQL proxy-gatekeeper for the browser EXTENSION's timer shape
 * (issue #260, Fase 2, beta spike).
 *
 * Same security model as the cookie-based `/api/shapes/[resource]` proxy, but
 * the extension authenticates with a bearer TOKEN (chrome.storage), not a
 * Better-Auth session cookie. So this route validates the extension token
 * (same rules as the extension tRPC procedures: matches, not revoked, not
 * expired), resolves the owning userId, and server-FIXES
 * `table = timer_states` + `where = "user_id" = $1` from that userId. The
 * extension never supplies the table/where, so it can only ever sync its own
 * user's timer row.
 *
 * The token is read from the `x-extension-token` header (kept out of the URL so
 * it isn't logged/cached in query strings). Cache varies on that header.
 *
 * INERT unless configured (ELECTRIC_URL/ELECTRIC_SECRET) → 503, so the
 * extension falls back to its existing 30s tRPC polling. Read-only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_CLIENT_PARAMS = new Set([
  "offset",
  "handle",
  "live",
  "cursor",
  "replica",
  "experimental_live_sse",
  "live_sse",
]);

const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "electric-handle",
  "electric-offset",
  "electric-cursor",
  "electric-schema",
  "electric-up-to-date",
];

export async function GET(request: NextRequest) {
  const electricUrl = process.env.ELECTRIC_URL;
  const electricSecret = process.env.ELECTRIC_SECRET;
  if (!electricUrl || !electricSecret) {
    return new Response("electric disabled", { status: 503 });
  }

  // Token from header (preferred) or query (fallback for clients that can't set
  // headers). Never trusted for anything but the DB lookup below.
  const token =
    request.headers.get("x-extension-token") ||
    request.nextUrl.searchParams.get("token");
  if (!token) {
    return new Response("missing token", { status: 401 });
  }

  // Same active-token rule as the extension tRPC procedures.
  const tokenRow = await db.query.extensionTokens.findFirst({
    where: and(
      tokenLookup(extensionTokens.tokenHash, token),
      eq(extensionTokens.isRevoked, false),
      or(
        isNull(extensionTokens.expiresAt),
        gt(extensionTokens.expiresAt, new Date()),
      ),
    ),
    columns: { userId: true },
  });
  if (!tokenRow) {
    return new Response("invalid token", { status: 401 });
  }

  const upstream = new URL(`${electricUrl.replace(/\/$/, "")}/v1/shape`);
  upstream.searchParams.set("table", "timer_states");
  upstream.searchParams.set("where", '"user_id" = $1');
  upstream.searchParams.set("params[1]", tokenRow.userId);
  upstream.searchParams.set("secret", electricSecret);

  for (const [key, value] of request.nextUrl.searchParams) {
    if (ALLOWED_CLIENT_PARAMS.has(key)) {
      upstream.searchParams.set(key, value);
    }
  }

  let electricResponse: Response;
  try {
    electricResponse = await fetch(upstream.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: request.signal,
    });
  } catch (err) {
    console.error("[shapes/ext/timer] upstream fetch failed:", err);
    return new Response("electric unreachable", { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = electricResponse.headers.get(name);
    if (v) responseHeaders.set(name, v);
  }
  // Cache must never cross tokens/users.
  responseHeaders.set("vary", "x-extension-token");

  return new Response(electricResponse.body, {
    status: electricResponse.status,
    headers: responseHeaders,
  });
}
