import "./site.css";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { isSiteLocale, SITE_LOCALES } from "@/lib/brands/timewren-site";
import { LOCALE_TAGS } from "@/lib/brands/timewren-site-copy";
import { siteViewport } from "@/lib/brands/timewren-site-meta";

/*
 * Rodlayout for TimeWrens marketingsite (timewren.com). Egen rutegruppe med
 * eget <html>, så TimeTracks (marketing)-layout og appens styles ikke berøres.
 * Siderne nås kun via middleware-rewrite (src/lib/brands/timewren-site.ts) og
 * bygges statisk pr. sprog; priser og host-konfiguration fornyes med ISR.
 */

// Brandkittets skrift (OFL) fra public/brand/timewren/fonts, så buildet ikke
// henter fra Google. Variabel vægt, så 680 som i ordmærket virker.
const display = localFont({
  src: "../../../../../public/brand/timewren/fonts/BricolageGrotesque[opsz,wdth,wght].ttf",
  weight: "200 800",
  display: "swap",
  variable: "--tw-font-display",
});

export const viewport = siteViewport;
export const dynamicParams = false;

export function generateStaticParams() {
  return SITE_LOCALES.map((locale) => ({ locale }));
}

export default async function TimewrenSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSiteLocale(locale)) notFound();
  return (
    <html lang={LOCALE_TAGS[locale]} className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
