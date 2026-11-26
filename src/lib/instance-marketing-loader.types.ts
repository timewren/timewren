import type { Metadata } from "next";

export type MarketingProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export type MarketingPage = {
  default: React.ComponentType<MarketingProps>;
  metadata?: Metadata;
  generateMetadata?: (props: MarketingProps) => Promise<Metadata>;
};
