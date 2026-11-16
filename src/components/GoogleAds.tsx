"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { readConsent } from "@/lib/consent";
import { getGoogleAdsId } from "@/lib/google-ads";

const GA_ID = getGoogleAdsId();

export function GoogleAds() {
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    // Check consent on mount and listen for changes. Læses via den delte
    // cookie (lib/consent) så samtykke fra marketing-hosten også gælder her.
    const checkConsent = () => {
      setHasConsent(!!readConsent()?.marketing);
    };

    checkConsent();

    // Listen for consent changes
    const handler = () => checkConsent();
    window.addEventListener("cookie-consent-updated", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("cookie-consent-updated", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  // Når marketing-samtykke gives, opgradér samtykket til "granted".
  // gtag.js loades altid (nedenfor), så selve opgraderingen sker her som en
  // Consent Mode-update i stedet for ved at betinge load af tagget.
  useEffect(() => {
    if (
      hasConsent &&
      typeof window !== "undefined" &&
      typeof window.gtag === "function"
    ) {
      window.gtag("consent", "update", {
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
      });
    }
  }, [hasConsent]);

  // Ingen konto sat (selvhost): intet script, ingen kald til Google (#1024).
  if (!GA_ID) return null;

  return (
    <>
      {/* Google Consent Mode v2 — always load (sets defaults before gtag) */}
      <Script id="google-consent-mode" strategy="beforeInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('consent', 'default', {
            'ad_storage': 'denied',
            'ad_user_data': 'denied',
            'ad_personalization': 'denied',
            'analytics_storage': 'denied',
            'wait_for_update': 500
          });
          // Uden url_passthrough tabes gclid ved første navigation når
          // ad_storage er denied, og så kan konverteringen aldrig attribueres.
          // Med passthrough dekoreres interne links med klik-id'et i URL'en.
          gtag('set', 'url_passthrough', true);
          gtag('set', 'ads_data_redaction', true);
        `}
      </Script>

      {/* Load gtag.js ALTID. Consent Mode v2 sender cookieløse pings for
          besøgende der afviser, så Google kan modellere konverteringer.
          Samtykket opgraderes til "granted" i effekten ovenfor når
          marketing-cookies accepteres.
          lazyOnload: med afterInteractive blev de ~160 KB hentet med høj
          prioritet i konkurrence med CSS, fonte og LCP. gtag() er allerede
          defineret af consent-scriptet og køer alt i dataLayer (consent,
          config, konverteringer) til tagget er hentet, og gclid fanges
          uafhængigt af AttributionCapture. */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="lazyOnload"
      />
      <Script id="google-ads-config" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}
      </Script>
    </>
  );
}

/**
 * Known conversion labels — konto AW-18183663242 ("Mahoje - Kampagner").
 * Oprettet 3/6-2026 via Google Ads API.
 */
const CONVERSIONS = {
  subscribe: "lTubCJS_r7gcEIrd0t5D",
  signup: "6_jICPC_rrgcEIrd0t5D",
} as const;

type ConversionType = keyof typeof CONVERSIONS;

/**
 * Fire a Google Ads conversion event.
 * Usage: trackGoogleConversion("subscribe")
 */
export function trackGoogleConversion(
  type: ConversionType,
  value = 1.0,
  currency = "DKK",
) {
  if (!GA_ID) return;
  const label = CONVERSIONS[type];
  // Skip hvis konverteringen endnu ikke har fået sit rigtige label tildelt.
  if (label.startsWith("PLACEHOLDER")) return;
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", "conversion", {
      send_to: `${GA_ID}/${label}`,
      value,
      currency,
    });
  }
}
