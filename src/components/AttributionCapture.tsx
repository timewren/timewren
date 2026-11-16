"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  CAMPAIGN_CODE_COOKIE,
  CAMPAIGN_CODE_PARAM,
  normalizeCampaignCode,
} from "@/lib/billing/campaign-codes";
import { sharedCookieDomain } from "@/lib/consent";

const COOKIE_NAME = "tt_attr";
const COOKIE_DAYS = 30;

interface Attribution {
  source?: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
  landingPage?: string;
  /** Google Ads klik-id (gclid/gbraid/wbraid) — bruges til offline
   *  konverterings-upload via Ads API'et. */
  gclid?: string;
  capturedAt: string;
}

function readCookie(): Attribution | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match.split("=")[1]));
  } catch {
    return null;
  }
}

function writeCookie(attr: Attribution) {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(attr));
  const maxAge = COOKIE_DAYS * 86400;
  // domain=.timetrack.dk så attributionen overlever hoppet fra
  // marketing-hosten til app-hosten hvor signuppet sker — uden den blev
  // en betalt Google-touch overskrevet af CTA'ens interne ?ref=.
  const domain = sharedCookieDomain();
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API mangler i Safari/Firefox, og cookien skal sættes synkront før navigation
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${
    domain ? `; domain=${domain}` : ""
  }`;
}

/**
 * `?kode=<kampagnekode>` gemmes i sin egen cookie, så onboardingen kan
 * forudfylde koden efter signup på app-hosten. Den seneste kode vinder.
 */
function captureCampaignCode(url: URL) {
  const code = normalizeCampaignCode(url.searchParams.get(CAMPAIGN_CODE_PARAM));
  if (!code) return;
  const domain = sharedCookieDomain();
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API mangler i Safari/Firefox, og cookien skal sættes synkront før navigation
  document.cookie = `${CAMPAIGN_CODE_COOKIE}=${code}; path=/; max-age=${
    COOKIE_DAYS * 86400
  }; SameSite=Lax${domain ? `; domain=${domain}` : ""}`;
}

/**
 * Captures UTM parameters and referrer on the first visit (or when UTM
 * params are present — they take precedence). Stored in a 30-day cookie
 * so we still have the attribution when the user signs up later.
 *
 * The server-side signup hook (src/lib/auth.ts) reads this cookie and
 * persists it on the user row.
 */
export function AttributionCapture() {
  // Re-kør capture ved client-side navigation (next/link) — ellers fanges
  // query-params kun ved hard page load, og fx `?ref=` på interne CTA-links
  // ville blive tabt. usePathname kræver (modsat useSearchParams) ingen
  // Suspense-boundary, så statiske sider påvirkes ikke.
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname er bevidst med som re-run-trigger ved client-side navigation — effekten læser window.location direkte.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    captureCampaignCode(url);
    const utmSource = url.searchParams.get("utm_source");
    const utmMedium = url.searchParams.get("utm_medium");
    const utmCampaign = url.searchParams.get("utm_campaign");
    // Google Ads klik-id'er. gclid følger med i URL'en (også via Consent
    // Modes url_passthrough), gbraid/wbraid er iOS-varianterne.
    const gclid =
      url.searchParams.get("gclid") ??
      url.searchParams.get("gbraid") ??
      url.searchParams.get("wbraid");
    // `?ref=<kilde>` på interne CTA-links (fx alternativ-siderne) behandles
    // som en sammenlignings-kampagne, så signups derfra kan attribueres.
    const ref = url.searchParams.get("ref");

    const existing = readCookie();

    // Regler:
    // - UTM-params eller et klik-id i URL'en → fuld latest-touch-overskrivning
    //   (et klik-id uden utm er stadig en betalt Google-touch).
    // - `ref` må kun berige en attribution UDEN utm-ophav (organisk/direkte).
    //   En eksisterende utm-baseret touch (fx betalt cpc fra Google Ads) må
    //   aldrig overskrives af et internt ref-link.
    // - Ellers: skriv kun cookie hvis ingen findes (first touch).
    const hasNewUtm = Boolean(utmSource || utmMedium || utmCampaign || gclid);
    const refCanApply = Boolean(ref) && !hasNewUtm && !existing?.medium;
    if (!hasNewUtm && !refCanApply && existing) return;

    const referrer =
      document.referrer && !document.referrer.includes(window.location.hostname)
        ? document.referrer
        : null;

    let attr: Attribution;
    if (hasNewUtm) {
      // Fuld latest-touch-overskrivning: ingen nedarvning fra forrige touch.
      // Ellers parres fx et nyt gclid (Google auto-tagging sender KUN gclid)
      // med en gammel kampagnes navn fra en tidligere, urelateret touch.
      attr = {
        source:
          utmSource ?? (gclid ? "google" : referrer ? "referral" : "direct"),
        medium: utmMedium ?? (gclid ? "cpc" : undefined),
        campaign: utmCampaign ?? undefined,
        referrer: referrer ?? undefined,
        landingPage: window.location.pathname,
        gclid: gclid ?? undefined,
        capturedAt: new Date().toISOString(),
      };
    } else if (refCanApply) {
      // Intern ?ref= beriger en utm-løs attribution.
      attr = {
        source: "comparison",
        medium: "comparison",
        campaign: ref ?? undefined,
        referrer: referrer ?? existing?.referrer,
        landingPage: existing?.landingPage ?? window.location.pathname,
        gclid: existing?.gclid,
        capturedAt: new Date().toISOString(),
      };
    } else {
      // First touch — ingen eksisterende cookie.
      attr = {
        source: referrer ? "referral" : "direct",
        referrer: referrer ?? undefined,
        landingPage: window.location.pathname,
        capturedAt: new Date().toISOString(),
      };
    }

    writeCookie(attr);
  }, [pathname]);

  return null;
}
