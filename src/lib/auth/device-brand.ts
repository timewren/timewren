import { getBrandId } from "@/lib/brand-id";
import { authBrandForHost, isHostAuthEnabled } from "./host-auth";

/**
 * Brandet, som en device-login-godkendelse hører til: hostens brand i
 * multibrand (TimeWren Cloud), ellers instansens brand (NEXT_PUBLIC_BRAND,
 * så en selvhostet TimeWren-instans giver timewren://).
 */
export function deviceLoginBrand(request: Request): string {
  if (isHostAuthEnabled()) {
    // Flere proxies kan give en kommasepareret liste; den første er klientens.
    const host = (
      request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    )
      ?.split(",")[0]
      ?.trim();
    return authBrandForHost(host);
  }
  return getBrandId();
}
