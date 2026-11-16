import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/timewren-site/LegalPage";
import {
  type SiteParams,
  siteLocale,
} from "@/components/timewren-site/SiteShell";
import { pageLocales } from "@/lib/brands/timewren-site";
import { siteMetadata } from "@/lib/brands/timewren-site-meta";

export const revalidate = 300;

export async function generateMetadata(props: SiteParams): Promise<Metadata> {
  const locale = await siteLocale(props);
  return siteMetadata(
    "/privacy",
    pageLocales("/privacy").includes(locale) ? locale : "en",
  );
}

export default async function TimewrenPrivacy(props: SiteParams) {
  const locale = await siteLocale(props);
  if (!pageLocales("/privacy").includes(locale)) notFound();
  return <LegalPage kind="privacy" locale={locale} />;
}
