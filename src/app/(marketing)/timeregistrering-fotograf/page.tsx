import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BranchePage } from "@/components/marketing/BranchePage";
import { BRANCHER } from "@/lib/marketing/brancher";

export const metadata: Metadata = {
  title: "Timeregistrering for fotografer: fang redigeringstimerne",
  description:
    "Timeregistrering til freelancefotografer: track shoot, redigering og kørsel pr. kunde, se din reelle timepris og fakturér uden at gætte. Gratis at starte.",
  alternates: { canonical: "/timeregistrering-fotograf" },
  openGraph: {
    title: "Timeregistrering for fotografer: fang redigeringstimerne",
    description:
      "Timeregistrering til freelancefotografer: track shoot, redigering og kørsel pr. kunde, se din reelle timepris og fakturér uden at gætte. Gratis at starte.",
    url: "/timeregistrering-fotograf",
    type: "website",
  },
};

export default function TimeregistreringFotografPage() {
  const branche = BRANCHER.find((b) => b.slug === "fotograf");
  if (!branche) notFound();
  return <BranchePage branche={branche} />;
}
