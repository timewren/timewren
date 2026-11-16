import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GET as realVerify } from "@/app/api/desktop/license/verify/route";

/**
 * COMPAT SHIM — GET /api/licenses/verify?key=...&machine_id=...
 *
 * TimeTrack Desktop <= v0.2.19 calls this path and expects a FLAT signed-proof
 * body it can parse as a license proof (`license_key`, `tier`, `valid_until`,
 * `devices_allowed`, `issued_at`, `verified_at`). The real handler returns
 * `{ valid, tier, expiresAt, ... }`, so we translate.
 *
 * Old-client trust rules we must honor:
 *  - a 2xx body that parses as a proof whose `license_key` matches → valid
 *  - a 401/403/410 → the client drops the license (revoked/invalid)
 *  - anything else (404/5xx/parse-fail) → the client stays in offline grace
 *
 * SAFE TO REMOVE once no <= v0.2.19 clients remain in the wild.
 */
export async function GET(request: NextRequest) {
  const res = await realVerify(request);
  const data = (await res.json().catch(() => ({}))) as {
    valid?: boolean;
    tier?: string;
    devicesAllowed?: number;
    expiresAt?: string | null;
    error?: string;
  };

  // A non-2xx from the real handler is a TRANSIENT failure (e.g. a 500 DB
  // hiccup or a 400), NOT an authoritative statement that the license is
  // invalid. Pass the status straight through: it is never 401/403/410, so the
  // old client stays in its offline grace window instead of deleting the local
  // proof. Only an authoritative HTTP 200 with valid:false becomes a 403 below.
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const key = request.nextUrl.searchParams.get("key") ?? "";

  if (data.valid) {
    // Echo the client's own key back so its license_key equality check passes.
    return NextResponse.json({
      license_key: key,
      tier: data.tier,
      valid_until: data.expiresAt ?? null,
      devices_allowed: data.devicesAllowed,
      issued_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
    });
  }

  // Authoritatively invalid — 403 makes the old client drop the local proof
  // rather than fail open into offline grace.
  return NextResponse.json(
    { error: data.error ?? "License invalid" },
    { status: 403 },
  );
}
