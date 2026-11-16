import type { Metadata } from "next";
import { generateMetadata } from "@/lib/metadata";

export const metadata: Metadata = generateMetadata({
  title: "Om TimeTrack: tidsregistrering med klippekort",
  description:
    "TimeTrack er lavet og drevet af Mads Holst Jensen fra Odense: hvorfor han byggede det, hvem der står bag, og hvad du kan regne med.",
  canonical: "/about",
  keywords: [
    "om timetrack",
    "tidsregistrering freelancer",
    "timetrack historie",
    "freelancer værktøj danmark",
  ],
});

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
