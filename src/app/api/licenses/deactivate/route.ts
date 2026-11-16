import { POST as realDeactivate } from "@/app/api/desktop/license/deactivate/route";

/**
 * COMPAT SHIM — POST /api/licenses/deactivate
 *
 * TimeTrack Desktop <= v0.2.19 posts snake_case (`license_key`, `machine_id`)
 * here. Deactivation is best-effort on the client, so we simply translate the
 * body and delegate; the response passes straight through.
 *
 * SAFE TO REMOVE once no <= v0.2.19 clients remain in the wild.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const camel = {
    licenseKey: body.license_key ?? body.licenseKey,
    machineId: body.machine_id ?? body.machineId,
  };

  const proxied = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(camel),
  });

  return realDeactivate(proxied);
}
