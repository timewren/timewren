import { getLocale } from "next-intl/server";
import {
  DocumentLayout,
  makeMetadata,
  viewport,
} from "@/components/DocumentLayout";
import { MarketingIntlProvider } from "@/components/marketing/MarketingIntlProvider";
import { brandize } from "@/i18n/brandize";
import { isLocale } from "@/i18n/config";
import { staticMessages } from "@/i18n/static-catalog";
import { getRequestBrand } from "@/lib/brands/request";
import { getAppUrl } from "@/lib/config";

export { viewport };
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { brand, baseUrl, locale } = await getRequestBrand();
  return makeMetadata(brand, {
    baseUrl: baseUrl ?? getAppUrl(),
    locale: locale ?? undefined,
    noindex: true,
  });
}

export default async function InstanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { brand, host } = await getRequestBrand();
  const locale = await getLocale();
  const messages = brandize(
    { forms: staticMessages("forms", isLocale(locale) ? locale : "da") },
    brand.id,
  );
  return (
    <DocumentLayout locale={locale} brand={brand} colors={host?.colors}>
      <MarketingIntlProvider locale={locale} messages={messages}>
        {children}
      </MarketingIntlProvider>
    </DocumentLayout>
  );
}
