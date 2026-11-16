import type { Metadata } from "next";
import { SegmentPage } from "@/components/marketing/SegmentPage";
import { getSegment } from "@/lib/marketing/segments";

const segment = getSegment("selvstaendig");

export const metadata: Metadata = {
  title: segment.meta.title,
  description: segment.meta.description,
  alternates: { canonical: segment.path },
  openGraph: {
    title: segment.meta.title,
    description: segment.meta.description,
    url: segment.path,
    type: "website",
    locale: "da_DK",
    siteName: "TimeTrack",
  },
  twitter: {
    card: "summary_large_image",
    title: segment.meta.title,
    description: segment.meta.description,
  },
};

export default function SelvstaendigPage() {
  return <SegmentPage segment={segment} />;
}
