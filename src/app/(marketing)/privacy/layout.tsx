import type { Metadata } from "next";
import { generateMetadata } from "@/lib/metadata";

export const metadata: Metadata = generateMetadata({
  title: "Privatlivspolitik - Sådan Beskytter TimeTrack Dine Data",
  description:
    "Læs TimeTrack's privatlivspolitik og find ud af hvordan vi indsamler, bruger og beskytter dine personoplysninger i henhold til GDPR og dansk lovgivning.",
  canonical: "/privacy",
  keywords: [
    "privatlivspolitik",
    "gdpr compliance",
    "databeskyttelse",
    "persondata sikkerhed",
    "privacy policy danmark",
  ],
});

export default function PrivacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
