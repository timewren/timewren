import { headers } from "next/headers";
import { cache } from "react";
import { getBrandId } from "@/lib/brand-id";
import { isMultibrandEnabled, resolveBrandByHost } from "@/lib/brands/registry";
import {
  type DemoCurrency,
  demoCurrencyForEmail,
  isDemoMode,
} from "./demo-mode";

/**
 * Valutaen for sidens beløb og tekster: demokontoens i demoen, ellers den
 * aktive organisations (fund 19). Kun TimeWren kan have en anden valuta end
 * DKK, så TimeTrack slår hverken headers, session eller organisation op.
 */
export const getRequestDemoCurrency = cache(async (): Promise<DemoCurrency> => {
  if (!isDemoMode() && !isMultibrandEnabled() && getBrandId() === "timetrack")
    return "DKK";

  const requestHeaders = await headers();
  const host = requestHeaders.get("host");

  if (isDemoMode()) {
    const { authForHost } = await import("@/lib/auth");
    const session = await authForHost(host).api.getSession({
      headers: requestHeaders,
    });
    return demoCurrencyForEmail(session?.user.email);
  }

  if (isMultibrandEnabled() && resolveBrandByHost(host).key === "timetrack")
    return "DKK";

  // Valutaen må aldrig vælte en side: uden session, database eller
  // organisation er den DKK som før.
  try {
    const { authForHost } = await import("@/lib/auth");
    const session = await authForHost(host).api.getSession({
      headers: requestHeaders,
    });
    if (!session?.user) return "DKK";
    const [{ db }, { resolveActiveOrgId }, { getOrgRegion }] =
      await Promise.all([
        import("@/lib/db"),
        import("@/lib/auth/active-org"),
        import("@/lib/org/region.server"),
      ]);
    const orgId = await resolveActiveOrgId({
      db,
      userId: session.user.id,
      session: session as unknown as Record<string, unknown>,
    });
    return (await getOrgRegion(db, orgId)).currency;
  } catch {
    return "DKK";
  }
});
