import { normalizeDomain } from "@/lib/enterprise/sso/domains";

/**
 * Kundens egne domæner (desktop-detektionen genkender kunden på dem).
 * Normaliseres som i reglerne: små bogstaver, uden "https://", sti og
 * "www.". Dubletter fjernes; ugyldige returneres, så kalderen kan afvise.
 */
export function normalizeClientDomains(input: readonly string[]): {
  domains: string[];
  invalid: string[];
} {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const raw of input) {
    const d = normalizeDomain(raw)?.replace(/^www\./, "") ?? null;
    if (!d) invalid.push(raw);
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, invalid };
}
