import { headers } from "next/headers";
import { type Brand, brand as buildBrand, getBrand } from "@/lib/brand";
import { getMarketingUrl } from "@/lib/config";
import {
  type BrandHostConfig,
  getBrandConfigs,
  isMultibrandEnabled,
  LOCALE_HEADER,
  type Locale,
  resolveBrandByHost,
} from "./registry";

export interface RequestBrand {
  brand: Brand;
  /** null = flaget er slået fra; så gælder build-brandet som før. */
  host: BrandHostConfig | null;
  locale: Locale | null;
  /** Ægte offentlig base-URL for brandets host (til canonical, mails, sitemap). */
  baseUrl: string | null;
}

const STATIC: RequestBrand = {
  brand: buildBrand,
  host: null,
  locale: null,
  baseUrl: null,
};

/**
 * Brandet for den aktuelle forespørgsel. Uden MULTIBRAND_ENABLED=1 returneres
 * build-brandet uden at røre headers(), så sider forbliver statiske og
 * timetrack.dk er uændret. Brandet afgøres af Host-headeren (ikke af en
 * klient-sat x-brand), så det ikke kan forfalskes.
 */
export async function getRequestBrand(): Promise<RequestBrand> {
  if (!isMultibrandEnabled()) return STATIC;
  const h = await headers();
  const cfg = resolveBrandByHost(h.get("host"));
  const hostLocale = h.get(LOCALE_HEADER) ?? "";
  const locale = (cfg.locales as string[]).includes(hostLocale)
    ? (hostLocale as Locale)
    : cfg.defaultLocale;
  if (cfg.key === "timetrack") {
    // Som uden flaget: build-brandets marketing-URL (NEXT_PUBLIC_MARKETING_URL).
    return {
      brand: getBrand("timetrack"),
      host: cfg,
      locale,
      baseUrl: getMarketingUrl(),
    };
  }
  const baseUrl = `https://${cfg.hosts[0]}`;
  const b = getBrand("timewren");
  return {
    brand: {
      ...b,
      supportEmail: cfg.supportEmail,
      themeColor: cfg.colors.primary,
      logo: { ...b.logo, mailIcon: `${baseUrl}/brand/timewren/mark-64.png` },
    },
    host: cfg,
    locale,
    baseUrl,
  };
}

/** Til tests og mails uden request: brand ud fra nøgle. */
export function brandForKey(key: "timetrack" | "timewren"): RequestBrand {
  const cfg = getBrandConfigs()[key];
  return {
    brand: getBrand(key),
    host: cfg,
    locale: cfg.defaultLocale,
    baseUrl: `https://${cfg.hosts[0]}`,
  };
}
