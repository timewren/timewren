import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BranchePage } from "@/components/marketing/BranchePage";
import { BRANCHER } from "@/lib/marketing/brancher";

export const metadata: Metadata = {
  title: "Timeregistrering for konsulenter: dokumentation der holder",
  description:
    "Timeregistrering til selvstændige konsulenter: dokumentér møder, forberedelse og opfølgning pr. kunde, og send specifikation med fakturaen. Gratis at starte.",
  alternates: { canonical: "/timeregistrering-konsulent" },
  openGraph: {
    title: "Timeregistrering for konsulenter: dokumentation der holder",
    description:
      "Timeregistrering til selvstændige konsulenter: dokumentér møder, forberedelse og opfølgning pr. kunde, og send specifikation med fakturaen. Gratis at starte.",
    url: "/timeregistrering-konsulent",
    type: "website",
  },
};

export default function TimeregistreringKonsulentPage() {
  const branche = BRANCHER.find((b) => b.slug === "konsulent");
  if (!branche) notFound();
  return <BranchePage branche={branche} />;
}
