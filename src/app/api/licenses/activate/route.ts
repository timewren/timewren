import { NextResponse } from "next/server";
import { POST as realActivate } from "@/app/api/desktop/license/activate/route";

/**
 * COMPAT SHIM — POST /api/licenses/activate
 *
 * TimeTrack Desktop <= v0.2.19 shipped with the wrong endpoint/shape:
 *  - it POSTs here (the marketing path) instead of /api/desktop/license/activate
 *  - it sends snake_case (`license_key`, `machine_id`, `os`, `app_version`)
 *  - it expects a FLAT proof `{ license_key, tier, valid_until, devices_allowed,
 *    issued_at, verified_at }` — NOT the `{ proof: { ... } }` envelope.
 *
 * This route lets those already-installed clients activate without reinstalling
 * by delegating to the real handler and translating the request/response.
 *
 * SAFE TO REMOVE once no <= v0.2.19 clients remain in the wild.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  // Accept snake_case (old client) and camelCase (defensive).
  const camel = {
    licenseKey: body.license_key ?? body.licenseKey,
    machineId: body.machine_id ?? body.machineId,
    os: body.os,
    deviceName: body.device_name ?? body.deviceName,
  };

  const proxied = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(camel),
  });

  const res = await realActivate(proxied);
  const data = (await res.json().catch(() => ({}))) as {
    proof?: {
      license_key?: string;
      tier?: string;
      valid_until?: string | null;
      devices_allowed?: number;
      issued_at?: string;
    };
    error?: string;
  };

  if (!res.ok) {
    // Pass the real status/error through so the old client shows a clean message.
    return NextResponse.json(data, { status: res.status });
  }

  const p = data.proof ?? {};
  // Flatten the envelope and stamp verified_at (the old client requires it).
  return NextResponse.json({
    license_key: p.license_key,
    tier: p.tier,
    valid_until: p.valid_until ?? null,
    devices_allowed: p.devices_allowed,
    issued_at: p.issued_at,
    verified_at: new Date().toISOString(),
  });
}
