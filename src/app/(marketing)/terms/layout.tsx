import type { Metadata } from "next";
import { generateMetadata } from "@/lib/metadata";

export const metadata: Metadata = generateMetadata({
  title: "Servicevilkår - TimeTrack Brugsvilkår og Betingelser",
  description:
    "Læs TimeTrack's servicevilkår og betingelser. Information om abonnementer, priser, brugsrettigheder, og ansvarsfraskrivelser for brug af platformen.",
  canonical: "/terms",
  keywords: [
    "servicevilkår",
    "brugsvilkår",
    "terms of service",
    "abonnement betingelser",
    "timetrack vilkår",
  ],
});

export default function TermsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
