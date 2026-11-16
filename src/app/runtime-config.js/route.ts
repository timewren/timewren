import { createHash } from "node:crypto";
import { getBrandId } from "@/lib/brand-id";
import { isMultibrandEnabled, resolveBrandByHost } from "@/lib/brands/registry";
import { renderRuntimeConfigScript } from "@/lib/runtime-env";

// Læser env ved kørsel pr. forespørgsel (#1017), aldrig ved build.
export const dynamic = "force-dynamic";

/**
 * Scriptet er render-blokerende i <head>, så det må ikke koste en fuld
 * download på hver sidevisning. `no-cache` + ETag: browseren genvalidérer og
 * får 304 uden krop, mens en ændret env (ny start af containeren) slår
 * igennem med det samme, så klient og server aldrig er uenige.
 */
export function GET(request: Request) {
  const body = renderRuntimeConfigScript({
    hostBrand: hostBrandFor(request),
  });
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;
  const headers = {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-cache",
    etag,
  };
  const ifNoneMatch = request.headers.get("if-none-match");
  if (
    ifNoneMatch?.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)
  ) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers });
}

/**
 * Multibrand: hostens brand, når det ikke er build-brandet (TimeWren-hosts),
 * så kode uden for React-træet kan følge hosten. Ellers intet, og scriptet er
 * uændret.
 */
function hostBrandFor(request: Request): string | undefined {
  if (!isMultibrandEnabled()) return undefined;
  const key = resolveBrandByHost(request.headers.get("host")).key;
  return key === getBrandId() ? undefined : key;
}
