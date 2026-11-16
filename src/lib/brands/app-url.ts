import { headers } from "next/headers";
import { authBrandForHost, isHostAuthEnabled } from "@/lib/auth/host-auth";
import { getAppUrl } from "@/lib/config";
import { DEFAULT_BRAND_KEY, getBrandConfigsSafe } from "./registry";

/**
 * Appens offentlige URL for en host: TimeWren-hosts giver `https://<hosts[0]>`
 * (samme baseURL som TimeWrens auth-instans), alt andet getAppUrl() som før.
 * Til redirects i route-handlere, hvor request.url er containerens interne
 * adresse bag proxyen.
 */
export function appUrlForHost(host: string | null | undefined): string {
  const key = authBrandForHost(host);
  if (key === DEFAULT_BRAND_KEY) return getAppUrl();
  return `https://${getBrandConfigsSafe()[key].hosts[0]}`;
}

/** appUrlForHost for den aktuelle request; uden flagene uden headers(). */
export async function requestAppUrl(): Promise<string> {
  if (!isHostAuthEnabled()) return getAppUrl();
  return appUrlForHost((await headers()).get("host"));
}
