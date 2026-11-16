// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
import { getAppUrl, getEmailDomain } from "@/lib/config";
import { type BrandId, getBrandId } from "./brand-id";

export type { BrandId };

/**
 * Produktets brand (#968). Samme kodebase kører som TimeWren (open source /
 * selvhost, standard) og som TimeTrack (Mahopes danske cloud).
 *
 * Vælges med NEXT_PUBLIC_BRAND=timewren|timetrack. Variablen læses ved
 * kørsel (runtime-env.ts, #1017): serveren fra process.env, klienten fra
 * /runtime-config.js, så de er enige uden rebuild. Alt andet end "timetrack"
 * giver TimeWren: en selvhoster skal ikke se Mahopes brand, hvis variablen
 * mangler.
 */

export interface Brand {
  id: BrandId;
  /** Produktnavn i UI, mails og metadata. */
  name: string;
  /** Kort navn til ikon-labels, PWA short_name og SMS-afsender. */
  shortName: string;
  /** Juridisk ejer/udgiver. */
  legalOwner: string;
  tagline: string;
  /** Meta-beskrivelse (layout, manifest). */
  description: string;
  supportEmail: string;
  /**
   * Personlig kontaktadresse i marketing og personlige mails (udgiveren
   * svarer selv). CONTACT_EMAIL vinder; uden den
   * bruger alle andre end TimeTrack supportEmail.
   */
  contactEmail: string;
  /** Kontakt i /.well-known/security.txt. Uden for TimeTrack: supportEmail. */
  securityEmail: string;
  logo: {
    /** Firkantet ikon (SVG), bruges i app-skallen og som favicon. */
    icon: string;
    /** Ikon + navn som ét ordmærke (SVG). Kun sat, hvis brandet har et; ellers tegner Logo navnet som tekst. */
    wordmark?: string;
    /** PNG-ikoner til manifest og enheder. */
    icon192: string;
    icon512: string;
    iconMaskable192: string;
    iconMaskable512: string;
    appleTouch: string;
    favicon32: string;
    favicon16: string;
    /** Favicon i .ico-format; kun sat hvis brandet har en. */
    faviconIco?: string;
    /** Favicon som SVG (skifter selv farve i mørk tilstand); kun sat hvis brandet har en. */
    faviconSvg?: string;
    /** Absolut URL til ikonet i mails (mailklienter kan ikke hente relative). */
    mailIcon: string;
  };
  themeColor: string;
  /** Kun sat for Mahopes cloud: den hostede tjenestes forside. */
  cloudUrl?: string;
}

function supportEmailFor(id: BrandId): string {
  const fromEnv =
    process.env.SUPPORT_EMAIL || process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  if (fromEnv) return fromEnv;
  if (id === "timetrack") return "support@timetrack.dk";
  const domain = getEmailDomain();
  return `support@${domain || "localhost"}`;
}

function contactEmailFor(id: BrandId): string {
  const fromEnv = process.env.CONTACT_EMAIL;
  if (fromEnv) return fromEnv;
  if (id === "timetrack") return "mads@timetrack.dk";
  return supportEmailFor(id);
}

function securityEmailFor(id: BrandId): string {
  if (id === "timetrack") return "security@timetrack.dk";
  return supportEmailFor(id);
}

function build(id: BrandId): Brand {
  if (id === "timetrack") {
    return {
      id,
      name: "TimeTrack",
      shortName: "TimeTrack",
      legalOwner: "Mahope",
      tagline: "Tidsregistrering med klippekort",
      description:
        "Dansk tidsregistrering med klippekort til selvstændige og små bureauer, med fakturagrundlag til Billy og Dinero. Web, browserudvidelse og desktop i alle planer. Prøv gratis i 30 dage.",
      supportEmail: supportEmailFor(id),
      contactEmail: contactEmailFor(id),
      securityEmail: securityEmailFor(id),
      logo: {
        icon: "/icon.svg",
        icon192: "/icons/icon-192x192.png",
        icon512: "/icons/icon-512x512.png",
        iconMaskable192: "/icons/icon-maskable-192x192.png",
        iconMaskable512: "/icons/icon-maskable-512x512.png",
        appleTouch: "/apple-touch-icon.png",
        favicon32: "/icons/favicon-32x32.png",
        favicon16: "/icons/favicon-16x16.png",
        faviconIco: "/favicon.ico",
        mailIcon: "https://timetrack.dk/brand/tt-ikon-64.png",
      },
      themeColor: "#1E5B47",
      cloudUrl: "https://timetrack.dk",
    };
  }
  // Brandkit: public/brand/timewren/README.md.
  const base = "/brand/timewren";
  return {
    id,
    name: "TimeWren",
    shortName: "TimeWren",
    legalOwner: "Mahope",
    tagline: "Tidsregistrering med klippekort",
    description:
      "Åben tidsregistrering med klippekort, fakturagrundlag og kundeportal til selvstændige og små bureauer.",
    supportEmail: supportEmailFor(id),
    contactEmail: contactEmailFor(id),
    securityEmail: securityEmailFor(id),
    logo: {
      icon: `${base}/mark.svg`,
      wordmark: `${base}/wordmark.svg`,
      icon192: `${base}/icon-192.png`,
      icon512: `${base}/icon-512.png`,
      iconMaskable192: `${base}/icon-maskable-192.png`,
      iconMaskable512: `${base}/icon-maskable-512.png`,
      appleTouch: `${base}/apple-touch-icon.png`,
      favicon32: `${base}/favicon-32.png`,
      favicon16: `${base}/favicon-16.png`,
      faviconIco: `${base}/favicon.ico`,
      faviconSvg: `${base}/favicon.svg`,
      mailIcon: `${getAppUrl().replace(/\/$/, "")}${base}/mark-64.png`,
    },
    // Thicket fra brandkittet.
    themeColor: "#3F5A3A",
  };
}

/** Det aktive brand. Beregnes ved import; NEXT_PUBLIC_BRAND ændrer sig ikke i en kørende proces. */
export const brand: Brand = build(getBrandId());

/** Til tests: byg et brand uden at genindlæse modulet. */
export function getBrand(id: BrandId = getBrandId()): Brand {
  return build(id);
}
