import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import {
  DocumentLayout,
  makeMetadata,
  metadata,
  viewport,
} from "@/components/DocumentLayout";
import { getRequestBrand } from "@/lib/brands/request";

export async function generateMetadata(): Promise<Metadata> {
  const rb = await getRequestBrand();
  if (!rb.host) return metadata;
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
  const rb = await getRequestBrand();
  if (!rb.host || rb.host.key === "timetrack") {
    // Flag fra, eller timetrack-host: præcis som før.
    return <DocumentLayout locale={locale}>{children}</DocumentLayout>;
  }
  return (
    <DocumentLayout
      locale={locale}
      brand={rb.brand}
      colors={rb.host.colors}
      plausibleScriptUrl={rb.host.plausibleScriptUrl}
    >
      {children}
    </DocumentLayout>
  );
}
