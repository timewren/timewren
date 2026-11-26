/**
 * Sproget, en ny konto får i users.locale, når den oprettes på
 * standardinstansen (TimeTrack Cloud og selvhostet TimeWren).
 *
 * Kolonnens default er "da". Uden dette landede en bruger, der havde set hele
 * oprettelsen på engelsk (Accept-Language), i en dansk app og fik danske
 * mails, fordi databaseværdien vinder over browserens sprog
 * (src/i18n/request.ts). TimeWren Cloud sætter sproget i samme insert
 * (signupLocale i host-auth.ts) og bruger ikke denne.
 *
 * Rækkefølge som appens egen: locale-cookien (sprogvælgeren på
 * oprettelsessiden), ellers Accept-Language. Begrænset til instansens sprog.
 * null betyder "intet signal": kolonnens default bliver stående.
 */

import {
  isAvailableLocale,
  type Locale,
  pickFromAcceptLanguage,
} from "@/i18n/config";
import type { BrandId } from "@/lib/brand-id";
import { getBrandId } from "@/lib/brand-id";

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function signupLocaleFromRequest(
  headers: Pick<Headers, "get"> | null | undefined,
  brand: BrandId = getBrandId(),
): Locale | null {
  if (!headers) return null;
  const cookie = readCookie(headers.get("cookie"), "locale");
  if (isAvailableLocale(cookie, brand)) return cookie;
  return pickFromAcceptLanguage(headers.get("accept-language"), brand);
}
