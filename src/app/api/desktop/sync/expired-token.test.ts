import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { getSigningSecret } from "@/lib/security/signing-secret";

// Et udløbet eller ugyldigt device-token skal give 401, så skrivebordsappen
// viser "session udløbet" og beder om nyt login. Før gav jose's JWTExpired
// 500, og appen prøvede igen hvert 5. minut i det uendelige.

vi.mock("@/lib/db", () => ({ db: {} }));

const SECRET = getSigningSecret();

async function expiredToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ userId: "u1", deviceId: "d1", tier: "pro" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now - 100 * 24 * 3600)
    .setExpirationTime(now - 3600)
    .sign(SECRET);
}

async function foreignToken(): Promise<string> {
  return new SignJWT({ userId: "u1", deviceId: "d1", tier: "pro" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("en-helt-anden-hemmelighed"));
}

function req(path: string, token: string, method = "GET"): NextRequest {
  const url = new URL(`https://app.timetrack.dk${path}`);
  url.searchParams.set("since", "2026-09-01T00:00:00.000Z");
  return new NextRequest(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: method === "POST" ? JSON.stringify({ entities: [] }) : undefined,
  });
}

const { GET: pull } = await import("./pull/route");
const { POST: push } = await import("./push/route");
const { GET: full } = await import("./full/route");

const routes = [
  ["pull", (t: string) => pull(req("/api/desktop/sync/pull", t))],
  ["push", (t: string) => push(req("/api/desktop/sync/push", t, "POST"))],
  ["full", (t: string) => full(req("/api/desktop/sync/full", t))],
] as const;

describe("desktop-sync med udløbet eller ugyldigt token", () => {
  it.each(routes)(
    "%s svarer 401 token_expired på udløbet token",
    async (_n, call) => {
      const res = await call(await expiredToken());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "token_expired" });
    },
  );

  it.each(routes)(
    "%s svarer 401 invalid_token på fremmed signatur",
    async (_n, call) => {
      const res = await call(await foreignToken());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_token" });
    },
  );

  it.each(routes)(
    "%s svarer 401 invalid_token på vrøvl-token",
    async (_n, call) => {
      const res = await call("ikke-en-jwt");
      expect(res.status).toBe(401);
    },
  );
});
