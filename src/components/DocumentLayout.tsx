// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata, Viewport } from "next";
import { Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import PlausibleProvider from "next-plausible";
import { type ReactNode, Suspense } from "react";
import { Toaster } from "sonner";
import "@/app/globals.css";
import { AttributionCapture } from "@/components/AttributionCapture";
import { BrandProvider } from "@/components/BrandContext";
import { CookieConsent } from "@/components/CookieConsent";
import { GoogleAds } from "@/components/GoogleAds";
import { type Brand, brand as buildBrand } from "@/lib/brand";
import { getMarketingUrl } from "@/lib/config";
import { type DemoCurrency, isDemoMode } from "@/lib/demo/demo-mode";
import { appVersionAttributes } from "@/lib/pwa/version";

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  // latin-ext til pl, cs, tr og fi; browseren henter kun filen, når en side bruger tegnene (unicode-range).
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Mono kun til kode (API-docs), ikke til tal og priser (docs/BRAND.md).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const OG_LOCALE: Record<string, string> = {
  da: "da_DK",
  en: "en_GB",
  de: "de_DE",
  es: "es_ES",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

/**
 * Metadata for et brand. Standardkaldet (build-brandet) giver præcis det
 * samme objekt som før; multibrand sender brand + public base-URL + sprog.
 */
export function makeMetadata(
  brand: Brand,
  opts: { baseUrl?: string; locale?: string; noindex?: boolean } = {},
): Metadata {
  const isCloud = brand.id === "timetrack";
  const defaultTitle = `${brand.name}: tidsregistrering med klippekort`;
  return {
    applicationName: brand.name,
    title: {
      default: defaultTitle,
      template: `%s | ${brand.name}`,
    },
    description: brand.description,
    keywords: [
      "timetracking",
      "timeregistrering",
      "tidsregistrering",
      "timeregistrering app",
      "timeregistrering til faktura",
      "faktura ud fra timer",
      "klippekort",
      "freelance fakturering",
      "billy",
      "dinero",
      "freelancer",
    ],
    authors: [{ name: brand.name }],
    creator: brand.name,
    publisher: brand.name,
    // Canonical, og:url og og:image skal pege på marketing-domænet. Efter
    // subdomæne-splittet er NEXT_PUBLIC_APP_URL app.timetrack.dk, som er
    // blokeret i robots og redirecter tilbage.
    metadataBase: new URL(opts.baseUrl ?? getMarketingUrl()),
    openGraph: {
      type: "website",
      locale: OG_LOCALE[opts.locale ?? "da"] ?? "da_DK",
      url: "/",
      title: defaultTitle,
      description: isCloud
        ? "Dansk tidsregistrering med klippekort til selvstændige og små bureauer. Prøv gratis i 30 dage, uden oprettelsesgebyr."
        : brand.description,
      siteName: brand.name,
      // /opengraph-image tegner brandets eget billede (TimeWren: brandkittets
      // og-image, se public/brand/timewren/README.md).
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: isCloud
            ? "TimeTrack: Hvor mange timer glemmer du at fakturere? Tidsregistrering med klippekort."
            : "TimeWren: open-source time tracking, prepaid hours and invoicing",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: defaultTitle,
      description: isCloud
        ? "Dansk tidsregistrering med klippekort til selvstændige og små bureauer. Prøv gratis i 30 dage."
        : brand.description,
      images: ["/opengraph-image"],
    },
    // TimeWren-hosts indekseres ikke, før de har egne marketingsider (spec: SEO).
    // Den offentlige demo (DEMO_MODE=1) indekseres heller aldrig.
    robots:
      opts.noindex || isDemoMode()
        ? { index: false, follow: false }
        : {
            index: true,
            follow: true,
            googleBot: {
              index: true,
              follow: true,
              "max-image-preview": "large",
              "max-snippet": -1,
            },
          },
  };
}

export const metadata: Metadata = makeMetadata(buildBrand);

export function DocumentLayout({
  children,
  locale,
  demoCurrency,
  brand: brandProp,
  colors,
  plausibleScriptUrl,
}: Readonly<{
  children: React.ReactNode;
  locale: string;
  demoCurrency?: DemoCurrency;
  /** Multibrand: brandet for denne host. Udeladt = build-brandet (uændret). */
  brand?: Brand;
  /** Multibrand: overstyrer --tt-gran-familien med brandets primærfarve. */
  colors?: { primary: string; primaryDark: string; primaryLight: string };
  plausibleScriptUrl?: string;
}>) {
  const brand = brandProp ?? buildBrand;
  const scriptUrl =
    plausibleScriptUrl ?? process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL;
  return (
    <html
      lang={locale}
      data-demo-currency={demoCurrency}
      className={`${schibsted.variable} ${geistMono.variable}`}
      // Fanens build-version til "Ny version"-tjekket. Ved kørsel, ikke som
      // NEXT_PUBLIC_*-define: den ville ugyldiggøre build-cachen pr. commit.
      {...appVersionAttributes()}
      suppressHydrationWarning
    >
      {/* biome-ignore lint/style/noHeadElement: roddokument uden for Pages Router; layoutet ejer selv <html> og <head> */}
      <head>
        {/* Runtime-konfiguration (URL'er og brand, #1017). Synkront og før
            appens bundt, så klienten kender serverens værdier uden rebuild. */}
        <script src="/runtime-config.js" />

        {colors && (
          <style
            // biome-ignore lint/security/noDangerouslySetInnerHtml: kun hex-værdier fra brand-config
            dangerouslySetInnerHTML={{
              __html: `:root{--tt-gran:${colors.primary};--tt-gran-moerk:${colors.primaryDark};--tt-gran-lys:${colors.primaryLight};--tt-fokus:${colors.primary}}`,
            }}
          />
        )}
        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* PWA Meta Tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={brand.shortName} />
        <meta name="application-name" content={brand.name} />
        <meta name="format-detection" content="telephone=no" />

        {/* Ikoner genereres af scripts/brand/generate-icons.mjs (TimeTrack) og
            generate-timewren.mjs (TimeWren). apple-touch er fuld flade uden
            afrunding (iOS lægger masken på). TimeTracks favicon i 16 px har
            tykkere visere; derfor kun PNG/ICO dér. TimeWrens PNG'er er
            renderet fra samme geometri som favicon.svg, så SVG'en kommer først
            og skifter selv farve i mørk tilstand. */}
        <link rel="apple-touch-icon" href={brand.logo.appleTouch} />
        {brand.logo.faviconSvg && (
          <link rel="icon" type="image/svg+xml" href={brand.logo.faviconSvg} />
        )}
        {brand.logo.faviconIco && (
          <link rel="icon" href={brand.logo.faviconIco} sizes="48x48" />
        )}
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href={brand.logo.favicon32}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href={brand.logo.favicon16}
        />

        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk tema-/samtykkescript der skal køre før første paint, ingen brugerinput
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('theme') || 'light';
                const actualTheme = theme === 'system'
                  ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
                  : theme;
                document.documentElement.classList.add(actualTheme);
              } catch (e) {}
              try {
                // Skjul det server-renderede cookie-banner før første paint
                // hvis der allerede er givet samtykke (se CookieConsent).
                if (document.cookie.split('; ').some(function (c) { return c.indexOf('tt_consent=') === 0; })
                  || localStorage.getItem('timetrack_cookie_consent')) {
                  document.documentElement.setAttribute('data-cookie-consent', 'given');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className={`font-sans antialiased`}>
        {/* next/script indsætter selv beforeInteractive i <head>; komponenten må ikke stå direkte under <html> */}
        <GoogleAds />
        {/*
          Plausible CE v2-script. Indlæses kun når NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL
          er sat (bages ind ved build); ellers ingen analyse. Udgående links og
          fildownloads slås til i Plausible (Site installation), og
          tagged events (plausible-event-name=…) er indbygget i scriptet.
        */}
        <OptionalPlausible scriptUrl={scriptUrl}>
          {/*
            tRPC/React Query, ThemeProvider og next-intls klientprovider
            ligger i dashboard-/admin-/portal-layoutene (AppProviders) og hos
            de få offentlige komponenter der kalder API'et — ikke her, så
            marketingsiderne slipper for det JS.
          */}
          <Suspense fallback={null}>
            <AttributionCapture />
          </Suspense>
          {brandProp ? (
            <BrandProvider
              value={{
                id: brand.id,
                name: brand.name,
                shortName: brand.shortName,
                logo: { icon: brand.logo.icon },
                supportEmail: brand.supportEmail,
              }}
            >
              {children}
            </BrandProvider>
          ) : (
            children
          )}
          {/*
            Toasten skal ligge fri af begge hjørner. Top-right dækkede
            quick-add-knapperne i den 56 px høje topbar; bottom-right er
            optaget af FloatingTimerButton (bottom-20/lg:bottom-6),
            feedback-panelets knap (lg: bottom-24), mobil-bundnavet
            (fixed bottom-0) og cookie-banneret. Derfor top-right med et
            offset der starter under topbaren.
          */}
          <Toaster
            richColors
            position="top-right"
            offset={{ top: "72px" }}
            mobileOffset={{ top: "72px", right: "16px", left: "16px" }}
          />
          <CookieConsent locale={locale} brandName={brand.name} />
        </OptionalPlausible>
      </body>
    </html>
  );
}

function OptionalPlausible({
  scriptUrl,
  children,
}: {
  scriptUrl: string | undefined;
  children: ReactNode;
}) {
  if (!scriptUrl) return <>{children}</>;
  return <PlausibleProvider src={scriptUrl}>{children}</PlausibleProvider>;
}
