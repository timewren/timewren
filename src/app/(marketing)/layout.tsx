import type { Metadata } from "next";
import {
  DocumentLayout,
  makeMetadata,
  metadata,
  viewport,
} from "@/components/DocumentLayout";
import { MarketingIntlProvider } from "@/components/marketing/MarketingIntlProvider";
import { brandize } from "@/i18n/brandize";
import { isLocale } from "@/i18n/config";
import { staticMessages } from "@/i18n/static-catalog";
import { isMultibrandEnabled } from "@/lib/brands/registry";
import { getRequestBrand } from "@/lib/brands/request";

export { viewport };

export async function generateMetadata(): Promise<Metadata> {
  const rb = await getRequestBrand();
  if (!rb.host) return metadata;
  return makeMetadata(rb.brand, {
    baseUrl: rb.baseUrl ?? undefined,
    locale: rb.locale ?? undefined,
    noindex: rb.host.key !== "timetrack",
  });
}

/** Navneområder, som klientkomponenter på marketingsiderne oversætter med. */
const CLIENT_NAMESPACES = ["forms"] as const;

/**
 * Kun klientkomponenternes navneområder, på et udtrykkeligt sprog og læst
 * synkront fra det statiske katalog (staticNamespaces i
 * scripts/i18n/catalogs.json): ingen cookies eller headers, så layoutet
 * forbliver synkront og siderne statiske.
 */
function MarketingIntl({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  const resolved = isLocale(locale) ? locale : "da";
  const messages = brandize(
    Object.fromEntries(
      CLIENT_NAMESPACES.map((ns) => [ns, staticMessages(ns, resolved)]),
    ),
  );
  return (
    <MarketingIntlProvider locale={locale} messages={messages}>
      {children}
    </MarketingIntlProvider>
  );
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Uden flaget: synkron, statisk og præcis som før.
  if (!isMultibrandEnabled()) {
    return (
      <DocumentLayout locale="da">
        <MarketingIntl locale="da">{children}</MarketingIntl>
      </DocumentLayout>
    );
  }
  return <BrandedMarketingLayout>{children}</BrandedMarketingLayout>;
}

async function BrandedMarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const rb = await getRequestBrand();
  if (!rb.host || rb.host.key === "timetrack") {
    return (
      <DocumentLayout locale="da">
        <MarketingIntl locale="da">{children}</MarketingIntl>
      </DocumentLayout>
    );
  }
  const locale = rb.locale ?? "en";
  return (
    <DocumentLayout
      locale={locale}
      brand={rb.brand}
      colors={rb.host.colors}
      plausibleScriptUrl={rb.host.plausibleScriptUrl}
    >
      <MarketingIntl locale={locale}>{children}</MarketingIntl>
    </DocumentLayout>
  );
}
