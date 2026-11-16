import type { Metadata } from "next";
import { generateMetadata } from "@/lib/metadata";

export const metadata: Metadata = generateMetadata({
  title: "GDPR - Datasikkerhed og Dine Rettigheder",
  description:
    "Sådan overholder TimeTrack GDPR og databeskyttelsesforordningen. Læs om dine rettigheder, cookies, datasikkerhed og hvordan du kan udøve dine GDPR-rettigheder.",
  canonical: "/gdpr",
  keywords: [
    "gdpr",
    "gdpr compliance",
    "databeskyttelse",
    "gdpr rettigheder",
    "cookies politik",
    "datasikkerhed gdpr",
  ],
});

export default function GDPRLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
