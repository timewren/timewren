import type { Metadata } from "next";

// Titel, beskrivelse og OG står på siden (page.tsx). Her kun twitter-kortet,
// så det ikke gentager gamle prisforskelle.
export const metadata: Metadata = {
  twitter: {
    card: "summary_large_image",
    title: "TimeTrack og Effihub sammenlignet",
    description:
      "Klippekort, kundeportal, browserudvidelse og pris for én bruger, side om side.",
  },
};

export default function EffihubAlternativLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
