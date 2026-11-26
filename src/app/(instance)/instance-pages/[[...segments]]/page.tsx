import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Footer } from "@/components/Footer";
import ContactPage from "@/components/instance-pages/ContactPage";
import CookiesPage from "@/components/instance-pages/CookiesPage";
import DeleteAccountPage from "@/components/instance-pages/DeleteAccountPage";
import DownloadPage from "@/components/instance-pages/DownloadPage";
import DownloadSuccessPage from "@/components/instance-pages/DownloadSuccessPage";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";
import { getRequestBrand } from "@/lib/brands/request";
import { getAppUrl, getMarketingUrl } from "@/lib/config";
import {
  loadMarketingLayoutMetadata,
  loadMarketingPage,
} from "@/lib/instance-marketing-loader";
import type { MarketingProps } from "@/lib/instance-marketing-loader.types";
import {
  INSTANCE_PAGES,
  type InstancePagePath,
  isInstancePage,
} from "@/lib/instance-paths";
import { isMarketingEnabled, isTimeTrackCloud } from "@/lib/marketing-guard";

type Props = {
  params: Promise<{ segments?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function marketingProps(
  segments: string[],
  searchParams: Props["searchParams"],
): MarketingProps {
  return {
    params: Promise.resolve({ slug: segments[1] ?? "" }),
    searchParams: searchParams ?? Promise.resolve({}),
  };
}

const operatorText = {
  "/gdpr": "gdpr",
  "/privacy": "privacy",
  "/terms": "terms",
  "/databehandleraftale": "dpa",
} as const satisfies Partial<Record<InstancePagePath, string>>;

const pages = {
  "/cookies": CookiesPage,
  "/contact": ContactPage,
  "/download": DownloadPage,
  "/download/success": DownloadSuccessPage,
  "/slet-konto": DeleteAccountPage,
} satisfies Record<
  Exclude<InstancePagePath, keyof typeof operatorText>,
  React.ComponentType
>;

function isOperatorPage(
  path: InstancePagePath,
): path is keyof typeof operatorText {
  return Object.hasOwn(operatorText, path);
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { segments = [] } = await params;
  const path = `/${segments.join("/")}`;
  const instance = isInstancePage(path);
  const cloud = isTimeTrackCloud();
  const { brand, baseUrl } = await getRequestBrand();
  const url = new URL(
    path,
    baseUrl ?? (instance && !cloud ? getAppUrl() : getMarketingUrl()),
  );
  if (!instance || cloud) {
    if (!isMarketingEnabled()) notFound();
    const page = await loadMarketingPage(segments);
    const pageMetadata = page.generateMetadata
      ? await page.generateMetadata(marketingProps(segments, searchParams))
      : page.metadata;
    const editorialMetadata = {
      ...(await loadMarketingLayoutMetadata(segments)),
      ...pageMetadata,
    };
    const { title, description, openGraph } = editorialMetadata;
    // Editorial copy and attribution describe the original Cloud offering.
    return {
      authors: [{ name: "TimeTrack" }],
      creator: "TimeTrack",
      publisher: "TimeTrack",
      ...editorialMetadata,
      robots: editorialMetadata.robots ?? { index: true, follow: true },
      metadataBase: new URL(url.origin),
      alternates: { ...editorialMetadata.alternates, canonical: url },
      openGraph: {
        ...openGraph,
        title:
          openGraph?.title ?? (typeof title === "string" ? title : undefined),
        description: openGraph?.description ?? description ?? undefined,
        url,
        siteName: brand.name,
        images: openGraph?.images ?? [
          { url: new URL("/opengraph-image", url) },
        ],
      },
    };
  }
  const title = INSTANCE_PAGES[path];
  return {
    title,
    alternates: { canonical: url },
    openGraph: {
      url,
      title: `${title} | ${brand.name}`,
      siteName: brand.name,
      images: [
        { url: new URL("/opengraph-image", url), width: 1200, height: 630 },
      ],
    },
    robots: { index: false, follow: false },
  };
}

export default async function InstancePage({ params, searchParams }: Props) {
  const { segments = [] } = await params;
  const path = `/${segments.join("/")}`;
  if (!isInstancePage(path) || (isOperatorPage(path) && isTimeTrackCloud())) {
    if (!isMarketingEnabled()) notFound();
    const { default: Page } = await loadMarketingPage(segments);
    return <Page {...marketingProps(segments, searchParams)} />;
  }
  if (!isOperatorPage(path)) {
    const Page = pages[path];
    return <Page />;
  }

  const { brand } = await getRequestBrand();
  const t = await getTranslations("chrome.instance");
  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      <MarketingHero
        title={INSTANCE_PAGES[path]}
        subtitle={t(operatorText[path])}
      >
        <Link className="mt-4 inline-block underline" href="/contact">
          {t("contact", { brand: brand.name })}
        </Link>
      </MarketingHero>
      <Footer />
    </div>
  );
}
