import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import {
  DocumentLayout,
  makeMetadata,
  metadata,
  viewport,
} from "@/components/DocumentLayout";
import { getRequestBrand } from "@/lib/brands/request";
import { getAppUrl } from "@/lib/config";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { getRequestDemoCurrency } from "@/lib/demo/request-currency";
import { usesRuntimeInstancePages } from "@/lib/marketing-guard";

export async function generateMetadata(): Promise<Metadata> {
  const rb = await getRequestBrand();
  // Offentlig demo: noindex (makeMetadata læser DEMO_MODE ved kørsel).
  if (!rb.host) {
    if (usesRuntimeInstancePages()) {
      return makeMetadata(rb.brand, { baseUrl: getAppUrl(), noindex: true });
    }
    return isDemoMode() ? makeMetadata(rb.brand) : metadata;
  }
  return makeMetadata(rb.brand, {
    baseUrl: rb.baseUrl ?? undefined,
    locale: rb.locale ?? undefined,
    noindex: rb.host.key !== "timetrack",
  });
}

export { viewport };

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  // Demoen sætter altid valutaen; ellers kun når organisationen ikke bruger
  // DKK (TimeWren, fund 19), så TimeTrack-sider er uændrede.
  const currency = await getRequestDemoCurrency();
  const demoCurrency =
    isDemoMode() || currency !== "DKK" ? currency : undefined;
  const rb = await getRequestBrand();
  if (!rb.host || rb.host.key === "timetrack") {
    // Flag fra, eller timetrack-host: præcis som før.
    return (
      <DocumentLayout locale={locale} demoCurrency={demoCurrency}>
        {children}
      </DocumentLayout>
    );
  }
  return (
    <DocumentLayout
      locale={locale}
      demoCurrency={demoCurrency}
      brand={rb.brand}
      colors={rb.host.colors}
      plausibleScriptUrl={rb.host.plausibleScriptUrl}
    >
      {children}
    </DocumentLayout>
  );
}
