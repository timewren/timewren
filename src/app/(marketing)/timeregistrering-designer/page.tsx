import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BranchePage } from "@/components/marketing/BranchePage";
import { BRANCHER } from "@/lib/marketing/brancher";

export const metadata: Metadata = {
  title: "Timeregistrering for designere: styr på rettelsesrunderne",
  description:
    "Timeregistrering til freelancedesignere: track kreativ tid og rettelsesrunder pr. kunde, lær af dine fastpris-projekter og fakturér det hele. Gratis at starte.",
  alternates: { canonical: "/timeregistrering-designer" },
  openGraph: {
    title: "Timeregistrering for designere: styr på rettelsesrunderne",
    description:
      "Timeregistrering til freelancedesignere: track kreativ tid og rettelsesrunder pr. kunde, lær af dine fastpris-projekter og fakturér det hele. Gratis at starte.",
    url: "/timeregistrering-designer",
    type: "website",
  },
};

export default function TimeregistreringDesignerPage() {
  const branche = BRANCHER.find((b) => b.slug === "designer");
  if (!branche) notFound();
  return <BranchePage branche={branche} />;
}
