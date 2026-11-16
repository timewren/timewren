import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdLandingPage } from "@/components/marketing/AdLandingPage";
import { AD_LANDINGS, getAdLanding } from "@/lib/marketing/ad-landings";

// Kun de kendte LP'er bygges; alt andet under /lp giver 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return AD_LANDINGS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const landing = getAdLanding((await params).slug);
  if (!landing) return {};
  return {
    title: { absolute: landing.meta.title },
    description: landing.meta.description,
    // Betalt trafik, ikke organisk: hold LP'erne ude af indekset, så de
    // ikke konkurrerer med de organiske sider. AdsBot ignorerer noindex.
    robots: { index: false, follow: true },
  };
}

export default async function AdLandingRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const landing = getAdLanding((await params).slug);
  if (!landing) notFound();
  return <AdLandingPage landing={landing} />;
}
