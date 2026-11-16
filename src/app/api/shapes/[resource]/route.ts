import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";

/**
 * ElectricSQL proxy-gatekeeper for live "read" shapes (issue #260, beta spike).
 *
 * SECURITY MODEL: Electric does NO authorization — it exposes whatever its DB
 * role can read to anyone who can reach it. So the client NEVER talks to
 * Electric directly and NEVER supplies the shape's `table`/`where`. For each
 * allowed resource this route:
 *   1. validates the Better-Auth session,
 *   2. server-FIXES the `table` and a tenant-safe `where` (`user_id`/
 *      `organization_id` from the SESSION, never the request),
 *   3. adds the private ELECTRIC_SECRET,
 *   4. only forwards the sync-cursor params the client may set,
 *   5. proxies to Electric and streams the response back.
 * A user can therefore only ever sync rows for their own user/org — the tenant
 * filter is not something the client can influence.
 *
 * Equality filters (`= $1`) are Electric's optimized path (flat regardless of
 * shape count), so both scopes stay fast.
 *
 * INERT unless configured: ELECTRIC_URL/ELECTRIC_SECRET unset → 503 and clients
 * fall back to tRPC/SSE/polling. Only beta sets ELECTRIC_URL. Read-only: writes
 * stay on tRPC.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allowlist of syncable resources → the real table + tenant scope. Adding a
// live surface = one line here (+ ensure the table's schema is stable, since
// synced-table DDL forces client re-sync).
const SHAPES: Record<string, { table: string; scope: "user" | "org" }> = {
  // The user's own timer (their tabs/devices/extension).
  timer: { table: "timer_states", scope: "user" },
  // The org's time entries (teammates' + own; user-id fallback for legacy solo).
  "time-entries": { table: "time_entries", scope: "org" },
};

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const electricUrl = process.env.ELECTRIC_URL;
  const electricSecret = process.env.ELECTRIC_SECRET;
  if (!electricUrl || !electricSecret) {
    return new Response("electric disabled", { status: 503 });
  }

  const { resource } = await params;
  const shape = SHAPES[resource];
  if (!shape) {
    return new Response("unknown shape", { status: 404 });
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return new Response("unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  // Server-fix the tenant-safe where-clause from the session.
  let whereColumn = "user_id";
  let whereValue = userId;
  if (shape.scope === "org") {
    const orgId = await resolveActiveOrgId({
      db,
      userId,
      session: session as Record<string, unknown>,
    });
    if (!orgId) {
      // Uden medlemskab (fx et fjernet medlem) må user_id-scopet ikke give
      // de rækker, brugeren oprettede i den gamle organisation.
      return new Response("forbidden", { status: 403 });
    }
    whereColumn = "organization_id";
    whereValue = orgId;
  }

  const upstream = new URL(`${electricUrl.replace(/\/$/, "")}/v1/shape`);
  upstream.searchParams.set("table", shape.table);
  upstream.searchParams.set("where", `"${whereColumn}" = $1`);
  upstream.searchParams.set("params[1]", whereValue);
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
    console.error(`[shapes/${resource}] upstream fetch failed:`, err);
    return new Response("electric unreachable", { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = electricResponse.headers.get(name);
    if (v) responseHeaders.set(name, v);
  }
  responseHeaders.set("vary", "Cookie");

  return new Response(electricResponse.body, {
    status: electricResponse.status,
    headers: responseHeaders,
  });
}
